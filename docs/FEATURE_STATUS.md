# Feature status — what works, what is partial, what is missing

Snapshot: 4 Nov 2026 (updated after the 4 Nov completion pass). Legend:
**Working** = you can do it in the running app today · **Partial** = the surface exists
but something behind it is simulated, mocked or manual · **Not built** = no code, and the
UI says so rather than illustrating it.

Evidence column points at a test, a screenshot or a file — not at an intention.

---

## 1. Working

### Product surface

| # | Feature | Where | Evidence |
| --- | --- | --- | --- |
| 1 | Landing page: hero, assistant example, how-it-works, proof sections, FAQ, CTA | `/` | `screenshots/01-landing.png` |
| 2 | Discover: tabs, sort, search, market filter, agent table with provenance | `/explore` | `screenshots/02-discover.png` |
| 3 | Agent detail: stats, equity-vs-benchmark-vs-twin chart, overview/activity/rules/versions/vault tabs, decision log | `/agents/[id]` | `screenshots/03-agent.png` |
| 4 | Creator record, including unfinished and unsuccessful agents | `/creators/[id]` | route + seed data |
| 5 | Studio: my agents, drafts, practice start/stop with visible price mode, Copilot credit balance | `/studio` | `screenshots/05-studio.png` |
| 6 | Builder chat → typed rules | `/studio?new=1` | `screenshots/09-builder-chat.png` |
| 7 | Visual rules editor + code view | Builder tabs Rules / Code | `screenshots/19-builder-rules.png` |
| 8 | Validation: blocks publishing without entry/exit, clamps platform ceilings | Builder → Validation | `npm test` |
| 9 | Backtest: seeded, reproducible, per-fill costs, trade list, assumptions | Builder tab Backtest | `screenshots/10-builder-backtest.png` |
| 10 | Draft vs published version separation, version history, diff before publish, publish requires backtest + acknowledgement | Builder → Publish | `npm test` |
| 11 | Practice mode: start/stop, isolated ledger, P&L apart from every other record | `/studio`, agent page | E2E + screenshots |
| 12 | My money: vault holdings, NAV per share, deposit → request → settle → claim, append-only ledger | `/portfolio` | `screenshots/04-portfolio.png` |
| 13 | Fees & economics: 1% + 0.10 USDG flows, ≤20% winning-profit, 80/20 split, calculator | `/economics` | `screenshots/06-economics.png` |
| 14 | Treasury view: fee split, creator payouts, obligations, zero-burn | `/treasury` | `screenshots/07-treasury.png` |
| 15 | Documentation + parity register | `/docs` | `screenshots/08-docs.png` |
| 16 | Chain page: live RPC status, contract read, deployment gates | `/chain` | `screenshots/11/13-chain*.png` |
| 17 | Wallet gate (providers pluggable; see #35) | nav + gated routes | `screenshots/00-wallet-gate.png` |
| 18 | UI parity pass; P&L semantics | all routes | `docs/UI_PARITY.md` |

### Live data & models

| # | Feature | Evidence |
| --- | --- | --- |
| 19 | **Market-data adapter**: live perp marks from Lighter (Robinhood Chain: mark price + best bid/ask), Hyperliquid mids then Coinbase spot as labelled fallbacks, server-side proxy with 2 s cache, outage is reported not hidden | `src/lib/prices.ts`, `GET /api/prices`, E2E "price route returns a real snapshot" |
| 20 | **Practice on live marks**: a session started while the feed is healthy follows real prices (P&L = actual price move × exposure); otherwise it keeps the simulated wave — and the label says which | `src/lib/store.ts tickPractice`, E2E "practice session…" |
| 21 | **Copilot with model provider seam**: `AI_PROVIDER_API_KEY` present (Orbio gateway, Anthropic or OpenAI; `AI_PROVIDER`/`AI_MODEL`) → a model proposes a *bounded interpretation* (style/market/timeframe/risk/numbers); the deterministic engine encodes, validates and clamps it. Without a key, the rules parser answers. Every draft says which engine produced it; a failed model call degrades to the parser with a `rules-fallback` label | `src/lib/copilot.ts`, `POST /api/copilot`, E2E copilot tests |

### Wallet & notifications

| # | Feature | Evidence |
| --- | --- | --- |
| 22 | **Pluggable wallet providers**: session (proves nothing), injected EIP-1193 (real account access, no signature), Privy listed but not shipped; the dialog shows the selected provider and exactly what the connection proves | `src/lib/wallet.ts`, `WalletGate/WalletDialog/Nav` |
| 23 | **Notifications inbox**: practice start/stop, publish, pause/resume, deposit, withdrawal request/claim, credits top-up — each written by a real state transition; unread badge in nav; mark read / clear | `store.pushNotification`, `/notifications`, E2E inbox test |

### Execution plane (`services/`, ports 4010–4014)

| # | Feature | Evidence |
| --- | --- | --- |
| 24 | Five separate services — execution, risk, signer, venue, indexer — each with its own journal | `npm run services` |
| 25 | Order state machine `queued → signed → submitting → submitted → filled` (+ `risk_rejected`, `failed`) | `npm run test:services` (39) |
| 26 | Restart reconciliation: adopt what the venue already has, same clientOrderId, never mint a new key | journals + tests |
| 27 | Intent idempotency by `intentId`; venue idempotency by `clientOrderId`, surviving venue restarts | `demo:reconcile` (20) |
| 28 | Real-process crash proof (exit 137 mid-window) → adopted, filled once | `demo:reconcile`, `rehearse:e2e` |
| 29 | Risk gate: 7 checks, 5×/40%/10%/25% ceilings, Copilot approval cannot raise them | `npm run test:services` |
| 30 | Signer isolation: market allowlist, refuses withdrawal-destination payloads | `npm run test:services` |
| 31 | Operator pause holds new risk while exits keep filling | `npm run test:services` |
| 32 | `/execution` dashboard: counts, reconciliation report, positions, journal, recover + pause controls | `15-execution.png` |
| 33 | **Venue adapter seam**: `selectVenueAdapter()` — paper (default) or live; live refuses to boot rather than paper-trade under a live label; descriptor surfaces on execution `/health` and `/state` | `services/shared/venue-adapters.ts` |
| 34 | **Vault event indexer**: watches CovarVault events over raw `eth_getLogs`, decodes Deposit / WithdrawalRequested / PositionsClosed / WithdrawalSettled / WithdrawalClaimed / NavReported / Paused, checkpointed resumable state, honest `lastError` | `services/indexer/main.ts` (:4014) |

### Contracts & verification

| # | Feature | Evidence |
| --- | --- | --- |
| 35 | `CovarVault.sol`: NAV-guarded mint, fees, four-step withdrawal, freshness window, deviation cap, single owner | `npm run test:contracts` (18) |
| 36 | `MockUSDG.sol` 6-decimal test collateral | contract + tests |
| 37 | Local rehearsal deployment; app reads real on-chain state | `deployments/31337.json`, `13-chain-onchain.png` |
| 38 | Preflight + deploy scripts with guard rails | `scripts/preflight.ts`, `scripts/deploy.ts` |
| 39 | **End-to-end rehearsal**: deposit → trade-held-under-pause with vault untouched (no venue position, no NAV movement, no balance change) → resume → exactly one fill → request/close/settle/claim → crash after venue ack → adopted once; **19 checks, all passing, real tx hashes, report written per run** | `npm run rehearse:e2e`, `docs/rehearsals/*.json` |
| 40 | **Committed browser E2E (10 tests)**: gate, builder, backtest, practice labels, inbox, plus honesty invariants (no "live prices", no fabricated tx hashes, copilot engine label) | `tests/e2e/app.spec.ts`, `npx playwright test` |
| 41 | Suites: engine 25 · services 39 · cross-process 20 · contracts 18 · E2E 10; `tsc` clean; `next build` 13 routes | `npm run test:all` |
| 42 | CI workflow: typecheck → all suites → build → E2E → local-chain rehearsal | `.github/workflows/ci.yml` |
| 43 | **Application storage**: Prisma + SQLite (dev) / PostgreSQL-ready schema — session snapshot plus queryable tables for notifications, ledger, practice runs, strategy versions; localStorage stays the offline cache | `prisma/schema.prisma`, `/api/state` roundtrip verified (rows counted from the DB) |

---

## 2. Partial — the surface exists, the substance does not

| # | Feature | What exists | What is missing |
| --- | --- | --- | --- |
| 43 | **Copilot context** | Bounded interpretation, credits, rules-only twin | News/X/on-chain context tools, Orbio balance, credit purchase with real money |
| 44 | **Venue** | Full adapter seam, deterministic paper venue, crash-safe client | A real exchange adapter (Lighter or other) — `VENUE_ADAPTER=live` refuses to boot until one is reviewed in |
| 45 | **Risk engine** | Enforced in its own process | Not enforced exchange-side, no per-agent overrides beyond strategy caps, no funding/liquidation modelling |
| 46 | **Vault liquidity path** | Contract tested; UI reads deployed state when an address is set | Not deployed on any real chain; UI money movements are the simulated ledger until then |
| 47 | **Creator payouts** | Computed per trade in treasury/economics | Settled on-chain |
| 48 | **Discovery ranking** | Score formula, 30-day rule, provenance column | Ranking over indexed vault history instead of seeded demo data (indexer now exists — wiring ranking to it remains) |
| 49 | **Copy trading** | Vault funding as the investor path | Mirroring another wallet's positions |
| 50 | **Testing beyond one crash** | 5 suites incl. E2E + rehearsal | Load/chaos matrix, fuzzed risk inputs, multi-day soak |

---

## 3. Not built (and labelled as such in the UI)

| # | Feature | UI treatment |
| --- | --- | --- |
| 51 | Protocol token, launch, contract address | Announcement bar "not deployed yet"; no fabricated address |
| 52 | Staking, treasury yield, buyback/burn | `/treasury` states zero burn |
| 53 | Live venue fills | `VENUE_ADAPTER=live` refuses; `/execution` banner "paper venue" |
| 54 | Testnet deployment (46630) | `/chain` gate: blocked on funded deployer key + confirmed testnet USDG |
| 55 | Mainnet (4663) | `/chain` gate: refused until prior gates pass |
| 56 | Multisig / timelock admin | Deliberately absent; single-key risk is an accepted, documented risk |
| 57 | Mobile apps, i18n, dark mode | Responsive web only |
| 58 | Observability (metrics/alerting/tracing), rate limiting, abuse controls | Journals are the audit trail |

---

## 4. MVP checklist

Definition: someone can open the app, build a strategy, test it, practise it, and understand
exactly where the money is — without any screen claiming something that has not happened.

| MVP requirement | Status |
| --- | --- |
| Create a strategy from plain English | ✅ |
| Model-powered Copilot with honest fallback | ✅ (key-less deployments use the rules parser, labelled) |
| See and edit the actual rule set | ✅ |
| Backtest with explicit costs and reproducible seed | ✅ |
| Practise without investor capital | ✅ (live marks when the feed is up, labelled either way) |
| Publish a versioned agent; drafts never silently change a funded version | ✅ |
| Discover agents with honest provenance | ✅ (demo data) |
| Fund a vault, request and claim a withdrawal | ✅ end-to-end against real contracts on the rehearsal chain; simulated ledger in the UI until testnet deployment |
| Risk limits that a creator or the AI cannot bypass | ✅ in the execution plane |
| Keys that cannot withdraw | ✅ signer refuses destination payloads |
| Survive a crash without double-trading | ✅ real process death, 19/19 rehearsal checks |
| Event indexer for the vault | ✅ (local chain; testnet follows deployment) |
| Notifications | ✅ in-app inbox, session-derived |
| Wallet identity | ⚠️ pluggable: session default; injected EVM real account access; Privy not shipped |
| Real orders on a real venue | ❌ adapter seam ready; venue integration is the deliberate next step |
| Committed E2E + CI | ✅ |

**Blocking the testnet milestone, in order:** (1) funded `DEPLOYER_KEY`, (2) `OPERATOR_ADDRESS`
and `FEE_RECIPIENT_ADDRESS` as separate wallets, (3) confirmed testnet USDG address,
(4) a reviewed live-venue adapter that passes `rehearse:e2e` against it unchanged,
(5) one small real deposit → trade → withdraw while paused/unpaused — the rehearsal in step 8
of `rehearse:e2e`, but on 46630.
