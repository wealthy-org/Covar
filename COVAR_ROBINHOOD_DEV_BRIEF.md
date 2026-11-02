# Covar — Robinhood Chain Developer Brief

**Updated:** 2 November 2026, Asia/Makassar  
**Status:** approved product name, copycat direction and visual palette; implementation specification  
**Our product name:** Covar — name confirmed by the owner; Sharpe remains the reference product  
**Reference:** https://www.sharpe.ac/  
**Target network:** Robinhood Chain

## 1. Owner directive

Bangun Covar sebagai copycat Sharpe terlebih dahulu dengan cakupan fitur, alur pengguna, struktur halaman, hierarki informasi dan interaksi yang mengikuti referensi. Perubahan visual awal cukup pada nama/identitas produk dan warna aksen: gunakan muted cobalt blue, bukan oranye referensi.

> **Owner confirmation (2 Nov 2026):** the reference website should be mirrored closely at this stage; refined color/visual adjustments are deferred to a later pass rather than addressed during the initial build. This reaffirms the directive above — replicate the reference first, revisit styling afterward — and should be treated as the standing direction unless the owner issues a different instruction.

Fokus delivery pertama adalah functional parity dengan Sharpe. Fitur pembeda, perubahan model bisnis dan perluasan scope dibahas setelah fondasi tersebut selesai. Milestone adalah urutan pengerjaan, bukan izin mengurangi scope menjadi demo.

Reference website, approved palette and captured interaction states form the initial specification. Preserve required behavior; reproduce missing implementations independently where no reusable licensed source is available.

## 2. Locked decisions

| Area | Decision |
|---|---|
| Product direction | Direct Sharpe copycat first; enhancements later |
| Network | Robinhood Chain |
| UI structure | Follow the reference layout, information hierarchy and interaction patterns |
| Initial visual change | Muted cobalt accents on light neutral surfaces |
| Primary color | `#3B5BDB` |
| Scope | Builder, backtesting, practice, live execution, agent discovery, investor vaults, economics and treasury |
| Product name | Covar — confirmed by the owner |
| Remaining product identity | Logo, domain, social handles and token identifiers pending |
| Revenue design | Implement reference behavior first; no unapproved replacement with another fee model |
| First-mover positioning | Not an approved claim; the reference already presents a Robinhood Chain product |
| Deployment order | Testnet first — full test suite and acceptance criteria must pass before any mainnet deployment; mainnet launch starts with small controlled value, not full scale |
| RPC access | Robinhood Chain RPC is frequently blocked by local ISPs; use a VPN before assuming an RPC failure is an endpoint/provider issue |
| Admin/ownership model | Single wallet admin, no multisig (see Section 4) |

### Confirmed product identity — Covar

- Use **Covar** in the application, landing page, onboarding, documentation and release materials.
- Sharpe remains the reference name in source links, behavior comparisons and implementation traceability. Do not rename or alter those references as if they belonged to Covar.
- Retain the approved muted cobalt palette (`#3B5BDB`) and the complete copycat scope. Naming does not change functionality, economics or delivery criteria.
- Our token name/ticker, package scope, domain and social handles are separate decisions; the product name does not establish their availability or approval.

## 3. Approved palette — implementation requirement

Use this palette across landing, application, charts, forms, states and responsive layouts.

| Token | Hex | Use |
|---|---|---|
| `background` | `#F7F8FC` | Main page background |
| `surface` | `#FFFFFF` | Cards, dialogs, menus, inputs and panels |
| `foreground` | `#171C2B` | Headings, body text and primary numerical values |
| `primary` | `#3B5BDB` | Primary buttons, highlighted hero text, active tabs and primary data series |
| `primary-hover` | `#2F49B5` | Hover/pressed emphasis on primary actions |
| `primary-soft` | `#EDF1FF` | Selected rows, active backgrounds, badges and subtle blue areas |
| `border` | `#E3E7EF` | Card edges, input borders and table separators |

### Application rules

1. Replace the reference's orange accents with cobalt in equivalent roles. Retain the reference's predominantly light, neutral composition.
2. Keep secondary buttons and most text neutral. Blue must indicate hierarchy, action or selection; it must not cover every surface.
3. Keep profit and loss semantic: green for positive P&L and red for negative P&L. Do not recolor those values blue. Use reference-consistent readable shades and verify contrast.
4. Use cobalt for the main equity/performance series. Use distinguishable neutral or secondary treatments for benchmarks and the rules-only twin; provide a legend and line-style differences.
5. Use `primary-soft` behind selected content with dark text or cobalt emphasis. Do not use pale blue as small text on white.
6. Verify contrast, visible focus, hover, disabled and error states. Preserve keyboard navigation and reduced-motion behavior.
7. Use Covar as the product name. Pending logo/domain decisions do not block the design-token implementation. Use clearly marked temporary assets where needed in development.

