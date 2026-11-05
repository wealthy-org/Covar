# Covar — reference parity register

Working register required by the brief (§5). One row per screen/state.

Reference captures were taken on 4 Nov 2026 and live in `docs/reference/` (landing, its scrolled
sections, discover, and the studio wallet gate). The design mapping — reference token → Covar token,
screen by screen — is in `docs/UI_PARITY.md`; the feature-level inventory is in
`docs/FEATURE_STATUS.md`.

Legend — **Impl**: `done`, `partial`, `stub`, `pending`.

| # | Reference route | Screen / state | Observed behaviour (from brief) | Our route | Impl | Acceptance evidence | Open question |
|---|---|---|---|---|---|---|---|
| 1 | `/` | Landing, hero | Product explanation + application entry | `/` | done | `shot-home.png` | Exact reference hero copy/motion not captured |
| 2 | `/` | Example strategy conversation | Shows a chat producing a strategy | `/` §Example conversation | done | screenshot | Is the reference conversation interactive or static? |
| 3 | `/` | Build vs follow explanation | Two paths: build, follow | `/` How it works | partial | — | Reference may model "follow" (copy-trading) as a separate product; we implement agent vault funding instead. Unresolved: is Follow in parity scope or explicitly "coming soon"? |
| 4 | `/` | FAQ | Collapsed Q&A | `/` FAQ | done | screenshot | — |
| 5 | `/explore` | Agent list | Ranked list, filters, provenance | `/explore` | done | `shot-explore.png` | Exact reference sort formula unverified; our score is labelled as ours |
| 6 | `/explore` | Filtering / sorting | Filter + sort controls | `/explore` | done | screenshot | Whether reference excludes young agents from ranking |
| 7 | `/explore` | Agent card data | Age, TVL, return, drawdown, score, creator | `/explore` | done | screenshot | — |
| 8 | `/studio` | My agents | Create, edit, manage, test, operate | `/studio` | done | screenshot | Reference grouping (drafts vs versions) inferred |
| 9 | `/studio?new=1` | AI access check | Credit check before new strategy | `/studio` credits card + builder | partial | screenshot | Exact reference gating copy/limits |
| 10 | `/studio?new=1` | Chat → rules | NL to structured rules | Builder chat | done | `shot-bt.png` | Reference model behaviour cannot be reproduced exactly; ours is deterministic and documented |
| 11 | `/studio?new=1` | Visual editor | Editable rules | Rules tab | done | screenshot | Reference control set (sliders vs inputs) not captured |
| 12 | `/studio?new=1` | Code mode | Read-only code view | Code tab | done | screenshot | Is the reference code view editable? |
| 13 | `/studio?new=1` | Diff / review | Review changes before applying | Diff modal | done | screenshot | — |
| 14 | `/studio?new=1` | Backtest results | Chart, metrics, trades | Backtest tab | done | `shot-bt.png` | Reference cost assumptions (fee/slippage/funding) not verified |
| 15 | `/studio` | Practice start/stop | Explicit start/stop, isolated ledger | `/studio` | done | screenshot | Reference practice duration/limits |
| 16 | `/portfolio` | Accounts | Wallet + vault holdings | `/portfolio` | done | `shot-portfolio.png` | Reference account abstraction (EOA vs app account) |
| 17 | `/portfolio` | Deposit | Amount + fee preview | Agent vault tab modal | done | screenshot | Creator's own funds treatment on deposit fee is unverified |
| 18 | `/portfolio` | Withdrawal request | Request pending, not instant | Vault tab + portfolio | done | `screenshots/03-agent.png` | Reference unwind duration and timeout/refund behaviour |
| 19 | `/portfolio` | Pending activity | Pending/claimable states | Ledger "Pending" tab | done | screenshot | — |
| 20 | `/agents/[id]` | Record | Equity vs benchmark | Agent detail | done | `shot-vault.png` | Whether reference plots a rules-only twin (we do, per brief §9) |
| 21 | `/agents/[id]` | Activity / decisions | Decision log | Activity tab | done | screenshot | Reference decision schema |
| 22 | `/agents/[id]` | Risk | Risk configuration | Rules tab | done | screenshot | Exact reference ceilings per agent |
| 23 | `/agents/[id]` | Versions | Version history + notice | Versions tab | done | screenshot | Reference investor-notice period (we implement 48h as an assumption) |
| 24 | `/agents/[id]` | Vault / invest flow | Deposit into agent vault | Vault tab | done | screenshot | Reference vault contract behaviour unverified |
| 25 | `/creators/[id]` | Creator record | Public history incl. unsuccessful agent | `/creators/[id]` | done | screenshot | — |
| 26 | `/economics` | Fee model | 1% + 0.10 deposit; ≤20% winning profit; 80/20 | `/economics` | done | screenshot | Rounding, charging time, exempt cases |
| 27 | `/economics` | Token features | Allocations, coming-soon items | `/economics` | stub | labelled "not implemented" | Which token features are in parity scope |
| 28 | `/treasury` | Fee accounting | Distributions, buyback/burn | `/treasury` | partial | labelled testnet data, zero burn | Reference treasury page data source unverified |
| 29 | `/docs` | Documentation | Setup, fees, custody, failure behaviour | `/docs` | done | screenshot | — |
| 30 | — | Wallet connect / sign-in | Wallet-dependent states | `src/lib/wallet.ts` + `WalletDialog` | partial | pluggable providers (session / injected EIP-1193 / Privy-not-shipped); dialog states what each connection proves | Reference auth flow (SIWE vs embedded wallet) |
| 31 | — | Vault contract | Deposit, shares, withdrawal, fees | `contracts/CovarVault.sol` | partial | 18 passing assertions (`npm run test:contracts`); not deployed | Canonical testnet USDG address; reference vault behaviour unverified |
| 32 | — | On-chain state surface | — | `/chain` | done | `screenshots/13-chain-onchain.png` (live NAV/shares/fees from a running vault) | Which explorer links the reference exposes per agent |
| 33 | — | Order execution & risk gate | Reference places orders through an exchange adapter with risk caps and a decision log | `services/*` (`npm run services`) | partial | adapters selectable (`VENUE_ADAPTER`, live refuses to boot) + 39 service tests + 20 cross-process + 19-check E2E rehearsal on real contracts | Reviewed live venue adapter; testnet value needs a funded key first |
| 34 | — | Execution surface | Reference exposes agent activity, not the order path | `/execution` | done | `15-execution.png` — live journal, state machine counts, restart reconciliation report | Whether the reference surfaces per-order state at all; we show it for honesty |
| 35 | `/` | Contract strip + nav | Contract address with copy/explorer, uppercase mono links, `+ NEW AGENT` / wallet button | `.announce` + nav | done | `01-landing.png` vs `reference/landing.png` | No token exists, so the strip shows the testnet vault address and says "not deployed yet" |
| 36 | `/studio` | Wallet gate | Centred "Welcome" card, three bullets, full-width connect button | `WalletGate` | done | `00-wallet-gate.png` vs `reference/studio.png` | Reference uses Privy; ours defaults to a session stand-in (labelled) or an injected EIP-1193 wallet (account access, no signature) |
| 37 | — | Market data | Reference shows live prices per agent | `src/lib/prices.ts` + `GET /api/prices` | done | live Hyperliquid perp mids (Coinbase fallback), server-side, labelled; outage reported not hidden | Reference price source unknown; venue-native oracle TBD |
| 38 | — | AI Copilot | Reference: conversational strategy building with an AI Copilot and credits | `src/lib/copilot.ts` + `POST /api/copilot` | partial | model provider seam (`ANTHROPIC_API_KEY`), bounded interpretation contract, engine label on every draft; rules-only parser by default | News/social/context tools the reference may use are unverified |
| 39 | — | Notifications | Reference scope: notifications | `/notifications` + store | done | in-app inbox fed by real state transitions only; unread badge in nav | Email/push channels not built |
| 40 | — | Vault event indexer | Reference reads on-chain history via some indexing layer | `services/indexer/main.ts` (:4014) | done | decodes Deposit/WithdrawalRequested/PositionsClosed/Settled/Claimed/NavReported/Paused from raw `eth_getLogs`; checkpointed | Reorg handling |

## Flagged inconsistencies from the brief (§13)

- Reference landing described Follow as "coming soon" while a public agent page showed an open vault
  and a short real-money record. Our build treats Follow as **out of scope** and models vault funding
  as the investor path; the row above stays `partial` until the owner confirms.
- Discovery in the reference used backtest figures for young agents. Our build labels provenance on
  every card and excludes backtests from ranking — an intentional deviation recorded here.

## Deviations from the reference (intentional)

1. Product name/identity: Covar, muted cobalt (`#3B5BDB`) instead of the reference orange.
2. Ranking: backtests excluded and young agents marked, to keep provenance honest.
3. Fee model: reference behaviour preserved; the high-water-mark proposal is **not** implemented.
4. Token/staking pages state "not implemented" instead of illustrating mechanics that do not exist.
