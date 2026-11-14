/**
 * Covar Stock Trade (/trade) in a real browser.
 *
 *   pnpm test:e2e:trade   (boots the 0x mock + a dev server wired to it; see scripts/e2e-trade.mjs)
 *
 * Real: Robinhood registry, Chainlink feed and token uid() (server side), and the
 * receipt of a REAL mainnet 0x swap (0.5 NVDA → 81.045664 USDG, tx 0x000d658d…ff3ff)
 * which the page decodes into the proof card.
 * Mocked: the 0x API (no key in CI), the wallet (EIP-1193 in the test process),
 * and the taker's balance/allowance reads, so the flow can run without funds.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

test.skip(!process.env.E2E_TRADE, "run with pnpm test:e2e:trade (needs the 0x mock)");
test.describe.configure({ mode: "serial" });
test.use({ navigationTimeout: 90_000 });

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const MOCK = process.env.ZEROX_MOCK_URL || "http://127.0.0.1:4099";
const TAKER = "0x5CF7db17B8444504B0b2C2Cfe71e3E8351505464";
const REAL_SWAP = "0x000d658d662c930f96c566105823e2e5e486e05400858ddb378ce39a1e1ff3ff";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
const AH = "0000000000001ff3684f28c67538d4d072c22734";

const word = (v: bigint) => "0x" + v.toString(16).padStart(64, "0");

interface Ctx {
  allowance: { usdg: bigint; nvda: bigint };
  sent: { to: string; data: string }[];
}

async function setMode(m: string) {
  await fetch(`${MOCK}/__mode?m=${m}`);
}

/** EIP-1193 wallet in the test process + RPC reads of balance/allowance pinned for the taker. */
async function rig(page: Page, ctx: Ctx) {
  await page.exposeFunction("__wallet", async (method: string, params: unknown[]) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [TAKER];
    if (method === "eth_chainId") return "0x1237";
    if (method === "wallet_switchEthereumChain") return null;
    if (method === "eth_sendTransaction") {
      const tx = (params as { to: string; data: string }[])[0];
      ctx.sent.push({ to: tx.to.toLowerCase(), data: tx.data });
      // approvals take effect on the next read; every tx resolves to a real, successful hash
      if (tx.data.startsWith("0x095ea7b3")) {
        if (tx.to.toLowerCase() === USDG) ctx.allowance.usdg = 2n ** 255n;
        if (tx.to.toLowerCase() === NVDA) ctx.allowance.nvda = 2n ** 255n;
      }
      return REAL_SWAP;
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
  await page.route(`${RPC}/**`, async (route: Route) => pinReads(route, ctx));
  await page.route(RPC, async (route: Route) => pinReads(route, ctx));
}

/** Balance/allowance reads for the taker, and the swap simulation, answered by the test. */
function pinCall({ to, data, from }: { to: string; data: string; from?: string }, ctx: Ctx): string | null {
  const t = to.toLowerCase();
  const me = TAKER.toLowerCase().slice(2);
  if (data.startsWith("0x70a08231") && data.includes(me)) return word(t === USDG ? 100_000_000n : 10n ** 18n); // 100 USDG, 1 NVDA
  if (data.startsWith("0xdd62ed3e") && data.includes(AH)) return word(t === USDG ? ctx.allowance.usdg : ctx.allowance.nvda);
  if (t === "0x" + AH && from?.toLowerCase() === TAKER.toLowerCase()) return "0x"; // swap simulation succeeds
  return null;
}

async function pinReads(route: Route, ctx: Ctx) {
  const body = route.request().postDataJSON() as { id: number; method: string; params: [{ to: string; data: string; from?: string }] } | null;
  if (body?.method === "eth_call") {
    const pinned = pinCall(body.params[0], ctx);
    if (pinned !== null) return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: pinned } });
  }
  return route.continue();
}

test("page shows the official token check and live reference prices", async ({ page }) => {
  await setMode("ok");
  await page.goto("/trade");
  await expect(page.getByRole("heading", { name: /Buy and sell Stock Tokens/ })).toBeVisible();
  await expect(page.getByTestId("official-badge")).toHaveText("Official Robinhood token");
  const card = page.getByTestId("asset-card");
  await expect(card).toContainText("address matches ✓");
  await expect(card).toContainText("matches registry ✓");
  await expect(card).toContainText(/Chainlink feed\s*[\d,]+\.\d{2} USD/);
  await expect(page.locator("nav[aria-label=Primary]").getByRole("link", { name: "Trade" })).toBeVisible();
});