### CSS tokens

```css
:root {
  --background: #F7F8FC;
  --surface: #FFFFFF;
  --foreground: #171C2B;
  --primary: #3B5BDB;
  --primary-hover: #2F49B5;
  --primary-soft: #EDF1FF;
  --border: #E3E7EF;
}
```

Adapt variable syntax to the existing styling system without changing these approved values. Define additional semantic tokens only as needed; do not silently replace the palette with generic framework blue defaults.

## 4. Robinhood Chain reference — network, deployment and admin model

### Testnet vs mainnet — two modes, testnet is mandatory first

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | `46630` | `4663` |
| Gas token | ETH (testnet) | ETH |
| RPC | `https://rpc.testnet.chain.robinhood.com` | `https://rpc.mainnet.chain.robinhood.com` (rate limited — use a production provider, do not rely on the public RPC for production load) |
| Explorer | official testnet explorer (check `docs.robinhood.com/chain/`) | `https://robinhoodchain.blockscout.com` |
| Funds | faucet/test funds, no real value | real funds, real value |

**Mandatory sequence:**

```
1. Deploy every contract (.sol) to TESTNET first
2. Run the full test suite — unit, integration, and this brief's acceptance criteria (Section 15)
3. Validate the complete flow end to end: deposit -> trade/execute -> withdraw, success and failure cases
4. Only after everything passes cleanly on testnet -> migrate to MAINNET
5. Initial mainnet launch uses small controlled value, not full scale
```

Never deploy to mainnet before testnet passes completely. This is not just about saving gas — a contract bug that is still undiscovered on testnet can mean real user funds lost on mainnet.

### RPC access — use a VPN

Robinhood Chain RPC endpoints (testnet and mainnet) are frequently blocked by local ISPs (notably Indonesian ISPs). Before debugging "why is RPC not working," enable a VPN and retry — only treat it as a genuine endpoint/provider issue if it still fails with a VPN active. This applies to local development and to any CI/testing environment running from the same network; production hosting needs its own check for the same kind of blocking depending on provider/region.

### Token and contract addresses

| Token | Address | Notes |
|---|---|---|
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 decimals — verify code and decimals on-chain before relying on this table |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | 18 decimals — verify the same way |

Always recheck `https://docs.robinhood.com/chain/contracts/` before production deployment — addresses can differ between testnet and mainnet.

### Admin / ownership model — single wallet, not multisig

Covar uses a **single wallet admin**, not multisig — consistent with the precedent already used on the Counter project.

- The same wallet is used as admin/owner on both testnet and mainnet (do not switch wallets between environments).
- This means **no threshold approval** from multiple signers for admin actions (upgrades, pause, fee recipient changes, etc.) — one private key holds full control.
- Implication for development: do not assume any multisig-voting delay exists in your testing flow. If a delay/timelock is actually needed, implement it at the contract level (a timelock contract), not by relying on multisig social consensus.
- **Risk to document for the owner:** single wallet = single point of failure. If that private key is leaked or lost, every contract it controls (treasury, fee recipient, upgrade authority) is compromised too. Record this as an accepted, deliberate risk in the security/handover documentation — not an oversight.

## 5. Reference capture and parity register

Before implementation, capture accessible reference pages and interaction states on desktop and mobile. Create a register with: reference URL, screen/state, screenshot, observed behavior, dependency, our implementation, acceptance evidence and unresolved question.

Primary areas observed in the reference:

| Area | Reference route | Required behavior |
|---|---|---|
| Landing | `/` | Product explanation, example strategy conversation, build/follow explanation, FAQ and application entry |
| Discover | `/explore` | Agent list, filtering/sorting, performance provenance and agent detail navigation |
| My Agents | `/studio` | Create, edit, manage, test and operate agents |
| Agent creation | `/studio?new=1` | AI access check and new strategy flow |
| My Money | `/portfolio` | Accounts, vault holdings, deposits, withdrawals and pending activity |
| Agent detail | `/agents/[id]` | Record, activity, decisions, risk, versions, vault and investment flow |
| Creator record | `/creators/[id]` | Public history of agents, including unsuccessful live agents |
| Agent token | `/coins/[id]` | Agent-token information and supported external launch/trading links |
| Docs | `/docs` | Product operation, risks, fees and setup guidance |
| Economics | `/economics` | Revenue flows, token relationships and staking status |
| Treasury | `/treasury` | Actual receipts, allocations, buybacks and burns |

