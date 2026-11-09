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
child.on("exit", (code, signal) => {
  // Node 24 on Windows can abort in libuv while closing handles AFTER the script has
  // finished (0xC0000409, "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)").
  // Hardhat 2 supports Node 18/20/22; tell the user how to read the result.
  if (process.platform === "win32" && (code === 3221226505 || code === -1073740791)) {
    console.error(
      "\n[hardhat.mjs] Node crashed while shutting down (known Node 24 + Windows libuv bug)." +
        "\n             The script itself already ran — judge success by the output above." +
        "\n             To avoid it, use Node 22 LTS (supported by Hardhat 2).\n"
    );
  }
  process.exit(signal ? 1 : (code ?? 1));
});