test("restricted region: token stays visible, trading disabled, API refuses quotes", async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-vercel-ip-country": "US" } });
  const page = await ctx.newPage();
  await page.goto("/trade");
  await expect(page.getByTestId("region-blocked")).toContainText("NVDA is not available for trading in your region at this time.");
  await expect(page.getByTestId("trade-amount")).toBeDisabled();
  await expect(page.getByTestId("asset-card")).toBeVisible();
  const r = await page.request.get(`/api/trade/quote?symbol=NVDA&side=buy&amount=10&taker=${TAKER}&firm=1`, { headers: { "x-vercel-ip-country": "US" } });
  expect(r.status()).toBe(451);
  await ctx.close();
});

test("sell 0.5 NVDA: firm quote → wallet → proof decoded from the real receipt", async ({ page }) => {
  await setMode("ok");
  const ctx: Ctx = { allowance: { usdg: 0n, nvda: 2n ** 255n }, sent: [] };
  await rig(page, ctx);
  await page.goto("/trade");
  await expect(page.getByTestId("wallet-card")).toContainText("USDG100", { timeout: 30_000 });
  await page.getByRole("tab", { name: "Sell" }).click();
  await page.getByTestId("trade-amount").fill("0.5");
  await expect(page.getByTestId("trade-preview")).toContainText("Indicative");
  await expect(page.getByTestId("trade-estimate")).toHaveText(/^81\.04/);
  await expect(page.getByTestId("trade-preview")).toContainText("Minimum received (0.5% slippage)");
  await page.getByTestId("trade-attest").check();
  await page.getByTestId("trade-review").click();
  await expect(page.getByTestId("trade-firm")).toContainText("Executable");
  await page.getByTestId("trade-confirm").click();
  const proof = page.getByTestId("trade-proof");
  await expect(proof).toContainText("Swap succeeded", { timeout: 60_000 });
  await expect(proof).toContainText("+81.045664");
  await expect(proof).toContainText("−0.5");
  await expect(proof).toContainText("162.09 USDG / NVDA");
  await expect(proof).toContainText("yes ✓");
  await expect(page.getByTestId("proof-tx")).toHaveAttribute("href", `https://robinhoodchain.blockscout.com/tx/${REAL_SWAP}`);
  await expect(page.getByTestId("trade-history")).toContainText("Confirmed");
  if (process.env.E2E_SHOTS) {
    await page.setViewportSize({ width: 1360, height: 1500 });
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/trade-proof.png`, fullPage: true });
  }
  // the only transaction signed was the swap, sent to the 0x AllowanceHolder
  expect(ctx.sent.map((s) => s.to)).toEqual(["0x" + AH]);
});

test("buy needs an approval first: exact amount, spender is the AllowanceHolder", async ({ page }) => {
  await setMode("ok");
  const ctx: Ctx = { allowance: { usdg: 0n, nvda: 0n }, sent: [] };
  await rig(page, ctx);
  await page.goto("/trade");
  await expect(page.getByTestId("wallet-card")).toContainText("USDG100", { timeout: 30_000 });
  await page.getByTestId("trade-amount").fill("12.5");
  await page.getByTestId("trade-attest").check();
  await expect(page.getByTestId("trade-review")).toBeDisabled();
  await page.getByTestId("trade-approve").click();
  await expect(page.getByText(/Approved in block/)).toBeVisible({ timeout: 60_000 });
  expect(ctx.sent[0].to).toBe(USDG);
  expect(ctx.sent[0].data).toBe("0x095ea7b3" + AH.padStart(64, "0") + (12_500_000n).toString(16).padStart(64, "0"));
  await expect(page.getByTestId("trade-review")).toBeEnabled();
  await page.getByTestId("trade-review").click();
  await expect(page.getByTestId("trade-firm")).toContainText("Executable");
});

test("a quote whose transaction targets another contract is refused before the wallet", async ({ page }) => {
  await setMode("badtarget");
  const ctx: Ctx = { allowance: { usdg: 2n ** 255n, nvda: 2n ** 255n }, sent: [] };
  await rig(page, ctx);
  await page.goto("/trade");
  await expect(page.getByTestId("wallet-card")).toContainText("USDG100", { timeout: 30_000 });
  await page.getByTestId("trade-amount").fill("10");
  await page.getByTestId("trade-attest").check();
  await page.getByTestId("trade-review").click();
  await expect(page.getByTestId("trade-ticket").getByRole("alert")).toContainText("isn't the expected 0x contract");
  expect(ctx.sent).toHaveLength(0);
  await setMode("ok");
});

test("no market maker quoting: plain message, nothing to sign", async ({ page }) => {
  await setMode("noliq");
  const ctx: Ctx = { allowance: { usdg: 2n ** 255n, nvda: 2n ** 255n }, sent: [] };
  await rig(page, ctx);
  await page.goto("/trade");
  await page.getByTestId("trade-amount").fill("10");
  await expect(page.getByText(/No market maker is quoting NVDA for this amount/)).toBeVisible();
  await expect(page.getByTestId("trade-review")).toBeDisabled();
  await setMode("ok");
});
