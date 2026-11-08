#!/usr/bin/env node
/**
 * One command for the on-chain investor E2E (cross-platform):
 *   1. fresh Hardhat node on :8545
 *   2. deploy MockUSDG + CovarVault v2 (deterministic addresses)
 *   3. temp SQLite DB, migrated
 *   4. Next dev server on :3000 wired to that vault (wallet provider = evm)
 *   5. Playwright: tests/e2e/invest.spec.ts
 * Everything is torn down afterwards. Nothing touches testnet or your dev DB.
 */
import { spawn, spawnSync } from "node:child_process";
import { HDNodeWallet } from "ethers";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const win = process.platform === "win32";
const procs = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "covar-e2e-invest-"));
const env = {
  ...process.env,
  DATABASE_URL: `file:${path.join(tmp, "e2e.db")}`,
  NEXT_PUBLIC_COVAR_VAULT_ADDRESS: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  NEXT_PUBLIC_RH_CHAIN_ID: "31337",
  NEXT_PUBLIC_LOCAL_RPC: "http://127.0.0.1:8545",
  NEXT_PUBLIC_WALLET_PROVIDER: "evm",
  STATE_ANON_MODE: "off",
  E2E_CHAIN: "1",
  E2E_NO_SERVER: "1",
  // 3.6 indexer (own state dir, pinned to the local node)
  INDEXER_VAULT_ADDRESS: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  INDEXER_RPC_URL: "http://127.0.0.1:8545",
  INDEXER_PORT: "4016",
  INDEXER_URL: "http://127.0.0.1:4016",
  INDEXER_POLL_MS: "1000",
  COVAR_STATE_DIR: path.join(tmp, "state"),
  // 3.7 credits: real USDG top-ups on the local chain (treasury = Hardhat account #5)
  CREDITS_MODE: "enforce",
  CREDITS_CHAIN_ID: "31337",
  CREDITS_RPC_URL: "http://127.0.0.1:8545",
  CREDITS_USDG_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  CREDITS_TREASURY_ADDRESS: HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, "m/44'/60'/0'/0/5").address,
  CREDITS_MIN_CONFIRMATIONS: "1",
};

// Server output goes to files (and is always drained). The parent must never block
// while servers run: on Windows a child writing to a full, unread stdout pipe stalls —
// Hardhat then stops answering RPC mid-test. So spawnSync is only used before the
// servers start (port check) and after they are killed (taskkill).
const logDir = "e2e-logs"; // not under test-results/: Playwright wipes that folder at start
fs.mkdirSync(logDir, { recursive: true });

function start(name, cmd, args, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, shell: win, detached: !win, stdio: ["ignore", "pipe", "pipe"] });
    procs.push(p);
    const log = fs.createWriteStream(path.join(logDir, `${name}.log`));
    p.stdout.pipe(log, { end: false });
    p.stderr.pipe(log, { end: false });
    const t = setTimeout(() => reject(new Error(`${name} not ready in 180s`)), 180_000);
    const onData = (d) => {
      if (/Port \d+ is in use|EADDRINUSE/.test(d.toString())) {
        clearTimeout(t);
        reject(new Error(`${name}: port already in use — stop the other server and retry`));
        return;
      }
      if (ready.test(d.toString())) {
        clearTimeout(t);
        resolve(p);
      }
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("exit", (c) => reject(new Error(`${name} exited (${c})`)));
  });
}

function stopAll() {
  for (const p of procs) {
    try {
      if (win) spawnSync("taskkill", ["/pid", String(p.pid), "/t", "/f"]);
      else process.kill(-p.pid, "SIGTERM");
    } catch {
      /* gone */
    }
  }
}

/** Something already answering on 127.0.0.1:port? (also catches a `pnpm dev` bound to 0.0.0.0) */
const portBusy = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.setTimeout(1500);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("timeout", () => (s.destroy(), resolve(false)));
    s.once("error", () => resolve(false));
  });

function ownerHint(port) {
  if (!win) return `lsof -i :${port}`;
  const r = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
  const pids = new Set(
    (r.stdout || "")
      .split(/\r?\n/)
      .filter((l) => /LISTENING/.test(l) && new RegExp(`:${port}\\s`).test(l))
      .map((l) => l.trim().split(/\s+/).pop())
  );
  return pids.size ? `PID ${[...pids].join(", ")} → Stop-Process -Id ${[...pids].join(",")} -Force` : "netstat -ano | findstr :" + port;
}

async function assertPortsFree() {
  const names = { 3000: "Next (stop `pnpm dev`)", 8545: "Hardhat node", 4016: "indexer (stop `pnpm services`)" };
  const busy = [];
  for (const port of [3000, 8545, 4016]) if (await portBusy(port)) busy.push(port);
  if (!busy.length) return;
  console.error("\n✘ Port(s) already in use — this E2E must start its own servers on them:");
  for (const port of busy) console.error(`   :${port}  ${names[port]}  — ${ownerHint(port)}`);
  console.error("   A second Next dev server shares .next and breaks the run halfway. Stop them and retry.\n");
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

/** Run a one-shot command to completion WITHOUT blocking the event loop (servers keep being drained). */
const run = (cmd, args) =>
  new Promise((resolve) => {
    const c = spawn(cmd, args, { env, stdio: "inherit", shell: win });
    c.on("exit", (code) => resolve(code ?? 1));
    c.on("error", () => resolve(1));
  });

await assertPortsFree();

let code = 1;
try {
  console.log("· Hardhat node :8545");
  await start("hardhat", process.execPath, ["scripts/hardhat.mjs", "node", "--hostname", "127.0.0.1", "--port", "8545"], /Started HTTP/);
  console.log("· deploy fixture");
  if ((await run("npx", ["tsx", "tests/e2e/support/chain.ts"])) !== 0) throw new Error("fixture deploy failed");
  console.log("· indexer :4016");
  await start("indexer", "npx", ["tsx", "services/indexer/main.ts"], /listening on/);
  console.log("· migrate temp DB");
  if ((await run("npx", ["prisma", "migrate", "deploy"])) !== 0) throw new Error("migrate failed");
  console.log("· Next dev :3000");
  await start("next", "npx", ["next", "dev", "-H", "127.0.0.1", "-p", "3000"], /Ready in|started server|Local:/);
  // Next dev compiles each route on first visit — slow on Windows. Warm every route the
  // spec visits up front so test assertions measure the app, not the compiler.
  console.log("· warming pages (first compile)");
  for (const route of ["/explore", "/agents/covar-vault", "/portfolio", "/treasury", "/studio", "/chain/console", "/api/vault/summary", "/api/credits", "/api/auth/session"]) {
    const t0 = Date.now();
    try {
      const r = await fetch(`http://127.0.0.1:3000${route}`, { signal: AbortSignal.timeout(180_000) });
      await r.arrayBuffer();
      console.log(`  ${route} ${r.status} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.log(`  ${route} — ${e.name ?? e.message} after ${((Date.now() - t0) / 1000).toFixed(1)}s (continuing)`);
    }
  }
  code = await run("npx", ["playwright", "test", "tests/e2e/invest.spec.ts", ...process.argv.slice(2)]);
  if (code !== 0) console.error(`\nServer logs: ${logDir}${path.sep}{hardhat,indexer,next}.log`);
} catch (e) {
  console.error(e.message);
} finally {
  stopAll();
  // Windows keeps the SQLite file locked for a moment after taskkill: retry, never fail the run on cleanup
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (e) {
    console.warn(`(could not remove ${tmp}: ${e.code ?? e.message} — safe to delete by hand)`);
  }
}
process.exit(code);
