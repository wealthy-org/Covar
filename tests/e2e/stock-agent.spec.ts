/**
 * /studio → Instant Stock Agent, in a real browser (architecture brief §9 QA matrix).
 *
 *   pnpm test:e2e:trade   (boots the 0x mock + a dev server wired to it)
 *
 * Real: the intent parser, /api/stocks/prices (Yahoo, live call in test #1), the
 * Robinhood registry / token checks, the quote API and every validation in it.
 * Mocked (test-only, clearly synthetic): the 0x API, the wallet, the share price
 * fed to the watcher (so "price reaches +4%" can be simulated, QA #7), and the two
 * swap receipts (synthetic Transfer logs for a buy and a sell by the test wallet).
 */
import { expect, test, type Page, type Route } from "@playwright/test";

test.skip(!process.env.E2E_TRADE, "run with pnpm test:e2e:trade (needs the 0x mock)");
test.describe.configure({ mode: "serial" });
test.use({ navigationTimeout: 90_000 });

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const MOCK = process.env.ZEROX_MOCK_URL || "http://127.0.0.1:4099";
const TAKER = "0x5CF7db17B8444504B0b2C2Cfe71e3E8351505464";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
const AH = "0000000000001ff3684f28c67538d4d072c22734";
const MM = "0x8a5a7c2b0e4f3d1c9b6a5e4d3c2b1a0f9e8d7c6b"; // synthetic market maker
const T_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const H_APPROVE = "0x" + "a1".repeat(32);
const H_BUY = "0x" + "b2".repeat(32);
const H_SELL = "0x" + "c3".repeat(32);
const SHARES = 308_469_000_000_000_000n; // 0.308469 NVDA for 50 USDG

const word = (v: bigint) => "0x" + v.toString(16).padStart(64, "0");
const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

interface Ctx {
  allowance: { usdg: bigint; nvda: bigint };
  sent: { to: string; data: string }[];
  nextSwap: "buy" | "sell";
  price: number;
}

function receipt(hash: string) {
  const base = { transactionHash: hash, status: "0x1", blockNumber: "0x6cf2a40", gasUsed: "0x30d40", effectiveGasPrice: "0x989680", from: TAKER, to: "0x" + AH };
  const tr = (token: string, from: string, to: string, v: bigint) => ({ address: token, topics: [T_TOPIC, pad(from), pad(to)], data: word(v) });
  if (hash === H_BUY) return { ...base, logs: [tr(USDG, TAKER, MM, 50_000_000n), tr(NVDA, MM, TAKER, SHARES)] };
  if (hash === H_SELL) return { ...base, logs: [tr(NVDA, TAKER, MM, SHARES), tr(USDG, MM, TAKER, 52_100_000n)] };
  if (hash === H_APPROVE) return { ...base, to: USDG, logs: [] };
  return null;
}

function pinCall({ to, data, from }: { to: string; data: string; from?: string }, ctx: Ctx): string | null {
  const t = to.toLowerCase();
  const me = TAKER.toLowerCase().slice(2);
  if (data.startsWith("0x70a08231") && data.includes(me)) return word(t === USDG ? 100_000_000n : 10n ** 18n);
  if (data.startsWith("0xdd62ed3e") && data.includes(AH)) return word(t === USDG ? ctx.allowance.usdg : ctx.allowance.nvda);
  if (t === "0x" + AH && from?.toLowerCase() === TAKER.toLowerCase()) return "0x";
  return null;
}

async function rig(page: Page, ctx: Ctx) {
  await page.exposeFunction("__wallet", async (method: string, params: unknown[]) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [TAKER];
    if (method === "eth_chainId") return "0x1237";
    if (method === "wallet_switchEthereumChain") return null;
    if (method === "eth_sendTransaction") {
      const tx = (params as { to: string; data: string }[])[0];
      ctx.sent.push({ to: tx.to.toLowerCase(), data: tx.data });
      if (tx.data.startsWith("0x095ea7b3")) {
        if (tx.to.toLowerCase() === USDG) ctx.allowance.usdg = 2n ** 255n;
        if (tx.to.toLowerCase() === NVDA) ctx.allowance.nvda = 2n ** 255n;
        return H_APPROVE;
      }
      return ctx.nextSwap === "buy" ? H_BUY : H_SELL;
    }
    if (method === "eth_call") {
      const pinned = pinCall((params as [{ to: string; data: string; from?: string }])[0], ctx);
      if (pinned !== null) return pinned;
    }
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  });
  await page.addInitScript(() => {
    const w = window as unknown as { ethereum: unknown; __wallet: (m: string, p: unknown[]) => Promise<unknown> };
    w.ethereum = { request: ({ method, params }: { method: string; params?: unknown[] }) => w.__wallet(method, params ?? []), on() {}, removeListener() {} };
  });
  const onRpc = async (route: Route) => {
    const body = route.request().postDataJSON() as { id: number; method: string; params: unknown[] } | null;
    if (body?.method === "eth_getTransactionReceipt") {
      const r = receipt(String(body.params[0]));
      if (r) return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: r } });
    }
    if (body?.method === "eth_call") {
      const pinned = pinCall(body.params[0] as { to: string; data: string; from?: string }, ctx);
      if (pinned !== null) return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: pinned } });
    }
    return route.continue();
  };
  await page.route(RPC, onRpc);
  await page.route(`${RPC}/**`, onRpc);
  // the watcher's share price is controlled by the test
  await page.route("**/api/stocks/prices**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        source: "yahoo_live",
        fetchedAt: Date.now(),
        prices: { NVDA: { symbol: "NVDA", price: ctx.price, previousClose: 166.19, changePct: 0, currency: "USD", source: "yahoo", marketState: "open", label: "Live", asOf: Date.now() } },
      },
    })
  );
}

