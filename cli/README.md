# Covar CLI (clip 10)

```powershell
node cli/run.js            # or: pnpm cli
node cli/run.js --fast     # no pacing
node cli/run.js --only 4,6 # selected steps
```

A read-only tour of the production stack. No key is read and no transaction is sent. Every value is fetched at run time.

| Step | What it shows | Source |
|---|---|---|
| 1 Live RPC pulse | chain id, head, latency p50/min/max, gas, block age for two independent endpoints, plus the full vault parameter table | Robinhood Chain JSON-RPC: `rpc.mainnet.chain.robinhood.com` and `robinhood-rpc.publicnode.com` (chain 4663). `robinhood-sepolia-rpc.publicnode.com` is the 46630 testnet. |
| 2 Market data | BTC / ETH / SOL / HYPE-PERP mids, best bid/ask, spread, mid-vs-book check, sha256 of the raw response | Hyperliquid `POST /info` `allMids` + `l2Book`, fetched in one snapshot |
| 3 Strategy + risk | prompt → compiled strategy (10x request clamped to 5x), then 15 probes through the 7 gates: allowlist, leverage ≤ 5x, position ≤ 40%, daily loss 10%, drawdown 25%, signer clamp, Copilot ceiling | `cli/engine.ts` running the real `src/lib/strategy`, `services/risk`, `services/signer`; paper equity 10,000 USDG at the live ETH mid |
| 4 Settlement | the latest real withdrawal on the mainnet vault: request → markPositionsClosed → settleWithdrawal → claim, with signer roles, timing, fee math | vault events via `eth_getLogs` from the deploy block |
| 5 Crash + recovery | a real daemon process exits 137 after the venue accepted the order but before the ack was journaled; a new process replays the journal, adopts the order, dedupes the replayed intent | `cli/daemon.ts` running the real `services/execution` against the journaled paper venue (`services/exchange`, stand-in for Lighter) |
| 6 Deployment | manifest, receipt, constructor args, runtime code hash, Sourcify exact match, Sourcify bytecode = chain bytecode, checkout = deployed bytecode | `deployments/4663.json`, JSON-RPC, Sourcify v2 API, `artifacts/` |

Exit code: 0 when every check passes, 1 otherwise. Use Windows Terminal (or any truecolor terminal) for the cobalt gradient; `--no-color` / `NO_COLOR=1` for plain output.
