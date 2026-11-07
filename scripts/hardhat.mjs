#!/usr/bin/env node
/**
 * Cross-platform Hardhat launcher.
 *
 * `TS_NODE_PROJECT=tsconfig.hardhat.json hardhat …` is POSIX-shell syntax and
 * fails on Windows (cmd / PowerShell). This sets the variable in-process and
 * forwards every argument to the Hardhat CLI, so `pnpm preflight:testnet`,
 * `pnpm deploy:testnet`, etc. behave identically on Windows, macOS and Linux.
 *
 *   node scripts/hardhat.mjs run scripts/preflight.ts --network robinhoodTestnet
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("hardhat/package.json");
const cli = join(dirname(pkgPath), require(pkgPath).bin.hardhat);

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, TS_NODE_PROJECT: process.env.TS_NODE_PROJECT || "tsconfig.hardhat.json" },
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
