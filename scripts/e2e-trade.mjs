#!/usr/bin/env node
/**
 * pnpm test:e2e:trade — Stock Trade page in a real browser.
 *
 * Stop any other `next dev` in this folder first (they share .next).
 *
 * Boots the 0x mock (tests/e2e/mocks/zeroex-mock.mjs) and a Next dev server on
 * :3100 wired to it (ZEROX_API_BASE), then runs tests/e2e/trade.spec.ts and tests/e2e/stock-agent.spec.ts.
 * Robinhood registry, Chainlink and the swap receipt are read from mainnet.
 * Cross-platform: no shell syntax, children are stopped on exit.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3100;
const MOCK_PORT = 4099;
const kids = [];
const bin = (name) => path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);

function start(cmd, args, env) {
  const c = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  c.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  c.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  kids.push(c);
  return c;
}

async function waitFor(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function stopAll() {
  for (const k of kids) {
    try {
      k.kill();
    } catch {
      /* gone */
    }
  }
}
process.on("exit", stopAll);
process.on("SIGINT", () => process.exit(130));

try {
  start(process.execPath, ["tests/e2e/mocks/zeroex-mock.mjs"], { PORT: String(MOCK_PORT) });
  await waitFor(`http://127.0.0.1:${MOCK_PORT}/__calls`, 15_000);
  start(bin("next"), ["dev", "-H", "127.0.0.1", "-p", String(PORT)], {
    ZEROX_API_KEY: "e2e-mock-key",
    ZEROX_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
    TRADE_ENABLED: "1",
  });
  console.log(`[e2e-trade] dev server on :${PORT} (first compile can take a minute)…`);
  await waitFor(`http://127.0.0.1:${PORT}/api/trade/market?symbol=NVDA`, 240_000);
  const pw = start(bin("playwright"), ["test", "tests/e2e/trade.spec.ts", "tests/e2e/stock-agent.spec.ts", ...process.argv.slice(2)], {
    E2E_TRADE: "1",
    E2E_NO_SERVER: "1",
    E2E_BASE_URL: `http://127.0.0.1:${PORT}`,
    ZEROX_MOCK_URL: `http://127.0.0.1:${MOCK_PORT}`,
  });
  pw.stdout.on("data", (d) => process.stdout.write(d));
  pw.stderr.on("data", (d) => process.stderr.write(d));
  const code = await new Promise((r) => pw.on("exit", r));
  process.exitCode = code ?? 1;
} catch (e) {
  console.error(`[e2e-trade] ${e.message}`);
  process.exitCode = 1;
} finally {
  stopAll();
}
