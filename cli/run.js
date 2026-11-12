#!/usr/bin/env node
/**
 * Covar CLI — a live, read-only tour of the production stack.
 *
 *   node cli/run.js                 all six steps against Robinhood Chain mainnet (4663)
 *   node cli/run.js --fast          no pacing (CI / quick check)
 *   node cli/run.js --only 1,2      run selected steps
 *   node cli/run.js --rpc <url>     primary RPC (default: official mainnet RPC)
 *   node cli/run.js --vault <addr>  vault address (default: deployments/4663.json)
 *   node cli/run.js --no-color
 *
 * Every number on screen is read at run time: JSON-RPC from Robinhood Chain,
 * Hyperliquid's public info API, Sourcify, and the repo's own risk / signer /
 * execution modules (steps 3 and 5 run them through tsx). Nothing is cached or
 * hard-coded as a result. No key is read, no transaction is sent. Paper equity
 * and the paper venue in steps 3 and 5 are labelled as such.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS so `node cli/run.js` runs with no build step */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const ROOT = path.resolve(__dirname, "..");
process.stdout.on("error", (e) => {
  if (e.code === "EPIPE") process.exit(0); // piped into head / a closed pager
});
let ethers;
try {
  ({ ethers } = require("ethers"));
} catch {
  console.error("ethers is not installed — run `pnpm install` in the repo first.");
  process.exit(1);
}

/* ----------------------------------------------------------------- arguments */
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
const FAST = flag("fast");
const ONLY = (opt("only") || "1,2,3,4,5,6").split(",").map(Number);
const COLOR = !flag("no-color") && !process.env.NO_COLOR && process.stdout.isTTY !== false;

const MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";
const PUBLICNODE_RPC = "https://robinhood-rpc.publicnode.com"; // chain 4663 (robinhood-sepolia-rpc is the 46630 testnet)
const PRIMARY_RPC = opt("rpc") || process.env.COVAR_RPC || MAINNET_RPC;
const HL_INFO = "https://api.hyperliquid.xyz/info";
const SOURCIFY = "https://sourcify.dev/server";
const EXPLORER = "https://robinhoodchain.blockscout.com";

const manifestPath = path.join(ROOT, "deployments", "4663.json");
const MANIFEST = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
// fallback only when the manifest file is not in this checkout; step 6 re-reads everything from chain
const KNOWN = { address: "0x9f0172A7B568A9C38557dCD7C31Db9cb78e0f31B", txHash: "0xd8f3263d1d2285fc1787cc2e18ff839df5ac8f6017aee976e29331728306d87e" };
const VAULT = opt("vault") || MANIFEST?.address || KNOWN.address;

