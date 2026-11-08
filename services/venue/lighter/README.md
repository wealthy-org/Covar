# Lighter venue adapter

Live venue for the execution service (`VENUE_ADAPTER=live`). Default exchange:
**Lighter on Robinhood Chain** — collateral is USDG on Robinhood Chain, the same
asset the Covar vault holds.

| File | What |
|---|---|
| `client.ts` | REST client + config (base URL and signing chain ID always travel together) |
| `signer.ts` | Loads the official lighter-go signer (WASM) |
| `lighter-signer.wasm.gz` | lighter-go `wasm/` built with Go 1.26.0 at commit `aefa96848a105d82a6bbb55d3d05663293a71713` (Apache-2.0), gzipped |
| `wasm_exec.cjs` | Go's JS glue from the same Go version (BSD) |

## Environment (server only — never in chat or git)

| Variable | Example | Notes |
|---|---|---|
| `VENUE_ADAPTER` | `live` | `paper` is the default |
| `LIVE_TRADING_CONFIRM` | `yes` | required for `live` |
| `LIGHTER_NETWORK` | `rh-testnet` | `rh-testnet` · `rh-mainnet` · `zk-testnet` · `zk-mainnet` |
| `LIGHTER_MAINNET_CONFIRM` | `yes` | required for `rh-mainnet` / `zk-mainnet` |
| `LIGHTER_ACCOUNT_INDEX` | `12345` | from `GET /api/v1/account?by=l1_address&value=<wallet B>` |
| `LIGHTER_API_KEY_INDEX` | `4` | 4–156 or 158–254 (0–3 and 157 are reserved on RH) |
| `LIGHTER_API_PRIVATE_KEY` | `0x…` | the API key, not the wallet key |
| `LIGHTER_SLIPPAGE_BPS` | `50` | IOC worst-price buffer, 1–500 |

## Order policy

Limit + immediate-or-cancel at intent price ± `LIGHTER_SLIPPAGE_BPS`: nothing rests
on the book unattended and the worst price is bounded. `clientOrderIndex` =
sha256(clientOrderId) → uint48, so a retry after a crash finds the existing order
and adopts it.

Known limit (accepted, monitored): if the process dies after Lighter accepted a
`sendTx` but before the order is visible in `accountActiveOrders`/`accountInactiveOrders`,
a retry cannot see it and may send the same `clientOrderIndex` again. Orders are IOC
and bounded by the risk service's size limits, and the reconciliation job compares the
venue account's positions with the execution journal, alerting on any mismatch.

## Rebuild the signer

```bash
git clone https://github.com/elliottech/lighter-go && cd lighter-go
GOOS=js GOARCH=wasm go build -trimpath -o lighter-signer.wasm ./wasm/
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" wasm_exec.cjs
gzip -9 lighter-signer.wasm   # → lighter-signer.wasm.gz
```

## Tests

`pnpm test:lighter` (mock exchange, real signatures) · `LIGHTER_WIRE=1 pnpm test:lighter`
additionally sends a signed order with an unregistered key to the real RH testnet,
which must answer `21109 api key not found`.
