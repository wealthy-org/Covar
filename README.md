# Covar

Repository: [github.com/wealthy-org/Covar](https://github.com/wealthy-org/Covar)

Reference-parity build of Covar — strategy agents with published rules, versioned history and
investor vaults — targeting **Robinhood Chain**. Product direction, palette and scope come from
`COVAR_ROBINHOOD_DEV_BRIEF.md`; Sharpe (`sharpe.ac`) remains the functional/UI baseline.

> **Status.** This build is the reviewable web foundation: app shell, builder, backtest, practice,
> discovery, agent/creator records, vault/investor flow, economics and treasury — all cobalt-tokenised
> and all labelled by data provenance. The **execution plane** now runs as five separate services
> (execution / risk / signer / venue / indexer) with append-only journals and restart reconciliation, proven
> across real processes, with the vault indexer (:4014) and a venue adapter seam that refuses to boot
> as "live" until reviewed. The venue is still a **paper matcher**: **no contract is deployed, no order has
> touched testnet or mainnet, and no real value is at risk.** A live venue adapter is the deliberate next step
> (see [Parity & gaps](#parity--gaps)).

---

> **Mau langsung mengetes?** Panduan langkah-demi-langkah (UI, unit, E2E, rehearsal chain
> lokal, dan checklist testnet) ada di [`TESTING.md`](TESTING.md).

## Run it

```bash
pnpm install           # postinstall: creates .env from template + generates the Prisma client
pnpm dev               # http://localhost:3000
pnpm services             # execution plane: :4010 execution · :4011 venue · :4012 risk · :4013 signer
pnpm build                # production build (typecheck included)
pnpm test                 # engine checks: parsing, validation ceilings, reproducibility, fees
pnpm test:services        # execution plane: idempotency, risk independence, crash recovery (39)
pnpm test:contracts       # CovarVault suite on the local EVM
pnpm test:e2e             # browser E2E (10 tests)
pnpm test:all             # semua suite
pnpm preflight:testnet    # read-only checks against Robinhood Chain 46630
```

Node 20+ (Windows/PowerShell works too). Database values live in `.env` only — never paste a URL into
`prisma/schema.prisma` (it must keep `env("DATABASE_URL")`). With no env vars the app runs on deterministic in-browser state (`localStorage`) and labels
vault flows **Simulated**. Point `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` at a deployment and the vault UI reads
live contract state instead.

## Routes

| Route | What it is |
|---|---|
| `/` | Landing: hero, how it works, example conversation, discover preview, provenance, FAQ |
| `/explore` | Discover — filter by record type, market; sort by score/return/TVL/drawdown/age; grid + table |
| `/studio` | My Agents — drafts, operated agents, practice start/stop, pause/resume, Copilot credits |
| `/studio?new=1` | Builder — chat → typed rules → diff → validation → backtest → publish v1 |
| `/portfolio` | My Money — wallet, vault holdings, deposit/withdraw/claim states, append-only ledger |
| `/agents/[id]` | Agent detail — record, decisions log, published rules, versions, vault & invest flow |
| `/creators/[id]` | Creator record — agent history **including unsuccessful live agents** |
| `/economics` | Fee model, split, calculator, explicitly pending token/staking features |
| `/treasury` | Fee accounting split, creator payouts, obligations, zero-burn stated honestly |
| `/docs` | Setup, network/deployment order, provenance, fees, risk, custody/authority, parity register |
| `/chain` | Live RPC status, deployed vault state read from the contract, deployment gates |
| `/execution` | Live order path: state machine counts, last restart reconciliation, positions, journal tail |
| `/notifications` | In-app inbox — entries only from real session transitions (practice, publish, money, risk) |
| `/creators/[id]` | Creator record, including unsuccessful and retired agents |

| API route | What it is |
|---|---|
| `/api/prices` | Server-side market data: Hyperliquid perp mids → Coinbase spot fallback; outages reported, never hidden |
| `/api/copilot` | Copilot interpreter: a model (when `AI_PROVIDER_API_KEY` is set — Orbio, Anthropic or OpenAI) may propose a bounded interpretation, the deterministic engine encodes it; response is labelled `model` / `rules` / `rules-fallback` |
| `/api/execution` | Proxy of the execution plane status |


## The four records (never blended)

| Provenance | Meaning | Investable |
|---|---|---|
| Historical backtest | Pinned dataset, explicit fees/slippage/funding, reproducible seed | No |
| Live-price practice | Live prices, simulated fills, isolated ledger | No |
| Test exchange | Real orders on testnet 46630 with faucet funds | No |
| Real money | Reconciled real fills, fees, funding | Vault only |
| Vault share price | On-chain NAV per share (spec'd, simulated in this build) | — |

Ranking is defined on the real-money record only, and only after 30 days; young agents display
their age instead of an annualised figure. Creator pages keep losers public.

## Interface

The layout, type scale, component shapes and interaction patterns follow the reference
product (`sharpe.ac`), captured in `docs/reference/`. Colours do not: the approved muted
cobalt palette stays locked and P&L stays semantic green/red.

- Geist + Geist Mono (self-hosted via the `geist` package), 4px radii, 1px borders, mono
  uppercase labels, ink (`#10141f`) primary buttons, white panels on a cool neutral page.
- Announcement strip with the vault address and COPY / VIEW ON EXPLORER, then a sticky nav
  with uppercase mono links and `+ New agent` / `Connect wallet`.
- `Discover` is a tab row (Live vaults / Agent arena / Backtests) + one table, not a grid of
  cards; provenance is a column, not a footnote.
- `/studio` and `/portfolio` are gated by a "Welcome to Covar" card, like the reference —
  with one honest difference: the wallet is a session stand-in and the card says so.

Design decisions and the reference→Covar token mapping: `docs/UI_PARITY.md`.

## Design tokens (approved palette)

```css
--background: #F7F8FC;  --surface: #FFFFFF;  --foreground: #171C2B;
--primary: #3B5BDB;     --primary-hover: #2F49B5;  --primary-soft: #EDF1FF;
--border: #E3E7EF;
```

Cobalt marks hierarchy, action and selection only. P&L stays semantic green/red. Charts use cobalt
for the agent series, neutral dashed for the benchmark and dotted grey for the rules-only twin, with a
legend and line-style differences. Focus-visible, disabled and error states are styled; reduced-motion
is honoured globally. Typography is Geist / Geist Mono; radii are 4px (the reference is square — this is
intentional, not a missing border-radius).

## How the strategy engine behaves

- A prompt is read **deterministically** (`src/lib/strategy.ts`) — no hidden model call, no invented
  conditions. Unsupported asks (guarantees, options, sentiment feeds, leverage above the 5x ceiling)
  are reported back as *not encoded* rather than silently approximated.
- Rules are a typed structure: market, timeframe, indicators, entry/exit conditions with AND/OR
  logic, risk caps, Copilot configuration and creator fee.
- Validation blocks publishing without entries/exits and clamps platform ceilings
  (5x leverage, 10% daily pause, 25% drawdown stop).
- Backtests (`src/lib/backtest.ts`) are seeded from the strategy itself: same strategy → same result.
  Costs (4.5 bps taker, 3 bps slippage, 1.2 bps/8h funding) are applied per fill and shown with the run.
- Fee maths follows reference behaviour: 1% + 0.10 USDG on capital flows; up to 20% of winning-trade
  profit split 80/20; losing trades never netted against the fee base.

## Execution plane

Four processes, four journals, one order path — the web app cannot sign anything:

```
intent ──▶ execution :4010 ──▶ risk :4012 ──▶ signer :4013 ──▶ venue :4011
                 │                │                │               │
             intents/orders   decisions        signatures      accepted + fills
                 └────────── .covar-state/*.jsonl (fsync per line) ──────────┘
```

`queued → signed → submitting → submitted → filled`, plus terminal `risk_rejected` and `failed`.
`submitting` is journaled **before** the venue call, so a crash in that window is recoverable: on boot
the execution service replays its journal, asks the venue by `clientOrderId`, and either **adopts** the
order it already has or **resubmits with the same key**. New intents are refused (`503`) until that
reconciliation succeeds. Operator pause holds new risk (orders stay `queued`) while exits keep filling.

```bash
pnpm test:services    # 39 assertions, single process
pnpm demo:reconcile   # 20 assertions across real processes; kills the service with exit 137 mid-window
```

Full runbook, journal event table and evidence: [`docs/EXECUTION_PLANE.md`](docs/EXECUTION_PLANE.md).
UI: `/execution` (`docs/screenshots/15-execution.png`).

## Project layout

```
src/app/            routes (landing, discover, studio, builder, portfolio, agent, creator, economics, treasury, docs)
src/components/     Nav, Chart (SVG line chart), AgentCard, Builder, RulesEditor, ui primitives
src/lib/            types, seed data, strategy parsing/validation, backtest engine, store (localStorage), chain client
services/       execution plane: shared/{types,journal,http}, execution/, risk/, signer/, exchange/
contracts/      CovarVault.sol + MockUSDG.sol — compiled and tested, not deployed
tests/          engine assertions (npm test) + tests/services (plural plane) + tests/contracts
scripts/        preflight.ts, deploy.ts, deploy-local.ts, run-services.ts, demo-reconcile.ts
deployments/    deployment manifests written by the scripts (addresses, tx, constructor args)
docs/           PARITY_REGISTER.md, FEATURE_STATUS.md, EXECUTION_PLANE.md, UI_PARITY.md, DEPLOYMENT.md,
                reference/ (captured reference screens), screenshots/ (our evidence)
```

## Reference-repo alignment (github.com/wealthy-org/Covar)

The local tree now follows the repo's conventions: `src/` layout (`app/`, `components/`, `lib/`
with `@/* → ./src/*`), `pnpm@10`, `version 0.2.0`, the same script surface (`lint`, `typecheck`,
`test`, `test:integration`, `db:validate/db:generate/db:migrate`), the same
`.env.example` key names (`NEXT_PUBLIC_RH_*_CHAIN_ID` / `*_RPC_URL`, `NEXT_PUBLIC_CHAIN_ENV`,
`DATABASE_URL`, `DIRECT_URL`, `AI_PROVIDER_API_KEY`, `TRADING_SIGNER_PRIVATE_KEY`), the same
`eslint.config.mjs` (FlatCompat → `next/core-web-vitals` + `next/typescript`), and
`pnpm-workspace.yaml` with `packages: ["."]` + build-allowlist.

Deliberate divergences (kept because this tree is larger than the milestone-B scaffold and must
stay verified-green, §16):

- **Next 14.2 / React 18** (repo: Next 15.5 / React 19) — so `next.config.mjs` stays; Next 14
  rejects a `.ts` config outright. Upgrade is a milestone-C decision.
- **Prisma 6 + SQLite** (repo: Prisma 7 + Postgres via `DIRECT_URL`) — zero-infra dev DB; the
  schema/migration seams are the same, `DATABASE_URL` swap moves it to pg.
- **`tsx` suites** for unit/integration (repo: vitest) — `pnpm test` / `pnpm test:integration`
  still execute the full matrices, no harness dependency.
- **Design-token CSS** instead of Tailwind 4 (same cobalt palette, §2 tokens in code).

## Parity & gaps

Milestone mapping from the brief:

| Milestone | State in this build |
|---|---|
| A — Reference baseline | Screen/state register in `docs/PARITY_REGISTER.md`; reference captures still to be attached |
| B — UI and builder | **Implemented** — cobalt tokens, app shell, chat builder, visual editor, code mode, validation, diff, drafts |
| C — Testing and practice | **Implemented** — reproducible backtest with cost assumptions; live-price practice with an isolated ledger |
| D — Exchange and risk | **Partial** — risk service, isolated signer and a crash-safe execution state machine are implemented and tested as separate processes; the venue is a deterministic **paper matcher**, so no real exchange adapter (Lighter or otherwise) is wired yet |
| E — Vault/investor path | **Partial** — contract written, compiled and covered by 18 passing assertions; app reads real on-chain state when a vault is configured. Not deployed: needs a funded deployer key and a confirmed testnet USDG address |
| F — Full suite | **Partial** — discovery, agent/creator records, Copilot surfaces, lifecycle, economics, treasury, credits. Token/staking explicitly marked pending, not mocked into looking live |
| G — Release evidence | **Not started** — needs deployed testnet addresses, reconciliation and runbooks |

Deliberately **not** built (so nothing looks more finished than it is): a real exchange adapter
(`VENUE_ADAPTER=live` **refuses to boot** until one is reviewed in — see
`services/shared/venue-adapters.ts`), reorg handling in the indexer, token economics/settlement, and any
mainnet deployment.

New since 4 Nov: live market-data adapter (`/api/prices`), practice marks on live prices (labelled),
model-capable Copilot with a bounded interpretation contract and labelled rules-only fallback
(`/api/copilot`), pluggable wallet providers (`src/lib/wallet.ts`), an in-app notifications inbox
(`/notifications`), a vault event indexer (`services/indexer/main.ts`, :4014), a 19-check end-to-end
rehearsal against the local EVM (`pnpm rehearse:e2e`, reports in `docs/rehearsals/`), a committed
browser E2E suite (`tests/e2e/app.spec.ts`, 10 tests) and a CI workflow that runs everything.

## Contracts & on-chain reads

`contracts/CovarVault.sol` is a non-upgradeable agent vault: NAV-guarded share minting, 1% + 0.10 USDG
deposit/withdrawal fee, four-step withdrawal (`request → close positions → settle → claim`), a NAV
freshness window and per-report deviation cap, and a single-owner admin model. `contracts/MockUSDG.sol`
is a test-only 6-decimal collateral token.

`src/lib/chain.ts` is a dependency-free read-only RPC client (no keys in the browser). It decodes the vault
state the UI needs: NAV per share, reported assets, shares outstanding, NAV freshness, fee parameters,
pause/close-only flags, and the owner/operator/fee-recipient set.

**Verified in this workspace (4 Nov 2026):**

- `46630` → `0xb626`, `4663` → `0x1237`, both live; testnet answered at block 148,450,172 with ~230 ms latency.
- The brief's USDG/WETH addresses resolve on **mainnet only** (symbol + decimals confirmed: `USDG` 6,
  `WETH` 18). On testnet both return empty bytecode, and several impostor `USDG` tickers exist there.
- The local rehearsal deployment proved the read path end-to-end: the app displayed
  NAV `1.0816`, assets `2,141.38 USDG`, shares `1,979.9`, fees and authority addresses straight from the
  contract (`docs/screenshots/13-chain-onchain.png`).

**Deployment is blocked on two owner inputs, not on code:** a funded deployer key and the confirmed
testnet collateral address. `pnpm preflight:testnet` reports exactly these. The runbook — including
guard rails that make the scripts refuse a wrong chain, a token without bytecode, a shared operator/fee
wallet, or a mainnet deploy without `CONFIRM_MAINNET=yes` — is in `docs/DEPLOYMENT.md`.

## Next steps (in brief order)

1. Deploy `CovarVault` + `MockUSDG` to testnet 46630 and swap the simulated vault layer for real reads.
2. Execution service with durable intents, idempotent orders and restart reconciliation.
3. Risk service as an independent process logging approvals/rejections per order.
4. Indexer with confirmation policy and reorg replay; wire real tx links into records.
5. Attach reference captures to the parity register and close the open questions listed there.
6. Only then: mainnet, small controlled value (see `docs/DEPLOYMENT.md`).

---

**Security note (documented risk).** Admin/ownership is a **single wallet, no multisig**, used on both
testnet and mainnet. No threshold approval exists for admin actions; a leaked or lost key compromises
treasury, fee recipient and operator assignment. This is an accepted, recorded risk — not an
oversight. Secrets are never committed here; provider keys, deployer keys and RPC credentials belong in
a secret manager.