These routes are reference observations, not proof that every feature is operational. Wallet-dependent states still need a controlled inspection. Never invent a flow because its public page was unavailable.

## 6. Core journeys

### Creator

Connect or sign in using the reference-equivalent onboarding; describe an idea; generate structured rules; inspect and edit the draft through chat, visual controls or code mode; review changes; backtest; practice; publish a version; prepare the trading account and funding; start live execution; inspect decisions, positions, performance and fees.

Keep drafts and published versions distinct. Implement version changes, position handling, investor notice and optional creator approval according to the confirmed reference behavior. Changes must be traceable.

### Investor

Browse agents; inspect the live record and data provenance; review strategy description, risk, fees and version/adaptation policy; connect/sign in; fund the chosen vault; inspect holdings; request withdrawal; track position closure and settlement; claim available funds.

Each investor action must show the applicable asset, network, fee, pending state and settlement conditions before authorization. A withdrawal request is distinct from an instantly completed withdrawal.

### Operator

Monitor market feeds, agent processes, signer, exchange accounts, vault operations, queues, AI usage and treasury. Pause new risky activity when required while retaining the supported exit/claim path. Reconcile after a restart without placing duplicate orders or paying fees twice.

## 7. Feature parity matrix

| Module | Required deliverables |
|---|---|
| Strategy builder | Natural-language creation, typed strategy schema, chat edits, visual editor, code mode, validated diff and draft persistence |
| Historical testing | Data ingestion, deterministic replay, indicators, spread/slippage/fee/funding assumptions, result charts and reproducible reports |
| Practice | Live prices, simulated money, explicit setup/start/stop, isolated practice ledger and clear labeling |
| Test-money trading | Real test-exchange orders, account setup and test funding; never mixed with practice or real-money records |
| Live trading | Account provisioning, order placement/cancel, fill and position reconciliation, funding and trading-cost accounting |
| AI Copilot | Allowed trade decisions, bounded sizing/stop/target choices, contextual tools, credit usage and reference-equivalent fallback |
| Risk engine | Independent order checks, allowed markets, leverage/size caps, loss pauses, drawdown stop and close-only emergency actions |
| Strategy lifecycle | Versions, change history, research/retuning, side-by-side practice and approval/notice behavior matching the reference |
| Discovery | Agent ranking/sorting, age, TVL, return, drawdown, score, creator and status |
| Agent detail | Performance, decisions, activity summaries, private/public rule visibility, versions, risk and vault details |
| Vaults | Deposits, valuation, ownership shares, withdrawals, claims, fees, emergency handling and public contract references |
| Creator economics | Reference fee selection, winning-trade fee calculation, allocations, earnings and settlement history |
| AI credits | Orbio integration or explicitly agreed compatible dependency; estimates, reservation, actual usage and reconciliation |
| Token features | Reference platform/agent-token relationships, metadata, launch integration, economics and correct live/coming-soon status |
| Treasury/staking | Actual fee accounting, buyback/burn evidence, distribution and staking implementation when part of the reference target |
| Notifications | Trade, fill, risk, AI decision and status alerts through the channels actually implemented |
| Documentation | Setup, fees, custody/authority, failure behavior, recovery and operator runbooks |

Do not collapse practice, test exchange and mainnet into one mode with a changed label. Each needs its own funds, data provenance and execution adapter.

## 8. Proposed technical architecture

This is implementation guidance for our product; it is not a claim about Sharpe's private codebase.

