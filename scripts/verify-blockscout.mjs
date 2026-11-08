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
 * matches before submitting → Sourcify (public, chain 46630 + 4663 supported)
 * → Blockscout → poll until verified.
 *
 * Sourcify is the fallback when the explorer's own verifier is down (seen on
 * the testnet explorer 8 Nov 2026: Blockscout v10.2.6 with an empty compiler
 * list answered "Unable to verify"). A Sourcify exact match is a full public
 * verification; the run then exits 0 with a warning for Blockscout.
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
// the build-info the CovarVault artifact points to (older build-info files can linger)
const dbgPath = join("artifacts", "contracts", "CovarVault.sol", "CovarVault.dbg.json");
const build = existsSync(dbgPath)
  ? JSON.parse(readFileSync(join("artifacts", "contracts", "CovarVault.sol", JSON.parse(readFileSync(dbgPath, "utf8")).buildInfo), "utf8"))
  : readdirSync(buildDir)
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

// 4 — Sourcify (independent public verifier; Blockscout can read from it)
const SOURCIFY = "https://sourcify.dev/server";
const sourcifyStatus = async () => {
  const r = await fetch(`${SOURCIFY}/v2/contract/${chainId}/${address}`).catch(() => null);
  return r && r.ok ? (await r.json()).match : null;
};
let sourcify = await sourcifyStatus();
if (!sourcify) {
  try {
    const r = await fetch(`${SOURCIFY}/v2/verify/${chainId}/${address}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stdJsonInput: build.input, compilerVersion: build.solcLongVersion, contractIdentifier: "contracts/CovarVault.sol:CovarVault", creationTransactionHash: txHash }),
    });
    const j = await r.json();
    if (j.verificationId) {
      for (let i = 0; i < 30 && !sourcify; i++) {
        await sleep(3000);
        const st = await fetch(`${SOURCIFY}/v2/verify/${j.verificationId}`).then((x) => x.json()).catch(() => ({}));
        if (st.isJobCompleted) {
          sourcify = st.contract?.match ?? null;
          if (!sourcify) console.log(`  ✗ Sourcify: ${st.error?.message ?? "no match"}`);
          break;
        }
      }
    } else console.log(`  ✗ Sourcify rejected: ${JSON.stringify(j).slice(0, 160)}`);
  } catch (e) {
    console.log(`  ✗ Sourcify unreachable: ${e.message}`);
  }
}
const sourcifyUrl = `https://repo.sourcify.dev/${chainId}/${address}`;
if (sourcify) console.log(`  ✓ Sourcify: ${sourcify} — ${sourcifyUrl}`);

// 5 — Blockscout: submit standard JSON input
const form = new FormData();
form.append("compiler_version", `v${build.solcLongVersion}`);
form.append("license_type", "mit");
form.append("autodetect_constructor_args", "false");
form.append("constructor_args", constructorArgs);
form.append("files[0]", new Blob([JSON.stringify(build.input)], { type: "application/json" }), "CovarVault.json");
const res = await fetch(`${cfg.api}/api/v2/smart-contracts/${address}/verification/via/standard-input`, { method: "POST", body: form });
const body = await res.text();
if (!res.ok && !sourcify) fail(`explorer rejected the request: HTTP ${res.status} ${body.slice(0, 200)}`);
console.log(res.ok ? `  … Blockscout submitted (${body.slice(0, 80)})` : `  ✗ Blockscout rejected: HTTP ${res.status}`);

// 6 — poll Blockscout
for (let i = 0; i < 30; i++) {
  await sleep(4000);
  const s = await fetch(`${cfg.api}/api/v2/addresses/${address}`).then((r) => r.json()).catch(() => ({}));
  if (s.is_verified) {
    console.log(`\n  ✓ verified — ${cfg.api}/address/${address}?tab=contract\n`);
    process.exit(0);
  }
}
if (sourcify) {
  console.log(
    `\n  ✓ source publicly verified on Sourcify (${sourcify}) — ${sourcifyUrl}` +
      `\n  ⚠ Blockscout's own verifier did not finish in 2 minutes (it may be down or busy).` +
      `\n    Re-run this command later; nothing else is needed.\n`
  );
  process.exit(0);
}
fail(`not verified after 2 minutes — check ${cfg.api}/address/${address}?tab=contract (it may still be processing)`);
