# Execution plane

The web app never signs an order. An agent's intent crosses four process boundaries
before it can become a fill, and every boundary has its own append-only journal:

| Process | Port | Owns | Refuses |
| --- | --- | --- | --- |
| `execution` | 4010 | intent acceptance, order state machine, journal replay, reconciliation | new intents until reconciliation completes |
| `risk` | 4012 | seven named checks, platform ceilings, `normal / close_only / halted` | anything above 5x, 40% equity notional, entries after a 10% daily loss or 25% drawdown |
| `signer` | 4013 | order signature, market allowlist | any request carrying a withdrawal-style `destination` field; non-allowlisted markets |
| `exchange` | 4011 | the venue boundary (paper matcher in this build) | a second order under an existing `clientOrderId` |

JOURNALS live under `COVAR_STATE_DIR` (default `.covar-state/`), one `.jsonl` file per
service, `fsync`-ed on every line. `execute → risk → signer → venue` is the only order
of operations, and the journal is written *before* each step, not after.

## Order state machine

```
queued ──▶ signed ──▶ submitting ──▶ submitted ──▶ filled
   │            │            │
   ├─▶ risk_rejected (terminal)          ← risk service said no
   └─▶ failed (terminal)                 ← signer refused / venue error
```

`submitting` is journaled **before** the venue call. That is the crash window: a
process that dies between "I am about to submit" and "the venue acked" leaves an
order whose fate is unknown. Recovery reconciles instead of guessing.

| Transition | Journal line | Why it exists |
| --- | --- | --- |
| accept | `intent_accepted` | durable intent, keyed by `intentId` |
| duplicate intent | `intent_deduplicated` | a replayed intent never trades twice |
| risk | `status … risk_rejected` + decision | the reason stays on the record for the UI |
| sign | `status … signed` | signature stored, not necessarily used |
| pre-submit | `status … submitting` | the crash window |
| ack | `status … submitted` | `venueOrderId` recorded |
| fill | `fill_applied` | idempotent by `fillId` |
| operator pause | `held_by_pause` | new risk is held, not destroyed |
| recovery | `recovery_report`, `recovered_adopted`, `recovered_resubmit` | what the restart decided, and why |

## Reconciliation on boot

1. `execution` replays its journal; intents and orders come back from disk, not memory.
2. For every order in a non-terminal state (`submitting`, `submitted`) it asks the venue
   by `clientOrderId`.
   - **Venue has it** → adopt: record the `venueOrderId`, resume fill processing. No new order.
   - **Venue does not have it** → resubmit **with the same `clientOrderId`**, so a venue
     that *does* remember it will still deduplicate.
3. The report (`scanned`, `adopted`, `resubmitted`, `duplicatePrevented`) is journaled and
   surfaced on `/execution`.
4. Until step 3 succeeds the service answers `503` to new intents — "I could not reach the
   venue" must never be treated as "the venue has no such order".

The paper venue keeps its own journal and replays it on boot, so its `clientOrderId`
dedupe table survives *its* restarts too.

## Running it

```bash
npm run services          # four processes, interleaved logs, shared COVAR_STATE_DIR
```

```bash
# one intent
curl -X POST localhost:4010/intents -H 'content-type: application/json' -d '{
  "intent": {
    "intentId": "intent-001", "agentId": "ag-01", "market": "ETH-PERP",
    "side": "buy", "qty": 0.5, "price": 3200, "reduceOnly": false,
    "leverage": 2, "strategyVersion": 3, "proposedBy": "rules",
    "copilotDecision": "rules_only", "createdAt": "2026-11-04T00:00:00Z"
  }
}'

curl localhost:4010/state      # orders, positions, counts, last recovery report
curl -X POST localhost:4010/recover
curl -X POST localhost:4010/pause -H 'content-type: application/json' -d '{"paused":true}'
```

`/execution` in the app reads the same state through `/api/execution` (server-side only),
and says "execution plane is not running" rather than showing stale or invented data.

## Evidence

`npm run test:services` — 39 assertions, single process, in-memory ports.

`npm run demo:reconcile` — the same scenario across **real OS processes** on separate
ports, with the execution process killed (`exit 137`, not a caught exception) after the
venue ack. 20 assertions, all passing at the time of writing:

- crash leaves the journal at `submitting` with the `crashed_after_venue_ack` line on disk
- the venue holds exactly one order for that `clientOrderId` (`order_accepted`: 1)
- restart adopts it (`adopted: ["c-intent-demo-0001"]`, `resubmitted: []`)
- filled once: `filledQty` 0.5, one position, venue position agrees
- replayed intent → `intent_deduplicated`, no second order
- operator pause holds the entry (still `queued`), exit still fills
- venue restart → same `orderId`, same fills, still one `order_accepted`
- second execution restart → same state again, nothing duplicated

The run leaves its journals in `.covar-state/demo-<timestamp>/` so the report can be
audited line by line.

## What this is not

- The venue is a **paper matcher**. No testnet or mainnet order has been placed by this
  plane. Testnet wiring is blocked on a funded deployer key and a confirmed testnet USDG.
- Risk ceilings are server-side. They are not on-chain guarantees, and they are triggers,
  not promises about maximum realised loss during gaps.
- `/execution` shows *practice* provenance only. It must not be read as a live track record.

## Venue adapter seam (done) & live adapter (refused by design)

The `VenuePort` interface (`submit`, `get`, `advance`) is now a selectable adapter in
`services/shared/venue-adapters.ts`: paper (the default, labelled) or live. Selecting
`VENUE_ADAPTER=live` **refuses to boot** — no script can ever paper-trade under a live
label by mistake. The adapter descriptor is on execution `/health` and `/state`.

A real adapter is the deliberate next step: credentials, signing and idempotency are
reviewed against the real venue API, and then the SAME rehearsal below must pass against
it before any testnet value moves.

## End-to-end rehearsal (done)

`npm run rehearse:e2e` deploys fresh contracts on the local EVM and proves the whole loop
with real transactions and real process crashes — 19 checks:

1. deposit mints shares (real tx hash),
2. the indexer reports `Deposit` decoded from chain logs,
3. operator pause holds an entry intent: no venue position, `reportedAssets` unchanged,
   no `NavReported` event — a paused trade cannot touch the vault,
4. resume executes exactly once; still no silent NAV write (P&L lands only via `reportNav`),
5. withdrawal request → close → settle → claim; every step indexed from chain logs,
6. execution is SIGKILLed after the venue ack; recovery adopts the order without
   resubmitting; the venue accepted exactly two orders across the whole rehearsal.

A dated JSON report lands in `docs/rehearsals/`.

## Vault indexer (:4014)

`services/indexer/main.ts` watches CovarVault over raw JSON-RPC (`eth_getLogs`) and
serves decoded events on `/events`. Topic filtering is done in-process, not in the RPC
filter: the local node silently returns nothing for multi-topic OR filters, and an
indexer whose filter depends on node behaviour would quietly miss events. Checkpoints in
`.covar-state/indexer.checkpoint.json`; a failed RPC poll surfaces as `lastError`, never
as fabricated sync state.
