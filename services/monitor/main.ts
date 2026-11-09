/**
 * Monitor entrypoint — `pnpm monitor` (also started by `pnpm services`).
 *
 *   MONITOR_TARGETS        name=url,... or known names (operator,indexer); default: execution plane + operator
 *   MONITOR_INTERVAL_SEC   poll interval (default 60)
 *   MONITOR_HEARTBEAT_HOURS  "still alive" message cadence (default 24, 0 = off)
 *   MONITOR_WITHDRAWAL_SLA_HOURS  pending withdrawal alert (default 24)
 *   + the vault read settings shared with the operator (OPERATOR_VAULT_ADDRESS,
 *     OPERATOR_CHAIN / OPERATOR_RPC_URL, OPERATOR_ADDRESS) and TELEGRAM_* for delivery.
 */
import "dotenv/config";
import path from "node:path";
import { serve } from "../shared/http";
import { createChainPort } from "../operator/chain";
import { alertSinkFromEnv } from "./alerts";
import { createMonitor, type Observation } from "./app";
import { parseTargets } from "./targets";

const env = process.env;
const PORT = Number(env.MONITOR_PORT || 4015);
const STATE_DIR = env.COVAR_STATE_DIR || path.join(process.cwd(), ".covar-state");
const INTERVAL = Math.max(10, Number(env.MONITOR_INTERVAL_SEC || 60));

const parsed = parseTargets(env.MONITOR_TARGETS);
for (const p of parsed.problems) console.warn(`[monitor] ${p}`);
const targets = parsed.targets;

function rpcUrl() {
  if (env.OPERATOR_RPC_URL) return env.OPERATOR_RPC_URL;
  const chain = env.OPERATOR_CHAIN || "testnet";
  if (chain === "mainnet") return env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
  if (chain === "local") return env.NEXT_PUBLIC_LOCAL_RPC || "http://127.0.0.1:8545";
  return env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
}

const vaultAddr = env.OPERATOR_VAULT_ADDRESS || env.NEXT_PUBLIC_COVAR_VAULT_ADDRESS;
const chain = vaultAddr ? createChainPort({ rpcUrl: rpcUrl(), vault: vaultAddr, operatorAddress: env.OPERATOR_ADDRESS }) : null;
const sink = alertSinkFromEnv(env, path.join(STATE_DIR, "alerts"));

async function observe(): Promise<Observation> {
  const services = await Promise.all(
    targets.map(async (t) => {
      try {
        const res = await fetch(`${t.url}/health`, { signal: AbortSignal.timeout(5000) });
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return { name: t.name, ok: res.ok, body, error: res.ok ? undefined : `HTTP ${res.status}` };
      } catch (e) {
        return { name: t.name, ok: false, error: (e as Error).message };
      }
    }),
  );
  let vault: Observation["vault"] = null;
  if (chain) vault = await chain.snapshot().catch((e: Error) => ({ error: e.message }));
  return { now: Date.now(), services, vault };
}

const hb = Number(env.MONITOR_HEARTBEAT_HOURS || 24);
const monitor = createMonitor({
  sink,
  observe,
  heartbeatMs: hb > 0 ? hb * 3600_000 : undefined,
  cfg: {
    withdrawalSlaSec: Number(env.MONITOR_WITHDRAWAL_SLA_HOURS || 24) * 3600,
    operatorStallMs: Math.max(5 * 60_000, Number(env.OPERATOR_INTERVAL_SEC || 60) * 3000),
  },
  summary: (o) => (o.vault && !("error" in o.vault) ? `reported NAV ${(Number(o.vault.reportedAssets) / 1e6).toFixed(2)} USDG, ${o.vault.requests.filter((r) => r.state === "ClosingPositions" || r.state === "Settling").length} pending withdrawal(s)` : "vault not configured"),
});

console.log(`[monitor] targets ${targets.map((t) => t.name).join(", ")} · vault ${vaultAddr ?? "(not configured)"} · alerts ${sink.describe} · every ${INTERVAL}s`);

const tick = () =>
  monitor
    .round()
    .then((r) => r.sent.length && console.log(`[monitor] sent ${r.sent.join(", ")}`))
    .catch((e) => console.error(`[monitor] round failed: ${(e as Error).message}`));

serve("monitor", PORT, [
  { method: "GET", path: "/health", handler: () => ({ body: { ok: true, lastRound: monitor.last()?.at ? new Date(monitor.last()!.at).toISOString() : null } }) },
  { method: "GET", path: "/state", handler: () => ({ body: { last: monitor.last(), failures: monitor.failures() } }) },
  {
    method: "POST",
    path: "/test-alert",
    handler: async () => ({ body: { result: await sink.send({ source: "monitor", level: "info", code: `TEST:${Date.now()}`, message: "Test alert from Covar monitor — delivery works." }) } }),
  },
]);

void tick();
setInterval(tick, INTERVAL * 1000);
