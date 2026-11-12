/**
 * Operator service entrypoint — `pnpm operator` (or as part of `pnpm services`).
 *
 * Dry-run by default: it computes and journals the plan every cycle and sends
 * nothing. Live mode needs OPERATOR_MODE=live AND OPERATOR_PRIVATE_KEY for the
 * wallet that the vault lists as `operator` (wallet B) — checked at boot.
 *
 *   GET  /health   liveness, mode, last cycle time
 *   GET  /state    last cycle report (plan, alerts, sent transactions)
 *   POST /cycle    run a cycle now
 *   GET  /journal  append-only operator journal
 */
import "dotenv/config";
import path from "node:path";
import { serve } from "../shared/http";
import { createOperator, type Alert, type OperatorConfig } from "./app";
import { createChainPort } from "./chain";
import { closePortFromEnv, equityPortFromEnv, usdgUnits } from "./venue";
import { alertSinkFromEnv } from "../monitor/alerts";

const env = process.env;
const PORT = Number(env.OPERATOR_PORT || 4014);
const STARTED_AT = new Date().toISOString(); // lets the monitor tell "just started" from "stalled"
const STATE_DIR = env.COVAR_STATE_DIR || path.join(process.cwd(), ".covar-state");
const INTERVAL = Math.max(10, Number(env.OPERATOR_INTERVAL_SEC || 60));
const live = env.OPERATOR_MODE === "live";

function rpcUrl() {
  if (env.OPERATOR_RPC_URL) return env.OPERATOR_RPC_URL;
  const chain = env.OPERATOR_CHAIN || "testnet";
  if (chain === "mainnet") {
    if (env.OPERATOR_MAINNET_CONFIRM !== "yes") throw new Error("OPERATOR_CHAIN=mainnet needs OPERATOR_MAINNET_CONFIRM=yes (only after the testnet soak passed)");
    return env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
  }
  if (chain === "local") return env.NEXT_PUBLIC_LOCAL_RPC || "http://127.0.0.1:8545";
  return env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
}

function config(): Partial<OperatorConfig> {
  const num = (k: string) => (env[k] === undefined || env[k] === "" ? undefined : Number(env[k]));
  const cfg: Partial<OperatorConfig> = {};
  if (num("OPERATOR_NAV_REFRESH_SEC") !== undefined) cfg.navRefreshSec = num("OPERATOR_NAV_REFRESH_SEC");
  if (num("OPERATOR_MIN_CHANGE_BPS") !== undefined) cfg.minChangeBps = num("OPERATOR_MIN_CHANGE_BPS");
  if (num("OPERATOR_MAX_AUTO_CHANGE_BPS") !== undefined) cfg.maxAutoChangeBps = num("OPERATOR_MAX_AUTO_CHANGE_BPS");
  if (env.OPERATOR_IN_TRANSIT_USDG) cfg.inTransit = usdgUnits(env.OPERATOR_IN_TRANSIT_USDG);
  cfg.autoFundFromOperatorWallet = env.OPERATOR_AUTO_FUND === "yes";
  if (env.OPERATOR_WALLET_IN_NAV) cfg.operatorWalletInNav = env.OPERATOR_WALLET_IN_NAV === "yes";
  if (num("OPERATOR_TRANSIT_TIMEOUT_SEC") !== undefined) cfg.transitTimeoutSec = num("OPERATOR_TRANSIT_TIMEOUT_SEC");
  cfg.autoAllocate = env.OPERATOR_AUTO_ALLOCATE === "yes";
  if (num("OPERATOR_IDLE_RESERVE_BPS") !== undefined) cfg.idleReserveBps = num("OPERATOR_IDLE_RESERVE_BPS");
  if (env.OPERATOR_MIN_ALLOCATE_USDG) cfg.minAllocate = usdgUnits(env.OPERATOR_MIN_ALLOCATE_USDG);
  if (env.OPERATOR_MIN_GAS_ETH) cfg.minGasWei = usdgUnits(env.OPERATOR_MIN_GAS_ETH) * 1_000_000_000_000n;
  return cfg;
}

