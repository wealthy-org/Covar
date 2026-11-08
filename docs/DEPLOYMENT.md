# Deployment runbook — CovarVault

Everything here is ordered by the brief (§4). **Testnet first, always.** A contract bug found on
testnet costs nothing; the same bug on mainnet costs user funds.

## 0 — What is verified as of 4 Nov 2026

| Fact | Evidence |
|---|---|
| `46630` is reachable and reports chain id `0xb626` (46630) | `npm run preflight:testnet` |
| `4663` reports `0x1237` (4663) | raw `eth_chainId` |
| USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` → symbol `USDG`, 6 decimals | `eth_call` on **mainnet** |
| WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` → symbol `WETH`, 18 decimals | `eth_call` on **mainnet** |
| **Both token addresses have no bytecode on testnet 46630** | `eth_getCode` → `0x` |
| Several impostor tokens use the ticker `USDG` on testnet | testnet explorer search |

**Consequence:** the brief's token table is a mainnet table. The testnet collateral token must be
confirmed by the owner against the official testnet token page before any deposit can work. A matching
ticker at a different address is *not* the same token — this is the exact mistake that drains vaults.

## 1 — Local rehearsal (no chain, no funds)

```bash
node scripts/hardhat.mjs node        # terminal 1
npm run deploy:local                                          # terminal 2
# prints: NEXT_PUBLIC_COVAR_VAULT_ADDRESS=0x… NEXT_PUBLIC_RH_CHAIN_ID=31337

NEXT_PUBLIC_COVAR_VAULT_ADDRESS=0x… NEXT_PUBLIC_RH_CHAIN_ID=31337 npm run dev
```

The deploy script runs one real investor cycle (report NAV → deposit → NAV move → withdrawal request →
positions closed) so the UI has contract state to display. `/chain` flips from **Simulated** to
**On-chain** and shows NAV, reported assets, shares, fee parameters, pause flags, owner/operator/fee
recipient read straight from the contract.

Verified in this workspace: NAV `1.0816`, reported assets `2,141.38 USDG`, shares `1,979.9`,
owner/operator/fee recipient decoded correctly, NAV freshness shown in seconds.

## 2 — Contract suite

```bash
npm run test:contracts     # 18 assertions on the local EVM
npm run test               # 25 engine assertions (strategy, backtest, fees)
npm run test:services      # 39 execution-plane assertions (idempotency, risk, crash recovery)
npm run demo:reconcile     # 20 assertions across real processes (kills the execution service mid-window)
```

The execution plane (`services/`, ports 4010–4013) is what a live trading adapter will plug into. Its
venue is a **paper matcher** today — the runbook, journal event table and crash evidence are in
[`EXECUTION_PLANE.md`](EXECUTION_PLANE.md). The testnet stage (3) is not complete until the same
crash/restart rehearsal passes against a real testnet venue adapter — the paper venue cannot be the
last thing between an agent and real test funds.

The suite covers the §10 invariants: no mint/redeem against a stale NAV, NAV deviation cap, fee caps,
withdrawal state machine, double-request protection, settlement cannot exceed vault balance, claims pay
the investor only, pause never blocks claims, single-owner authority boundaries.

## 3 — Testnet deployment (46630)

```bash
export DEPLOYER_KEY=…              # funded with testnet ETH, never committed
export OPERATOR_ADDRESS=0x…        # isolated trading authority, separate wallet
export FEE_RECIPIENT_ADDRESS=0x…   # separate from operator (script enforces this)
export USDG_ADDRESS=0x…            # confirmed testnet collateral, verified below

npm run preflight:testnet          # must print "Preflight passed"
npm run deploy:testnet             # writes deployments/46630.json
```

Testnet ETH: use the official Robinhood Chain faucet, or the Chainlink / QuickNode / Chainstack faucets.
Eligibility rules vary (some require an Ethereum-mainnet history) — this is why the deployment cannot be
finished from a sandbox without your funded key.

After deploying:

1. `reportNav` the first NAV from the operator wallet.
2. Deposit 10 USDG from a second wallet and confirm shares mint at the reported NAV.
3. Request a withdrawal, close positions, settle, claim — confirm the investor receives exactly
   `settledAssets` and the fee recipient receives the fee.
4. Pause deposits and confirm `claim()` still works.
5. Reconcile `reportedAssets` against the exchange account before advertising anything.
6. Verify source on `explorer.testnet.chain.robinhood.com`.

## 4 — Mainnet (4663) — only after 3 passes

```bash
export CONFIRM_MAINNET=yes         # the script refuses without this
npm run preflight:mainnet
npm run deploy:mainnet
```

First mainnet launch uses a **small controlled value**, not full scale.

## Guard rails built into the scripts

- `deploy.ts` aborts when the collateral token has no bytecode or decimals ≠ 6.
- `deploy.ts` aborts when operator and fee recipient are the same wallet.
- `deploy.ts` aborts on mainnet without `CONFIRM_MAINNET=yes`.
- `deploy.ts` aborts when the deployer has zero gas.
- `preflight.ts` refuses to inherit mainnet token addresses on testnet.
- `CovarVault` caps fee changes (≤5%, ≤10 USDG flat), NAV age (5 min–24 h) and single-report NAV
  deviation (≤50%), so a compromised or mistaken owner key cannot reprice every holder in one call.

## Secrets

`DEPLOYER_KEY`, provider keys and RPC credentials never belong in this repository, a chat message, or a
screenshot. Use a secret manager or a shell session. The single-owner model means one leaked key
compromises treasury, fee recipient and operator assignment — that risk is accepted and documented, not
mitigated by a multisig.
