# Operator service (wallet B) + monitor

Packages 3.3 (automated operator) and 3.10 (monitoring/alerts) from `docs/GO_LIVE_RUNBOOK.md`.

```powershell
pnpm operator          # operator only (:4014)
pnpm monitor           # monitor only (:4015)
pnpm services          # whole plane; operator starts only when a vault address is set
pnpm test:operator     # 95 checks, incl. a live run against a local Hardhat node
```

## What one cycle does

1. **Reads** the vault (reported assets, shares, NAV age, limits, requests, liquidity,
   reserved claims) and wallet B (ETH for gas, USDG), plus venue equity.
2. **Computes** `NAV = vault USDG − reservedForClaims + venue equity + in-transit (+ wallet B USDG if enabled)`.
   Every term is read. If the venue cannot be read, **no NAV is reported**: a missing value is never counted as zero.
3. **Reports NAV** when the report is older than `maxNavAge/2` or when NAV moved by 50 bps or more.
   It **holds** the report and sends an alert when the move is above 500 bps or above the contract cap.
   A human has to look at moves that large.
4. **Withdrawals:**
   - `ClosingPositions`: closes the investor's share (request shares ÷ total shares) of every position with reduce-only intents through the execution service.
     The intent ids are deterministic (`wd-<investor>-<requestedAt>-<market>`), so a replay after a crash cannot double-close.
     Once the closes are terminal it calls `markPositionsClosed`.
   - `Settling`: calls `settleWithdrawal` at shares × the *fresh* NAV.
     If the vault is short of USDG it alerts with the exact amount to withdraw from the venue.
     With `OPERATOR_AUTO_FUND=yes` it first moves that amount from wallet B to the vault.
5. **Optional allocation** (`OPERATOR_AUTO_ALLOCATE=yes`, v2 only):
   - moves USDG above an idle reserve to the owner-set `tradingAccount`;
   - tracks the amount as *in transit* until the venue credits it, so NAV doesn't appear to drop;
   - the transit record survives restarts through the journal;
   - sends an alert if the venue still hasn't credited it after `OPERATOR_TRANSIT_TIMEOUT_SEC`.
6. **Gas check:** alerts when wallet B runs low on ETH.

Every plan, transaction and failure is written to `.covar-state/operator.jsonl`.
Before each transaction is sent, it is simulated; a revert is reported by its contract error name (e.g. `vault reverted: StaleNav()`).
If one action fails, the cycle stops so dependent actions (e.g. settle after report) never run on a bad state.

## Modes

| Setting | Effect |
|---|---|
| `OPERATOR_MODE=dry-run` (default) | Plans and journals only. No key needed (`OPERATOR_ADDRESS` enables gas/balance reads) |
| `OPERATOR_MODE=live` + `OPERATOR_PRIVATE_KEY` | Sends transactions. Refuses to start unless the key's address is the vault's `operator` |
| `OPERATOR_CHAIN=mainnet` | Additionally needs `OPERATOR_MAINNET_CONFIRM=yes` |

## Lighter RH return path (custody note)

Withdrawing from Lighter pays out to the L1 address that owns the Lighter account.
For the vault that address is wallet B, and the funds go from B to the vault.
While capital sits in B it is under single-key custody. This is an accepted risk under the brief's single-wallet rule, and it is documented here and in the runbook.
Keep B holding vault capital only if you enable `OPERATOR_WALLET_IN_NAV`/`OPERATOR_AUTO_FUND`.

**Testnet caveat:** Lighter RH *testnet* is not on Robinhood testnet 46630. The 46630 vault cannot fund it.
On testnet, use `OPERATOR_VENUE=none`, or use `manual` with a separately funded Lighter testnet account (trading rehearsal only).
The full vault → Lighter → vault loop exists only on mainnet 4663, where Lighter RH uses the same USDG.

## Monitor (3.10)

The monitor is independent of the operator. It polls each service's `/health` and reads the vault over its own RPC connection.
It pages once when a problem starts and once when it resolves; `ALERT_COOLDOWN_SEC` stops repeats.

It checks for:
- a service that is down (two failed polls in a row);
- an operator that is up but has stopped cycling;
- NAV getting old (75% of max age) or stale;
- a withdrawal still pending past the SLA (default 24 h);
- claims that the vault can no longer cover;
- low gas in wallet B;
- the vault in close-only or paused mode.

It sends a heartbeat every `MONITOR_HEARTBEAT_HOURS` (and at startup), so silence never means "all good" by accident.

Telegram setup:
1. Create a bot with @BotFather.
2. Send it one message.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
4. Put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env` on the server.
5. Check delivery with `curl -X POST http://127.0.0.1:4015/test-alert`, or in PowerShell with `Invoke-RestMethod -Method Post http://127.0.0.1:4015/test-alert`.

All alerts are also journaled in `.covar-state/alerts/alerts.jsonl`. The token is never written to it.