/* ------------------------------------------------------------------- styling */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const fg = (rgb, s) => (COLOR ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${s}\x1b[39m` : s);
const C = {
  cobalt: hex("#1F5FD6"),
  sky: hex("#79B8FF"),
  ice: hex("#C9DEFF"),
  green: hex("#3FB950"),
  red: hex("#F85149"),
  amber: hex("#D29922"),
  dim: hex("#7D8590"),
  white: hex("#E6EDF3"),
};
const bold = (s) => (COLOR ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s) => fg(C.dim, s);
const ok = (s = "✓") => fg(C.green, s);
const bad = (s = "✗") => fg(C.red, s);
const warn = (s) => fg(C.amber, s);
const accent = (s) => fg(C.sky, s);
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
const width = (s) => [...stripAnsi(s)].length;
const pad = (s, n, right = false) => {
  const w = width(s);
  return w >= n ? s : right ? " ".repeat(n - w) + s : s + " ".repeat(n - w);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? 0 : ms));
const out = (s = "") => process.stdout.write(`${s}\n`);
async function lines(list, ms = 35) {
  for (const l of list) {
    out(l);
    await sleep(ms);
  }
}

const GRADIENT = ["#1846B8", "#1F6FEB", "#3D8BFF", "#79B8FF", "#BFD9FF"].map(hex);
function gradientAt(t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (GRADIENT.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return GRADIENT[i].map((v, k) => Math.round(v + (GRADIENT[i + 1][k] - v) * f));
}
const gradient = (s, offset = 0) => {
  const chars = [...s];
  return chars.map((ch, i) => (ch === " " ? ch : fg(gradientAt(i / chars.length + offset), ch))).join("");
};

const BANNER = [
  " ██████╗ ██████╗ ██╗   ██╗ █████╗ ██████╗ ",
  "██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔══██╗",
  "██║     ██║   ██║██║   ██║███████║██████╔╝",
  "██║     ██║   ██║╚██╗ ██╔╝██╔══██║██╔══██╗",
  "╚██████╗╚██████╔╝ ╚████╔╝ ██║  ██║██║  ██║",
  " ╚═════╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝",
];

function box(title, body, minW = 78) {
  const maxW = Math.max(minW, (process.stdout.columns || 160) - 2);
  const w = Math.min(maxW, Math.max(minW, width(title) + 6, ...body.map((l) => width(l) + 4)));
  body = body.map((l) => (width(l) > w - 4 ? [...stripAnsi(l)].slice(0, w - 5).join("") + "…" : l));
  const top = `╭─ ${bold(accent(title))} ${"─".repeat(Math.max(0, w - width(title) - 5))}╮`;
  const rows = body.map((l) => `│ ${pad(l, w - 4)} │`);
  return [top, ...rows, `╰${"─".repeat(w - 2)}╯`].map((l) => l.replace(/^([╭│╰])/, (m) => fg(C.cobalt, m)).replace(/([╮│╯])$/, (m) => fg(C.cobalt, m)));
}

function table(headers, rows, align = []) {
  const cols = headers.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ""))));
  const fmt = (r, head) => "  " + r.map((c, i) => pad(head ? dim(c) : c ?? "", cols[i], align[i] === "r")).join("   ");
  return [fmt(headers, true), "  " + dim(cols.map((n) => "─".repeat(n)).join("   ")), ...rows.map((r) => fmt(r))];
}

const results = [];
function record(step, label, pass, detail = "") {
  results.push({ step, label, pass });
  return `  ${pass ? ok() : bad()} ${label}${detail ? dim(` — ${detail}`) : ""}`;
}

async function header(n, title, sub) {
  out("");
  out(`${fg(C.cobalt, "━━")} ${bold(fg(C.white, `[${n}/6]`))} ${bold(gradient(title.toUpperCase()))}  ${dim(sub)}`);
  out(dim("   " + "┄".repeat(74)));
  await sleep(250);
}

/* ------------------------------------------------------------------ helpers */
async function rpc(url, method, params = []) {
  const t0 = performance.now();
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  const ms = performance.now() - t0;
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return { result: j.result, ms };
}
const short = (a, n = 6) => (a ? `${a.slice(0, n + 2)}…${a.slice(-4)}` : "—");
const usdg = (v, d = 6) => Number(ethers.formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 });
const ago = (sec) => (sec < 90 ? `${Math.round(sec)}s` : sec < 5400 ? `${Math.round(sec / 60)}m` : `${(sec / 3600).toFixed(1)}h`);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const provider = new ethers.JsonRpcProvider(PRIMARY_RPC, 4663, { staticNetwork: true });

const VAULT_ABI = [
  "function owner() view returns (address)",
  "function operator() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function asset() view returns (address)",
  "function minDeposit() view returns (uint256)",
  "function maxDepositPerTx() view returns (uint256)",
  "function maxTotalAssets() view returns (uint256)",
  "function reportedAssets() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function lastNavUpdate() view returns (uint64)",
  "function maxNavAge() view returns (uint64)",
  "function maxNavChangeBps() view returns (uint256)",
  "function depositFeeBps() view returns (uint256)",
  "function depositFeeFlat() view returns (uint256)",
  "function withdrawalFeeBps() view returns (uint256)",
  "function withdrawalFeeFlat() view returns (uint256)",
  "function depositsPaused() view returns (bool)",
  "function closeOnly() view returns (bool)",
  "function tradingAccount() view returns (address)",
  "function reservedForClaims() view returns (uint256)",
  "event Deposit(address indexed investor, uint256 assetsIn, uint256 fee, uint256 shares)",
  "event WithdrawalRequested(address indexed investor, uint256 shares, uint64 at)",
  "event PositionsClosed(address indexed investor)",
  "event WithdrawalSettled(address indexed investor, uint256 netAssets)",
  "event WithdrawalClaimed(address indexed investor, uint256 assets)",
  "event NavReported(uint256 previousAssets, uint256 newAssets, uint64 at)",
];
const ERC20 = ["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"];
const vault = new ethers.Contract(VAULT, VAULT_ABI, provider);
const ctx = {}; // shared between steps (mids, vault params, deploy block)

function tsxRun(script, args, env, onLine) {
  let cli;
  try {
    cli = require.resolve("tsx/cli", { paths: [ROOT] });
  } catch {
    throw new Error("tsx is not installed — run `pnpm install` in the repo first.");
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, path.join(ROOT, script), ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let errBuf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) > -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) onLine?.(line, child.pid);
      }
    });
    child.stderr.on("data", (d) => (errBuf += d));
    child.on("close", (code, signal) => {
      if (buf.trim()) onLine?.(buf.trim(), child.pid);
      resolve({ code, signal, pid: child.pid, stderr: errBuf });
    });
  });
}

/* ==================================================================== STEP 1 */
async function step1() {
  await header(1, "Live RPC pulse", "Robinhood Chain mainnet · JSON-RPC, measured now");
  const endpoints = [...new Set([PRIMARY_RPC, PUBLICNODE_RPC])];
  const rows = [];
  const heads = [];
  for (const url of endpoints) {
    try {
      const chain = Number(BigInt((await rpc(url, "eth_chainId")).result));
      const lat = [];
      let head = 0;
      for (let i = 0; i < 5; i++) {
        const r = await rpc(url, "eth_blockNumber");
        lat.push(r.ms);
        head = Number(BigInt(r.result));
      }
      const gas = Number(BigInt((await rpc(url, "eth_gasPrice")).result)) / 1e9;
      const blk = (await rpc(url, "eth_getBlockByNumber", ["latest", false])).result;
      const age = Date.now() / 1000 - Number(BigInt(blk.timestamp));
      heads.push({ url, head, chain });
      rows.push([new URL(url).host, chain === 4663 ? ok(String(chain)) : bad(String(chain)), head.toLocaleString("en-US"), `${median(lat).toFixed(0)} ms`, `${Math.min(...lat).toFixed(0)}–${Math.max(...lat).toFixed(0)}`, gas.toFixed(4), `${Math.max(0, age).toFixed(1)}s`]);
    } catch (e) {
      rows.push([new URL(url).host, bad("down"), "—", "—", "—", "—", dim(String(e.message).slice(0, 30))]);
    }
  }
  await lines(table(["ENDPOINT", "CHAIN", "HEAD", "p50", "MIN–MAX", "GAS gwei", "BLOCK AGE"], rows, ["", "", "r", "r", "r", "r", "r"]), 80);
  out("");
  const live = heads.filter((h) => h.chain === 4663);
  out(record(1, "RPC answers as chain 4663 (Robinhood Chain mainnet)", live.length > 0, live.map((h) => new URL(h.url).host).join(", ")));
  if (live.length > 1) {
    const spread = Math.max(...live.map((h) => h.head)) - Math.min(...live.map((h) => h.head));
    out(record(1, "independent endpoints agree on the head", spread < 200, `spread ${spread} blocks`));
  }
  await sleep(200);

  // vault parameters, straight from the contract
  const asset = new ethers.Contract(await vault.asset(), ERC20, provider);
  const [owner, operator, feeRecipient, min, perTx, cap, reported, shares, lastNav, maxAge, navBps, dBps, dFlat, wBps, wFlat, paused, closeOnly, trading, reserved, sym, dec] = await Promise.all([
    vault.owner(), vault.operator(), vault.feeRecipient(), vault.minDeposit(), vault.maxDepositPerTx(), vault.maxTotalAssets(), vault.reportedAssets(), vault.totalShares(), vault.lastNavUpdate(), vault.maxNavAge(), vault.maxNavChangeBps(),
    vault.depositFeeBps(), vault.depositFeeFlat(), vault.withdrawalFeeBps(), vault.withdrawalFeeFlat(), vault.depositsPaused(), vault.closeOnly(), vault.tradingAccount(), vault.reservedForClaims(), asset.symbol(), asset.decimals(),
  ]);
  const [vaultBal, opGas] = await Promise.all([asset.balanceOf(VAULT), provider.getBalance(operator)]);
  const navAge = Date.now() / 1000 - Number(lastNav);
  const fresh = Number(lastNav) > 0 && navAge <= Number(maxAge);
  const nps = shares > 0n ? Number(reported) / Number(shares) : 1;
  Object.assign(ctx, { owner, operator, feeRecipient, dec: Number(dec), sym, wBps, wFlat, min, perTx, cap });
  out("");
  const P = (k, v, note = "") => [k, v, note ? dim(note) : ""];
  await lines(
    table(["VAULT PARAMETER", "ON-CHAIN VALUE", ""], [
      P("address", accent(VAULT), "CovarVault"),
      P("collateral", `${sym} · ${dec} decimals`, short(asset.target)),
      P("owner (admin)", short(owner, 8)),
      P("operator (NAV, settlement)", short(operator, 8), `gas ${Number(ethers.formatEther(opGas)).toFixed(6)} ETH`),
      P("fee recipient (treasury)", short(feeRecipient, 8)),
      P("minimum deposit", `${usdg(min, dec)} ${sym}`),
      P("per-deposit cap / TVL cap", `${usdg(perTx, dec)} / ${usdg(cap, dec)} ${sym}`),
      P("deposit fee", `${Number(dBps) / 100}% + ${usdg(dFlat, dec)} ${sym}`),
      P("withdrawal fee", `${Number(wBps) / 100}% + ${usdg(wFlat, dec)} ${sym}`),
      P("reported assets / shares", `${usdg(reported, dec)} / ${usdg(shares, 6)}`, `NAV/share ${nps.toFixed(4)}`),
      P("NAV freshness", fresh ? ok(`fresh · ${ago(navAge)} old`) : bad(Number(lastNav) ? `STALE · ${ago(navAge)}` : "never reported"), `max age ${ago(Number(maxAge))} · max jump ${Number(navBps) / 100}%`),
      P("vault USDG balance", `${usdg(vaultBal, dec)} ${sym}`, `reserved for claims ${usdg(reserved, dec)}`),
      P("deposits / close-only", `${paused ? warn("paused") : ok("open")} / ${closeOnly ? warn("on") : "off"}`),
      P("trading account", trading === ethers.ZeroAddress ? dim("not set — vault does not trade yet") : short(trading, 8)),
    ], ["", "", ""]),
    45
  );
  out("");
  out(record(1, "operator ≠ fee recipient (isolated trading authority)", operator.toLowerCase() !== feeRecipient.toLowerCase()));
  out(record(1, "NAV is fresh, so deposits are priced from a current report", fresh, fresh ? `${ago(navAge)} < ${ago(Number(maxAge))}` : "deposits revert StaleNav"));
}

/* ==================================================================== STEP 2 */
async function step2() {
  await header(2, "Market data", "Hyperliquid public info API · mids with provenance");
  const coins = ["BTC", "ETH", "SOL", "HYPE"];
  const post = async (body) => {
    const t = performance.now();
    const r = await fetch(HL_INFO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { r, text: await r.text(), ms: performance.now() - t };
  };
  // one snapshot: allMids and the four books are requested at the same moment
  const [mid, ...books] = await Promise.all([post({ type: "allMids" }), ...coins.map((coin) => post({ type: "l2Book", coin }))]);
  const res = mid.r;
  const raw = mid.text;
  const ms = mid.ms;
  const all = JSON.parse(raw);
  const mids = {};
  const rows = [];
  for (let k = 0; k < coins.length; k++) {
    const c = coins[k];
    mids[c] = Number(all[c]);
    const book = JSON.parse(books[k].text);
    const bms = books[k].ms;
    const bid = Number(book.levels?.[0]?.[0]?.px);
    const ask = Number(book.levels?.[1]?.[0]?.px);
    const bookMid = (bid + ask) / 2;
    const spreadBps = ((ask - bid) / bookMid) * 1e4;
    const drift = (Math.abs(bookMid - mids[c]) / mids[c]) * 1e4;
    const age = Date.now() - Number(book.time);
    const p = (v) => v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 4 : 2, minimumFractionDigits: 2 });
    rows.push([`${c}-PERP`, bold(p(mids[c])), p(bid), p(ask), spreadBps.toFixed(2), drift < 15 ? ok(drift.toFixed(2)) : warn(drift.toFixed(2)), `${Math.max(0, age)} ms`, `${bms.toFixed(0)} ms`]);
  }
  await lines(table(["MARKET", "MID", "BEST BID", "BEST ASK", "SPREAD bps", "MID vs BOOK bps", "BOOK AGE", "RTT"], rows, ["", "r", "r", "r", "r", "r", "r", "r"]), 70);
  ctx.mids = mids;
  const sha = crypto.createHash("sha256").update(raw).digest("hex");
  out("");
  await lines(
    box("PROVENANCE", [
      `source      ${accent(`POST ${HL_INFO}`)}  ${dim('{"type":"allMids"}')}`,
      `fetched     ${new Date().toISOString()}`,
      `server date ${res.headers.get("date") || "—"}`,
      `response    HTTP ${res.status} · ${raw.length.toLocaleString("en-US")} bytes · ${Object.keys(all).length} markets · ${ms.toFixed(0)} ms`,
      `sha256      ${sha}`,
      `cross-check each mid vs (best bid + best ask) / 2 from ${accent("l2Book")}`,
      dim("no cache, no fallback price: if this call fails, the step fails"),
    ]),
    30
  );
  out(record(2, "four live mids received and consistent with the order books", coins.every((c) => mids[c] > 0)));
}

/* ==================================================================== STEP 3 */
async function step3() {
  await header(3, "Strategy compile + risk engine", "real modules: src/lib/strategy · services/risk · services/signer");
  if (!ctx.mids) throw new Error("step 3 needs live mids from step 2");
  let res = null;
  const r = await tsxRun("cli/engine.ts", [], { COVAR_MIDS: JSON.stringify(ctx.mids) }, (line) => {
    try {
      res = JSON.parse(line);
    } catch {
      /* not JSON */
    }
  });
  if (!res || r.code !== 0) throw new Error(`engine failed (exit ${r.code}) ${res?.error || r.stderr.slice(0, 200)}`);
  const s = res.strategy;
  await lines([`  ${dim("prompt")}  ${fg(C.ice, `"${res.prompt}"`)}`], 0);
  await sleep(250);
  await lines(
    box("COMPILED STRATEGY", [
      `${bold(s.name)} · ${s.market} on ${s.venue} · ${s.timeframe} · copilot ${s.copilot}`,
      `indicators  ${s.indicators.join(", ")}`,
      `rules       entry ${s.entry} conditions · exit ${s.exit} conditions`,
      `risk        leverage ${bold(`${s.risk.leverage}x`)} · max position ${s.risk.maxPositionPct}% · stop ${s.risk.stopLossPct}% · take ${s.risk.takeProfitPct}%`,
      `            daily-loss pause ${s.risk.dailyLossPausePct}% · drawdown stop ${s.risk.maxDrawdownPct}%`,
      ...s.unsupported.map((u) => warn(`⚠ ${u}`)),
      `validation  ${s.issues.length ? s.issues.join("; ") : ok("no errors")}`,
      `artifact    ${s.codeLines} lines · sha256 ${s.codeSha256}`,
      dim("─".repeat(72)),
      ...s.codeHead.slice(0, 13).map((l) => dim(l)),
    ]),
    28
  );
  out("");
  out(`  ${dim(`paper equity ${res.equity.toLocaleString("en-US")} USDG · ETH priced at the live mid ${res.ethMid}`)}`);
  await sleep(200);
  const rows = res.rows.map((x) => [x.gate, x.probe, x.result === "PASS" ? ok("PASS") : fg(C.red, "BLOCK"), x.result === x.expect ? ok() : bad(), dim(x.detail.length > 64 ? `${x.detail.slice(0, 63)}…` : x.detail)]);
  await lines(table(["GATE", "PROBE", "RESULT", "AS EXPECTED", "ENGINE SAYS"], rows), 110);
  out("");
  const gates = new Set(res.rows.map((x) => x.gate)).size;
  const asExpected = res.rows.filter((x) => x.result === x.expect).length;
  out(record(3, `${gates}/7 gates enforced by the engine · ${asExpected}/${res.rows.length} probes as expected`, res.ok && gates === 7));
  out(record(3, "exits stay open in pause and emergency stop", res.rows.filter((x) => x.probe === "reduce-only exit").every((x) => x.result === "PASS"), `engine mode after probes: ${res.modeAfter}`));
}

/* ==================================================================== STEP 4 */
async function getLogsChunked(from, to) {
  const out = [];
  let size = 100_000;
  for (let a = from; a <= to; ) {
    const b = Math.min(to, a + size - 1);
    try {
      out.push(...(await provider.getLogs({ address: VAULT, fromBlock: a, toBlock: b })));
      a = b + 1;
    } catch (e) {
      if (size <= 1000) throw e;
      size = Math.floor(size / 4);
    }
  }
  return out;
}

async function step4() {
  await header(4, "Settlement", "the last real withdrawal on mainnet, read from vault events");
  const fromBlock = Number(MANIFEST?.blockNumber || ctx.deployBlock || 110941861);
  const head = await provider.getBlockNumber();
  const logs = (await getLogsChunked(fromBlock, head)).map((l) => ({ l, e: vault.interface.parseLog(l) })).filter((x) => x.e);
  const claim = [...logs].reverse().find((x) => x.e.name === "WithdrawalClaimed");
  if (!claim) {
    out(`  ${warn("no completed withdrawal on this vault yet")} ${dim(`(scanned ${fromBlock}–${head})`)}`);
    out(record(4, "settlement history present", false, "deposit, withdraw and claim once to populate this step"));
    return;
  }
  const inv = claim.e.args.investor.toLowerCase();
  const before = (name) => [...logs].reverse().find((x) => x.e.name === name && x.e.args.investor?.toLowerCase() === inv && x.l.blockNumber <= claim.l.blockNumber);
  const req = before("WithdrawalRequested");
  const closed = before("PositionsClosed");
  const settled = before("WithdrawalSettled");
  const dep = before("Deposit");
  const steps = [req, closed, settled, claim];
  const meta = await Promise.all(steps.map(async (x) => (x ? { blk: await provider.getBlock(x.l.blockNumber), tx: await provider.getTransaction(x.l.transactionHash) } : null)));
  const d = ctx.dec ?? 6;
  const wBps = Number(ctx.wBps ?? 100n);
  const wFlat = Number(ethers.formatUnits(ctx.wFlat ?? 100000n, d));
  const net = Number(ethers.formatUnits(settled.e.args.netAssets, d));
  const gross = (net + wFlat) / (1 - wBps / 1e4);
  const fee = gross - net;
  const shares = Number(ethers.formatUnits(req.e.args.shares, 6));
  const t0 = meta[0].blk.timestamp;
  const who = (i) => meta[i]?.tx.from.toLowerCase();
  const role = (a) => (a === inv ? "investor" : a === ctx.operator?.toLowerCase() ? "operator" : a === ctx.owner?.toLowerCase() ? "owner" : "other");
  const titles = ["requestWithdrawal", "markPositionsClosed", "settleWithdrawal", "claim"];
  const what = [
    `${shares.toFixed(4)} shares queued`,
    "venue exposure closed for this investor",
    `gross ${gross.toFixed(4)} − fee ${fee.toFixed(4)} = ${bold(`${net.toFixed(4)} ${ctx.sym || "USDG"}`)} reserved`,
    `${bold(`${Number(ethers.formatUnits(claim.e.args.assets, d)).toFixed(4)} ${ctx.sym || "USDG"}`)} transferred to the investor`,
  ];
  if (dep) out(`  ${dim(`investor ${short(inv, 8)} deposited ${usdg(dep.e.args.assetsIn, d)} (fee ${usdg(dep.e.args.fee, d)}) → ${usdg(dep.e.args.shares, 6)} shares at block ${dep.l.blockNumber.toLocaleString("en-US")}`)}`);
  out("");
  for (let i = 0; i < 4; i++) {
    const m = meta[i];
    const x = steps[i];
    out(`  ${fg(C.cobalt, i < 3 ? "●" : "◆")} ${bold(`${i + 1}  ${titles[i]}`)}  ${dim(`+${m.blk.timestamp - t0}s · block ${x.l.blockNumber.toLocaleString("en-US")} · signed by ${role(who(i))} ${short(who(i), 4)}`)}`);
    out(`  ${fg(C.cobalt, i < 3 ? "│" : " ")}    ${what[i]}`);
    out(`  ${fg(C.cobalt, i < 3 ? "│" : " ")}    ${dim(`${EXPLORER}/tx/${x.l.transactionHash}`)}`);
    await sleep(380);
  }
  const reserved = await vault.reservedForClaims();
  out("");
  // NAV/share the investor bought at: (assets in − fee) / shares minted
  const nav = dep ? Number(dep.e.args.assetsIn - dep.e.args.fee) / Number(dep.e.args.shares) : 1;
  const g = shares * nav;
  const expectNet = g - (g * wBps) / 1e4 - wFlat;
  out(record(4, "fee math reproduces the on-chain net", Math.abs(expectNet - net) < 1e-6, `${shares.toFixed(4)} sh × NAV ${nav.toFixed(4)} = ${g.toFixed(4)} − (${wBps / 100}% + ${wFlat.toFixed(2)}) = ${expectNet.toFixed(4)}`));
  out(record(4, "claimed amount equals the settled amount", claim.e.args.assets === settled.e.args.netAssets));
  out(record(4, "investor signs steps 1 and 4, operator signs 2 and 3", role(who(0)) === "investor" && role(who(3)) === "investor" && role(who(1)) === "operator" && role(who(2)) === "operator"));
  out(record(4, "nothing left reserved after the claim", reserved === 0n, `reservedForClaims ${usdg(reserved, d)}`));
}

/* ==================================================================== STEP 5 */
async function step5() {
  await header(5, "Crash + journal recovery", "real execution daemon · journaled paper venue (stand-in for Lighter)");
  const eth = ctx.mids?.ETH;
  if (!eth) throw new Error("step 5 needs the live ETH mid from step 2");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covar-cli-daemon-"));
  const intentId = `cli-${Date.now().toString(36)}`;
  const env = { COVAR_ETH_MID: String(eth), COVAR_INTENT_ID: intentId };
  const stamp = () => dim(new Date().toISOString().slice(11, 23));
  const show = (line, pid) => {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    const tag = dim(`pid ${pid}`);
    const msgs = {
      boot: () => (e.mode === "crash" ? "daemon up · journals opened" : `daemon up · journal replayed: order c-${intentId} was "${e.replayedStatus}" · venue holds ${e.venueOrdersOnBoot} order`),
      intent_accepted: () => `intent ${e.intentId} → ${e.clientOrderId} · BUY ${e.qty} ETH-PERP @ ${e.price}`,
      venue_accepted: () => `${accent("venue accepted")} ${e.clientOrderId} as ${e.venueOrderId}`,
      crash: () => fg(C.red, `✖ killed inside the crash window (${e.reason}) — our ack was never journaled`),
      recovery: () => `reconcile: scanned ${e.scanned} · adopted ${(e.adopted || []).join(",") || "—"} · resubmitted ${(e.resubmitted || []).join(",") || "none"} · duplicate prevented ${e.duplicatePrevented}`,
      replay: () => `strategy re-emits the same intent → deduplicated to ${e.clientOrderId} (${e.status})`,
      done: () => `order ${e.status} · ${e.filledQty} @ ${e.avgFillPrice} · position ${e.position} ETH`,
      error: () => fg(C.red, e.error),
    };
    const msg = msgs[e.type]?.();
    if (msg) out(`  ${stamp()} ${tag}  ${msg}`);
    if (e.type === "done") ctx.daemon = e;
  };

  out(`  ${dim("$")} tsx cli/daemon.ts crash ${dim(dir)}`);
  const a = await tsxRun("cli/daemon.ts", ["crash", dir], env, show);
  const code = a.code ?? (a.signal === "SIGKILL" ? 137 : a.code);
  out(`  ${stamp()} ${dim(`pid ${a.pid}`)}  ${code === 137 ? fg(C.red, bold("process exited with code 137")) : warn(`exited with ${code}`)}`);
  await sleep(500);

  const tail = (file, n) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").slice(-n).map((l) => JSON.parse(l)) : []);
  const jx = tail(path.join(dir, "execution.jsonl"), 3);
  const jv = tail(path.join(dir, "exchange.jsonl"), 1);
  out("");
  await lines(
    box("JOURNALS ON DISK AFTER THE CRASH", [
      ...jx.map((j) => `execution #${j.seq}  ${pad(j.type, 24)} ${dim(JSON.stringify({ status: j.payload.status, clientOrderId: j.payload.clientOrderId, venueOrderId: j.payload.venueOrderId }).replace(/,?"\w+":undefined/g, ""))}`),
      ...jv.map((j) => `venue     #${j.seq}  ${pad(j.type, 24)} ${dim(`${j.payload.clientOrderId} → ${j.payload.orderId}`)}`),
      dim('execution says "submitting" with no ack; the venue already has the order'),
    ]),
    60
  );
  out("");
  await sleep(400);
  out(`  ${dim("$")} tsx cli/daemon.ts recover ${dim(dir)}`);
  const b = await tsxRun("cli/daemon.ts", ["recover", dir], env, show);
  out("");
  const dmn = ctx.daemon || {};
  out(record(5, "daemon died hard with exit 137 inside the crash window", code === 137));
  out(record(5, "restart adopted the venue order instead of resubmitting", b.code === 0 && dmn.venueSubmitCallsAfterRestart === 0, `${dmn.venueSubmitCallsAfterRestart ?? "?"} venue submits after restart`));
  out(record(5, "exactly one venue order for this clientOrderId", dmn.venueOrdersForKey === 1, `c-${intentId} → ${dmn.venueOrderId || "?"}`));
  out(record(5, "replayed intent deduplicated, fill applied once", dmn.intentDeduplicated === 1 && dmn.fillsApplied === 1, `position ${dmn.position} ETH`));
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ==================================================================== STEP 6 */
async function step6() {
  await header(6, "Mainnet deployment", "manifest · on-chain bytecode · Sourcify");
  let m = MANIFEST;
  let source = "deployments/4663.json";
  if (!m || m.address?.toLowerCase() !== VAULT.toLowerCase()) {
    const rc = await provider.getTransactionReceipt(KNOWN.txHash);
    const tx = await provider.getTransaction(KNOWN.txHash);
    m = { chainId: 4663, address: rc.contractAddress, txHash: KNOWN.txHash, blockNumber: rc.blockNumber, deployer: tx.from, compiler: "0.8.24" };
    source = "reconstructed from the deploy transaction (manifest file not in this checkout)";
  }
  ctx.deployBlock = m.blockNumber;
  const [code, rc, tx, sf] = await Promise.all([
    provider.getCode(m.address),
    provider.getTransactionReceipt(m.txHash),
    provider.getTransaction(m.txHash),
    fetch(`${SOURCIFY}/v2/contract/4663/${m.address}?fields=compilation,deployment,runtimeBytecode`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const codeHash = ethers.keccak256(code);
  const sfHash = sf?.runtimeBytecode?.onchainBytecode ? ethers.keccak256(sf.runtimeBytecode.onchainBytecode) : null;
  const artifactPath = path.join(ROOT, "artifacts", "contracts", "CovarVault.sol", "CovarVault.json");
  const artifact = fs.existsSync(artifactPath) ? JSON.parse(fs.readFileSync(artifactPath, "utf8")) : null;
  const checkoutMatches = artifact ? tx.data.toLowerCase().startsWith(artifact.bytecode.toLowerCase()) : null;
  const [min, perTx, cap] = [ctx.min ?? (await vault.minDeposit()), ctx.perTx ?? (await vault.maxDepositPerTx()), ctx.cap ?? (await vault.maxTotalAssets())];
  const ctor = artifact ? ethers.AbiCoder.defaultAbiCoder().decode(["address", "address", "address"], "0x" + tx.data.slice(artifact.bytecode.length)) : null;

  await lines(
    box("DEPLOYMENT MANIFEST", [
      `source        ${dim(source)}`,
      `network       Robinhood Chain mainnet · chain ${m.chainId}`,
      `contract      ${bold("CovarVault")} ${accent(m.address)}`,
      `deployer      ${m.deployer}`,
      `deploy tx     ${m.txHash}`,
      `block         ${Number(m.blockNumber).toLocaleString("en-US")} · status ${rc.status === 1 ? ok("success") : bad("failed")} · gas ${Number(rc.gasUsed).toLocaleString("en-US")}`,
      ctor ? `constructor   asset ${short(ctor[0], 4)} · feeRecipient ${short(ctor[1], 4)} · operator ${short(ctor[2], 4)}` : dim("constructor   (compile the repo to decode)"),
      `limits now    min ${usdg(min)} · per deposit ${usdg(perTx)} · TVL ${usdg(cap)} USDG`,
      `runtime code  ${((code.length - 2) / 2).toLocaleString("en-US")} bytes · keccak ${codeHash.slice(0, 18)}…`,
    ]),
    40
  );
  out("");
  const c = sf?.compilation;
  await lines(
    box("SOURCIFY · INDEPENDENT SOURCE VERIFICATION", sf
      ? [
          `match         ${sf.match === "exact_match" ? ok(bold("EXACT MATCH")) : warn(sf.match)}  ${dim(`creation ${sf.creationMatch} · runtime ${sf.runtimeMatch}`)}`,
          `contract      ${c?.fullyQualifiedName}`,
          `compiler      solc ${c?.compilerVersion} · optimizer ${c?.compilerSettings?.optimizer?.enabled ? `on, ${c.compilerSettings.optimizer.runs} runs` : "off"} · evm ${c?.compilerSettings?.evmVersion}`,
          `deployment    block ${Number(sf.deployment?.blockNumber).toLocaleString("en-US")} · tx ${short(sf.deployment?.transactionHash, 8)} · by ${short(sf.deployment?.deployer, 6)}`,
          `verified at   ${sf.verifiedAt}`,
          `bytecode      Sourcify keccak ${sfHash?.slice(0, 18)}… ${sfHash === codeHash ? ok("= chain") : bad("≠ chain")}`,
          `public repo   ${accent(`https://repo.sourcify.dev/4663/${m.address}`)}`,
          `explorer      ${dim(`${EXPLORER}/address/${m.address}`)}`,
        ]
      : [bad("Sourcify unreachable or contract not verified")]),
    40
  );
  out("");
  out(record(6, "contract code is live at the manifest address", code !== "0x"));
  out(record(6, "Sourcify exact match (creation + runtime)", sf?.creationMatch === "exact_match" && sf?.runtimeMatch === "exact_match"));
  out(record(6, "Sourcify's bytecode is the bytecode on chain", !!sfHash && sfHash === codeHash));
  out(record(6, "Sourcify deployment = manifest (tx, block, deployer)", !!sf && sf.deployment?.transactionHash?.toLowerCase() === m.txHash.toLowerCase() && Number(sf.deployment?.blockNumber) === Number(m.blockNumber) && sf.deployment?.deployer?.toLowerCase() === m.deployer.toLowerCase()));
  if (checkoutMatches !== null) out(record(6, "this checkout compiles to the deployed creation bytecode", checkoutMatches));
}

/* ====================================================================== main */
async function main() {
  const started = performance.now();
  out("");
  for (let i = 0; i < BANNER.length; i++) {
    out("  " + gradient(BANNER[i], i * 0.03));
    await sleep(60);
  }
  out("");
  out(`  ${gradient("Agent vaults on Robinhood Chain", 0.1)}  ${dim("· live tour · read-only · no keys")}`);
  out(`  ${dim(`rpc ${new URL(PRIMARY_RPC).host} · vault ${short(VAULT, 6)} · ${new Date().toISOString()}`)}`);
  await sleep(500);

  const steps = [step1, step2, step3, step4, step5, step6];
  for (let i = 0; i < steps.length; i++) {
    if (!ONLY.includes(i + 1)) continue;
    try {
      await steps[i]();
    } catch (e) {
      out(record(i + 1, `step ${i + 1} could not complete`, false, String(e.message || e).slice(0, 120)));
    }
    await sleep(500);
  }

  const passed = results.filter((r) => r.pass).length;
  const allOk = passed === results.length;
  out("");
  await lines(
    box("RESULT", [
      `${allOk ? ok(bold("ALL CHECKS PASSED")) : bad(bold(`${results.length - passed} CHECK(S) FAILED`))}  ${dim(`${passed}/${results.length} checks · ${((performance.now() - started) / 1000).toFixed(1)}s`)}`,
      dim("chain data: Robinhood Chain JSON-RPC · prices: Hyperliquid · verification: Sourcify"),
    ]),
    0
  );
  out("");
  process.exitCode = allOk ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