async function connectGate(page: Page) {
  const btn = page.locator("header >> text=Connect wallet").first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await expect(page.locator("header .btn-primary .mono")).toBeVisible({ timeout: 8000 });
  }
}

async function openAgent(page: Page) {
  await page.goto("/studio?mode=stock");
  await connectGate(page);
  await expect(page.getByTestId("stock-agent")).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await fetch(`${MOCK}/__mode?m=ok`);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("QA #3 · /api/stocks/prices returns live NVDA, TSLA, AAPL in under a second", async ({ request }) => {
  test.setTimeout(60_000);
  // warm the dev compile, then let the 5 s price cache expire so the timed call really goes to Yahoo
  await request.get("/api/stocks/prices?symbols=NVDA");
  await request.get("/api/stocks/prices?symbols=NVDA,TSLA,AAPL");
  await new Promise((r) => setTimeout(r, 5_500));
  const t0 = Date.now();
  const r = await request.get("/api/stocks/prices?symbols=NVDA,TSLA,AAPL");
  const ms = Date.now() - t0;
  expect(r.status()).toBe(200);
  const j = await r.json();
  for (const s of ["NVDA", "TSLA", "AAPL"]) {
    expect(typeof j.prices[s].price, s).toBe("number");
    expect(j.prices[s].label).toMatch(/Live|Using Last Close|Chainlink/);
  }
  expect(ms).toBeLessThan(1000);
});

test("QA #9 · /studio keeps the Quant builder as default; the stock mode is one click away", async ({ page }) => {
  await page.goto("/studio");
  await connectGate(page);
  await expect(page.locator("text=Your agents")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("mode-quant")).toHaveAttribute("data-active", "true");
  await page.getByTestId("mode-stock").click();
  await expect(page.getByTestId("stock-agent")).toBeVisible();
  await expect(page).toHaveURL(/mode=stock/);
  await page.getByTestId("mode-quant").click();
  await expect(page.locator("text=Your agents")).toBeVisible();
});

test("QA #4 · Indonesian and English prompts build the same route; replies are English", async ({ page }) => {
  const ctx: Ctx = { allowance: { usdg: 0n, nvda: 0n }, sent: [], nextSwap: "buy", price: 162.85 };
  await rig(page, ctx);
  await openAgent(page);
  const review = page.getByTestId("route-review");
  for (const prompt of ["Beli 50 USDG NVDA jual pas untung 4%", "Buy $50 NVDA take profit 4%"]) {
    await page.getByTestId("agent-input").fill(prompt);
    await page.getByTestId("agent-send").click();
    await expect(review.getByTestId("rr-spend")).toContainText("50.00 USDG");
    await expect(review.getByTestId("rr-target")).toContainText("+4% ($169.36)");
    await expect(review.getByTestId("rr-spot")).toContainText("$162.85");
  }
  await expect(page.getByTestId("agent-msg").first()).toContainText("buy of NVDA for 50.00 USDG");
  await expect(page.getByTestId("agent-msg").last()).toContainText("buy of NVDA for 50.00 USDG");
});

test("QA #5–#8 · buy on chain → watcher → target hit → Lock Profit sell", async ({ page }) => {
  const ctx: Ctx = { allowance: { usdg: 0n, nvda: 2n ** 255n }, sent: [], nextSwap: "buy", price: 162.85 };
  await rig(page, ctx);
  await openAgent(page);
  await page.getByTestId("agent-input").fill("Beli $50 NVDA, jual pas naik 4%");
  await page.getByTestId("agent-send").click();
  const review = page.getByTestId("route-review");
  await expect(review.getByTestId("rr-out")).toContainText("NVDA");
  await expect(review).toContainText("Minimum received (0.5% slippage)");
  await page.getByTestId("agent-attest").check();
  await expect(page.getByTestId("agent-execute")).toHaveText(/Approve & Buy NVDA On-Chain/);
  await page.getByTestId("agent-execute").click();

  // QA #5: approval is exact and goes to the 0x AllowanceHolder; then the swap
  const watcher = page.getByTestId("watcher-card");
  await expect(watcher).toBeVisible({ timeout: 60_000 });
  expect(ctx.sent[0].to).toBe(USDG);
  expect(ctx.sent[0].data).toBe("0x095ea7b3" + AH.padStart(64, "0") + (50_000_000n).toString(16).padStart(64, "0"));
  expect(ctx.sent[1].to).toBe("0x" + AH);
  await expect(page.getByTestId("agent-proof")).toContainText("+0.308469");
  await expect(page.getByTestId("agent-proof")).toContainText("−50");
  await expect(page.getByTestId("agent-proof-tx")).toHaveAttribute("href", `https://robinhoodchain.blockscout.com/tx/${H_BUY}`);

  // QA #6: the right panel switched from route review to the active watcher, no reload
  await expect(page.getByTestId("route-review")).toHaveCount(0);
  await expect(page.getByTestId("watcher-status")).toHaveText(/ACTIVE WATCHER/);
  await expect(watcher).toContainText("$169.36");
  await expect(page.getByTestId("watcher-sell")).toHaveText("Emergency Market Exit (Sell Now)");

  // price moves +1.44% → progress 36%
  ctx.price = 165.2;
  await expect(page.getByTestId("watcher-progress")).toHaveText("36%", { timeout: 12_000 });
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/agent-watching.png`, fullPage: true });

  // QA #7: the price reaches the +4% target → green Lock Profit + banner
  ctx.price = 169.5;
  await expect(page.getByTestId("watcher-status")).toHaveText(/TARGET ACHIEVED/, { timeout: 12_000 });
  await expect(page.getByTestId("tp-banner")).toContainText("NVDA +4% target hit!");
  await expect(page.getByTestId("watcher-sell")).toHaveText("Lock Profit: Sell NVDA to USDG");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/agent-target-hit.png`, fullPage: true });

  // QA #8: the sale — NVDA leaves, USDG comes back, realised P&L from the receipts
  ctx.nextSwap = "sell";
  await page.getByTestId("watcher-sell").click();
  await expect(page.getByTestId("agent-closed")).toContainText("+2.1", { timeout: 60_000 });
  await expect(page.getByTestId("agent-closed")).toContainText("take-profit");
  await expect(page.getByTestId("watcher-card")).toHaveCount(0);
  await expect(page.getByTestId("agent-msg").last()).toContainText("+52.1 USDG");
  expect(ctx.sent.map((s) => s.to)).toEqual([USDG, "0x" + AH, "0x" + AH]);
  // English only: the Indonesian prompt was understood, but nothing on screen is in Indonesian
  const ui = (await page.getByTestId("stock-agent").innerText()).replace("Beli $50 NVDA, jual pas naik 4%", "");
  expect(ui).not.toMatch(/\b(beli|jual|tercapai|harga|saham|untuk|dengan|sekarang|kunci|keluar|darurat|tutup|kirim|agen|selesai|dari|anda|belum|langkah|menunggu|hapus|bukti|diterima)\b/i);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/agent-closed.png`, fullPage: true });
});

test("a restricted region sees the route but cannot trade", async ({ browser }) => {
  const c = await browser.newContext({ extraHTTPHeaders: { "x-vercel-ip-country": "GB" } });
  const page = await c.newPage();
  await page.goto("/studio?mode=stock");
  await connectGate(page);
  await page.getByTestId("agent-input").fill("Buy $50 NVDA take profit 4%");
  await page.getByTestId("agent-send").click();
  await expect(page.getByTestId("agent-region-blocked")).toContainText("NVDA is not available for trading in your region at this time.");
  await expect(page.getByTestId("agent-execute")).toBeDisabled();
  await c.close();
});

test("other tickers are understood but not tradable until enabled", async ({ page }) => {
  await openAgent(page);
  await page.getByTestId("agent-input").fill("buy $25 of tesla take profit 3%");
  await page.getByTestId("agent-send").click();
  await expect(page.getByTestId("agent-msg").last()).toContainText("TSLA isn't open for trading on Covar yet");
  await expect(page.getByTestId("agent-trade-soon")).toContainText("TSLA isn't open for trading on Covar yet");
  await expect(page.getByTestId("agent-execute")).toBeDisabled();
});