- **Web:** Next.js, React and TypeScript. Follow the reference interaction and layout. GSAP/ScrollTrigger/Lenis may support restrained landing motion where useful; avoid animation that changes the reference's calm character or obstructs trading.
- **Strategy service:** versioned structured rules, validation, indicators, allowed actions and deterministic evaluation.
- **Backtest workers:** isolated reproducible jobs with pinned dataset, strategy version and execution-cost assumptions. Include out-of-sample checks without presenting them as a profit guarantee.
- **Market service:** historical/live Lighter adapters, feed freshness, reconnect, timestamp handling and market metadata.
- **Execution service:** durable intent-to-order state, exchange IDs, nonce handling, fills, positions and restart reconciliation.
- **Risk service:** checks every order independently of AI output and strategy code. Record approvals/rejections and current risk state.
- **Signer:** isolated trading authority with strict destination/permission constraints and audited request boundaries. AI and creators must not receive trading secrets.
- **Contracts:** independently implemented vaults and required settlement/economics components, with reviewed exchange ownership/funding/withdrawal integration.
- **Application storage:** durable database for users, agents, versions, runs, orders, ledger, vault operations, jobs, credits and notifications; queues for background work.
- **Indexer:** canonical chain events, block hashes, confirmation policy, reorg rollback/replay and deployment separation.
- **Provider integration:** Orbio/AI and research tooling through documented interfaces, permission checks, usage bounds and error reconciliation.

Do not assume a generic trading API supports the exact vault ownership and withdrawal restriction claimed by the reference. Prove the complete deposit-to-account-to-withdrawal path early.

## 9. AI and risk behavior

Translate natural language into a validated strategy representation. Reject unsupported or contradictory conditions rather than inventing executable rules. Do not let generated text directly execute unrestricted code or orders.

Match the confirmed reference configuration for Copilot decisions, optional additional trades, fallback, rules-only twin and adaptation. Record strategy version, market inputs, proposed action, AI decision, risk decision, order and outcome for each operation.

Reference documentation describes platform ceilings of 5x leverage, a daily pause at 10% loss and an emergency stop at 25% drawdown; an agent can use tighter limits. Verify exact accounting and current behavior before implementing these as parity defaults. Loss boundaries are triggers, not guarantees of maximum realized loss during gaps or execution failure.

Distinguish controls enforced by contracts, signer permissions, exchange settings and our server. Do not advertise server-side checks as immutable on-chain guarantees. AI-credit exhaustion must not disable independent risk controls or exits.

## 10. Vaults, execution and custody requirements

Implement a separate agent vault/account relationship as confirmed by the reference. Define supported collateral, decimals, share pricing, valuation source, pending deposits, withdrawal requests and final claims precisely.

Required invariants:

- Investor deposits/withdrawals are capital flows, not trading profit or loss.
- Shares cannot be minted or redeemed against stale or manipulable account values.
- Pricing protection, refund and timeout behavior is explicit.
- Withdrawal position closure and exchange payout are tracked before claim completion.
- Trading authority cannot redirect withdrawals to an arbitrary operator/creator address.
- Emergency close and wind-down routes work under the supported failure conditions.
- Upgrade, administrator and exchange authority are documented accurately.

Our operational keys must be independent of Sharpe's. Never reuse a reference contract, account or fee recipient as our deployment merely because it is already available.

## 11. Performance and public records

Preserve the reference's data categories while making their provenance visible: historical backtest, live-price practice, test exchange, real-money run and vault share-price record.

Record methodology and source for APR, return, score, drawdown, trade count, live age and TVL. A high backtest return must never be presented as realized live return. Follow the reference sorting and ranking behavior after verifying formulas; do not substitute a guessed score under the same name.

Creator histories must retain unsuccessful live agents. Strategy summaries and AI-written activity reports must be grounded in the event log. No fabricated trades, AUM, customers, performance or proof transactions.

## 12. Economics — preserve reference behavior first

The earlier suggestion to change performance fees to a high-water-mark model is **not approved for this parity release**. Keep it in a later-ideas backlog. Implement the reference economics after verifying all edge cases.

Reference documentation reviewed on 2 November describes:

- Deposit/withdrawal fee: 1% plus 0.10 USDG, with different treatment for the creator's own funds.
- Creator-selected fee up to 20% of the profit of each winning trade, with an 80/20 creator/platform split of that fee.
- Losing trades are not netted against winning-trade fees.
- AI usage incurs provider/model costs and an application fee.
- Economics/token pages describe additional allocations, agent-token fees, buyback/burn and staking, with some features still marked coming soon.

These are reference observations, not proof of deployed accounting. Before production, produce an approved parameter table covering fee bases, rounding, decimals, recipients, exempt cases, charging time, token allocations and pending obligations. Owner must confirm our final production addresses and identifiers.

User deposits, trading collateral, escrowed withdrawals and unused service credits are liabilities/assets under management, not platform revenue. Separate gross receipts, provider/exchange costs, creator fees, treasury share, buyback and distributable amounts.