async function main() {
  const vaultAddr = env.OPERATOR_VAULT_ADDRESS || env.NEXT_PUBLIC_COVAR_VAULT_ADDRESS;
  if (!vaultAddr) throw new Error("set OPERATOR_VAULT_ADDRESS (or NEXT_PUBLIC_COVAR_VAULT_ADDRESS)");
  if (live && !env.OPERATOR_PRIVATE_KEY) throw new Error("OPERATOR_MODE=live needs OPERATOR_PRIVATE_KEY (wallet B, server-side only)");

  // the testnet v2 vault and the mainnet vault share one address: make the chain explicit and checked
  const url = rpcUrl();
  const rpcChainId = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })
    .then((r) => r.json())
    .then((j: { result?: string }) => (j.result ? Number(BigInt(j.result)) : null))
    .catch(() => null);
  const wantChain = { mainnet: 4663, testnet: 46630, local: 31337 }[env.OPERATOR_CHAIN || "testnet"];
  console.log(`[operator] chain ${env.OPERATOR_CHAIN || "testnet"} · rpc ${url.replace(/\/v2\/.*$/, "/v2/…")} · chainId ${rpcChainId ?? "?"}`);
  if (wantChain && rpcChainId !== null && rpcChainId !== wantChain) {
    throw new Error(`OPERATOR_CHAIN=${env.OPERATOR_CHAIN || "testnet"} expects chain ${wantChain} but the RPC is chain ${rpcChainId} — remove OPERATOR_RPC_URL or fix it`);
  }

  const chain = createChainPort({ rpcUrl: url, vault: vaultAddr, privateKey: live ? env.OPERATOR_PRIVATE_KEY : undefined, operatorAddress: env.OPERATOR_ADDRESS });
  const roleProblem = await chain.checkRole();
  if (roleProblem && live) throw new Error(`refusing live mode: ${roleProblem}`);

  const venue = equityPortFromEnv(env);
  const close = closePortFromEnv(env);
  const sink = alertSinkFromEnv(env, path.join(STATE_DIR, "alerts"));
  const onAlert = (a: Alert) => {
    console.error(`[operator] ${a.level.toUpperCase()} ${a.code}: ${a.message}`);
    void sink.send({ source: "operator", ...a });
  };

  const op = createOperator({ dir: STATE_DIR, vault: chain, venue, close, cfg: config(), live, onAlert });
  console.log(`[operator] ${live ? "LIVE" : "dry-run"} · vault ${vaultAddr} · wallet ${chain.address ?? "(none)"} · venue ${venue.describe} · close ${close.describe} · alerts ${sink.describe} · every ${INTERVAL}s`);
  if (roleProblem) console.warn(`[operator] note: ${roleProblem} (dry-run continues)`);

  const run = async () => {
    try {
      const r = await op.cycle();
      const sent = r.sent.map((s) => `${s.kind}${s.hash ? ` ${s.hash}` : ""}${s.error ? ` ✗ ${s.error}` : ""}`).join(", ");
      console.log(`[operator] cycle · ${r.plan.actions.length} action(s)${r.plan.actions.length ? ` [${r.plan.actions.map((a) => a.kind).join(", ")}]` : ""}${sent ? ` · sent: ${sent}` : ""} · ${r.plan.alerts.length} alert(s)`);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("already running")) return;
      onAlert({ level: "critical", code: "OPERATOR_CYCLE_ERROR", message: msg });
    }
  };

  serve("operator", PORT, [
    { method: "GET", path: "/health", handler: () => ({ body: { ok: true, mode: live ? "live" : "dry-run", lastCycle: op.last()?.at ?? null, startedAt: STARTED_AT, vault: vaultAddr } }) },
    { method: "GET", path: "/state", handler: () => ({ body: op.last() ?? { note: "no cycle yet" } }) },
    { method: "POST", path: "/cycle", handler: async () => ({ body: await op.cycle() }) },
    { method: "GET", path: "/journal", handler: () => ({ body: op.journalEntries() }) },
  ]);

  await run();
  setInterval(run, INTERVAL * 1000);
}

main().catch((e) => {
  console.error(`[operator] refusing to start: ${(e as Error).message}`);
  process.exit(1);
});
