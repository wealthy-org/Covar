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

function start(name, cmd, args, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, shell: win, detached: !win, stdio: ["ignore", "pipe", "pipe"] });
    procs.push(p);
    const t = setTimeout(() => reject(new Error(`${name} not ready in 180s`)), 180_000);
    const onData = (d) => {
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

const run = (cmd, args) => spawnSync(cmd, args, { env, stdio: "inherit", shell: win }).status ?? 1;

let code = 1;
try {
  console.log("· Hardhat node :8545");
  await start("hardhat", process.execPath, ["scripts/hardhat.mjs", "node", "--hostname", "127.0.0.1", "--port", "8545"], /Started HTTP/);
  console.log("· deploy fixture");
  if (run("npx", ["tsx", "tests/e2e/support/chain.ts"]) !== 0) throw new Error("fixture deploy failed");
  console.log("· indexer :4016");
  await start("indexer", "npx", ["tsx", "services/indexer/main.ts"], /listening on/);
  console.log("· migrate temp DB");
  if (run("npx", ["prisma", "migrate", "deploy"]) !== 0) throw new Error("migrate failed");
  console.log("· Next dev :3000");
  await start("next", "npx", ["next", "dev", "-H", "127.0.0.1", "-p", "3000"], /Ready in|started server|Local:/);
  code = run("npx", ["playwright", "test", "tests/e2e/invest.spec.ts", ...process.argv.slice(2)]);
} catch (e) {
  console.error(e.message);
} finally {
  stopAll();
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);
