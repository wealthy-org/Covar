# Covar contracts (scaffold)

`CovarVault.sol` is the vault specification used by the app's investor flow
(deposit → NAV → withdrawal request → position closure → settlement → claim).
`MockUSDG.sol` is a test-only 6-decimal faucet token.

**Status: not compiled, not deployed, not audited in this workspace snapshot.**
The web app simulates the vault against this specification so the full path can be
reviewed end-to-end before any contract exists. Nothing here moves real value.

## Invariants the contract is written to hold

1. Shares are minted and redeemed only against a NAV inside `maxNavAge`
   (`StaleNav` otherwise) — no stale or manipulable pricing.
2. A single NAV report cannot move more than `maxNavChangeBps` (default 20%) —
   a bad push is rejected instead of repricing every holder.
3. Deposit and withdrawal fees follow reference behaviour: 1% + 0.10 USDG, capped
   by `setFees` so an owner mistake cannot set an arbitrary fee.
4. Withdrawal is a four-step state machine. Shares are escrowed on request, so
   they cannot be transferred or double-redeemed while positions are closing.
5. `claim()` pays only `msg.sender`. The trading operator can never redirect a
   withdrawal to an operator or creator address.
6. `settleWithdrawal` cannot promise funds the vault does not hold — it checks the
   vault balance before recording a claimable amount.
7. `pause()` / close-only never blocks `claim()`. Exits and claims stay open in an
   emergency; only new risk and new deposits stop.
8. Non-upgradeable. There is no admin authority to replace the vault logic under
   user funds.

## Deliberate, documented risks

- **Single owner wallet, no multisig** (brief §4). The same wallet is used on
  testnet and mainnet. A leaked or lost key compromises fee settings, operator
  assignment and pausing. If delay is wanted, add a separate timelock contract —
  do not rely on social consensus.
- **Operator trust.** NAV reporting and settlement are operator-authorised; the
  freshness window and deviation cap limit, but do not eliminate, operator error.
- **Loss triggers are not guarantees.** Daily-loss pause and drawdown stop are
  server-side and signer-side controls, not contract-enforced maximum loss caps.
- Losses realised between NAV reports are attributed at the next report. The
  reconciliation report must explain any gap between exchange balance and
  `reportedAssets`.

## Deployment sequence (mandatory)

```
1. Deploy MockUSDG + CovarVault to testnet 46630
2. Run unit + integration tests, then the acceptance criteria in the brief (§15)
3. Prove deposit → trade → withdraw, including failure and pause cases
4. Reconcile reportedAssets against the exchange account
5. Only then mainnet 4663, starting with a small controlled value
```

Verify token addresses before any deployment:
USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6 decimals),
WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (18 decimals) —
re-check `docs.robinhood.com/chain/contracts/` first.

> Note: Robinhood Chain RPC is frequently blocked by Indonesian ISPs. Enable a VPN
> before concluding an RPC failure is an endpoint problem.