## 13. Reference maturity and evidence limits

The review encountered inconsistent status labels: the landing page described Follow as coming soon, while a public agent page displayed an open vault and a short real-money record. Discovery also used backtest figures for young agents. Treat this as a capture/version issue to resolve during implementation.

A public repository and license allowing a direct Sharpe code fork were not established in the review. Do not assume source availability. Reuse only code whose license and provenance have been verified; otherwise implement the behavior independently under our brand.

No independent audit, full end-to-end financial verification or verification of Sharpe's internal system is established by this brief. Our own test and deployment evidence must prove our implementation.

## 14. Delivery sequence

| Milestone | Reviewable output |
|---|---|
| A — Reference baseline | Screen/state captures, feature register, external dependency review and verified scope |
| B — UI and builder | Reference-equivalent app shell and cobalt tokens, drafts, editor/chat and strategy validation |
| C — Testing and practice | Reproducible backtest, live-price practice, results and labeled public records |
| D — Exchange and risk | Controlled test trading, isolated signer, order reconciliation and independent limits |
| E — Vault/investor path | Own contracts, valuation, funding, withdrawal, fee and emergency flows |
| F — Full suite | Discovery, agent/creator records, Copilot, lifecycle, tokens/economics, treasury and alerts |
| G — Release evidence | Security findings addressed, full acceptance demos, deployment manifest and runbooks |

Estimate after milestone A with named owners, dependencies, external costs and uncertainty. Do not treat these milestones as permission to claim the full platform is live after only the web UI works.

## 15. Acceptance criteria

### Visual acceptance

- Approved color values are implemented through shared tokens, including `#3B5BDB` and `#2F49B5`.
- Hero, cards, navigation, tables, charts, builder and dialogs follow captured reference structure and hierarchy.
- Primary/secondary actions, active state, hover, focus, disabled, error and loading treatments are consistent.
- P&L remains semantically green/red and readable.
- Desktop/mobile flows work; keyboard access and reduced motion are supported.
- Our identity is used publicly; reference identifiers appear only where required as technical references or attribution.

### Functional acceptance

- A user creates a strategy through chat, reviews a diff, edits it, backtests it and starts/stops practice.
- Practice, test money and real money never share misleading balances or performance labels.
- Test/live orders are bounded, idempotent and reconciled after disconnect/restart.
- Copilot stays within its permissions; invalid output, unavailable credits and provider errors follow the verified fallback.
- A creator publishes/changes versions with the required investor notice and position handling.
- An investor deposits, receives correctly valued ownership, requests withdrawal and claims the correct settled amount.
- Trading fees, creator/platform allocations and AI charges reconcile to actual activity.
- Emergency risk and vault exit paths are demonstrated under failure conditions.
- Discovery, records and treasury display real data with provenance and actual transaction links.
- Token/staking features are either implemented as accepted scope or explicitly recorded as pending reference features; a decorative page is not a completed settlement system.

### Handover

Deliver source repositories, dependency/license inventory, architecture, schema/API documentation, exact deployment manifest, test results, screen/state parity register, operator configuration, reconciliation reports, recovery/incident runbooks and a list of unresolved decisions. Transfer secrets through a secure mechanism, never in this file or a public repository.

## 16. Scope control and pending decisions

No additional feature, revised fee model, new chain, new venue or new token utility is approved merely because it appeared in an earlier brainstorming recommendation. Complete the agreed reference product first; track enhancements separately.

Confirmed product name: **Covar**. Pending owner decisions: domain/logo, social handles, protocol-token identifiers, production recipients/privileges, provider billing accounts and operational budget. These do not block reference capture, UI color implementation or non-production development.

## 17. Reference links

- Product: https://www.sharpe.ac/
- Documentation: https://www.sharpe.ac/docs
- Discover: https://www.sharpe.ac/explore
- Studio: https://www.sharpe.ac/studio
- Economics: https://www.sharpe.ac/economics
- Treasury: https://www.sharpe.ac/treasury
- Lighter documentation: https://docs.lighter.xyz/
- Orbio: https://www.orbio.so/
- Robinhood Chain documentation: https://docs.robinhood.com/chain/

**Developer instruction:** build Covar using Sharpe as the functional/UI baseline, implement the complete verified flow under the Covar identity, and apply the approved cobalt palette with minimal layout deviation. Add differentiating features only after parity is reviewable.
