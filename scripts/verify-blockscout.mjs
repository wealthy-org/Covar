#!/usr/bin/env node
/**
 * Verify a deployed CovarVault on Blockscout (Robinhood Chain explorers).
 * Cross-platform, no extra dependencies, needs NO private key.
 *
 *   pnpm verify:testnet            → reads deployments/46630.json
 *   pnpm verify:mainnet            → reads deployments/4663.json
 *   node scripts/verify-blockscout.mjs <chainId> [address]
 *
 * Steps: compile (same settings as the deployment) → take the standard-JSON
 * input from artifacts/build-info → check the on-chain creation bytecode
 * matches before submitting → POST to Blockscout → poll until verified.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const EXPLORERS = {
  46630: { api: "https://explorer.testnet.chain.robinhood.com", rpc: process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com" },
  4663: { api: "https://robinhoodchain.blockscout.com", rpc: process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com" },
};
const clean = (v) => (v && !v.includes("<") && !v.includes("...") ? v : undefined);

const chainId = Number(process.argv[2] || 46630);
const cfg = EXPLORERS[chainId];
if (!cfg) fail(`Unknown chain ${chainId} (use 46630 or 4663)`);
cfg.rpc = clean(cfg.rpc) || (chainId === 4663 ? "https://rpc.mainnet.chain.robinhood.com" : "https://rpc.testnet.chain.robinhood.com");

const manifestPath = join("deployments", `${chainId}.json`);
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
const address = process.argv[3] || manifest?.address;
if (!address) fail(`No address: pass it as an argument or deploy first (${manifestPath} missing)`);

function fail(msg) {
  console.error(`\nVerification aborted: ${msg}\n`);
  process.exit(1);
}
async function rpc(method, params) {
  const r = await fetch(cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\nCovar · verify CovarVault on chain ${chainId}\n  address  ${address}\n  explorer ${cfg.api}`);

// 1 — compile with the repo's settings (cross-platform launcher)
execFileSync(process.execPath, ["scripts/hardhat.mjs", "compile", "--quiet"], { stdio: "inherit" });
const buildDir = join("artifacts", "build-info");
const build = readdirSync(buildDir)
  .map((f) => JSON.parse(readFileSync(join(buildDir, f), "utf8")))
  .find((b) => b.output?.contracts?.["contracts/CovarVault.sol"]?.CovarVault);
if (!build) fail("CovarVault build-info not found after compile");
const bytecode = "0x" + build.output.contracts["contracts/CovarVault.sol"].CovarVault.evm.bytecode.object;

// 2 — already verified?
const info = await fetch(`${cfg.api}/api/v2/addresses/${address}`).then((r) => r.json()).catch(() => ({}));
if (!info.is_contract) fail("no contract at this address on this chain (wrong chain or address?)");
if (info.is_verified) {
  console.log(`\n  ✓ already verified — ${cfg.api}/address/${address}?tab=contract\n`);
  process.exit(0);
}

// 3 — the creation input must start with our bytecode, else the source differs
const txHash = manifest?.address?.toLowerCase() === address.toLowerCase() ? manifest.txHash : info.creation_transaction_hash;
if (!txHash) fail("creation transaction unknown");
const tx = await rpc("eth_getTransactionByHash", [txHash]);
const input = (tx?.input || "").toLowerCase();
if (!input.startsWith(bytecode.toLowerCase())) {
  fail("on-chain bytecode differs from this checkout. Use the exact commit that was deployed (and check git did not convert line endings).");
}
const constructorArgs = input.slice(bytecode.length);
console.log(`  ✓ bytecode matches this checkout · constructor args ${constructorArgs.length / 64} words`);

// 4 — submit standard JSON input
const form = new FormData();
form.append("compiler_version", `v${build.solcLongVersion}`);
form.append("license_type", "mit");
form.append("autodetect_constructor_args", "false");
form.append("constructor_args", constructorArgs);
form.append("files[0]", new Blob([JSON.stringify(build.input)], { type: "application/json" }), "CovarVault.json");
const res = await fetch(`${cfg.api}/api/v2/smart-contracts/${address}/verification/via/standard-input`, { method: "POST", body: form });
const body = await res.text();
if (!res.ok) fail(`explorer rejected the request: HTTP ${res.status} ${body.slice(0, 200)}`);
console.log(`  … submitted (${body.slice(0, 80)})`);

// 5 — poll
for (let i = 0; i < 30; i++) {
  await sleep(4000);
  const s = await fetch(`${cfg.api}/api/v2/addresses/${address}`).then((r) => r.json()).catch(() => ({}));
  if (s.is_verified) {
    console.log(`\n  ✓ verified — ${cfg.api}/address/${address}?tab=contract\n`);
    process.exit(0);
  }
}
fail(`not verified after 2 minutes — check ${cfg.api}/address/${address}?tab=contract (it may still be processing)`);
