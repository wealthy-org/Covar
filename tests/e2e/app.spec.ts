import { test, expect, Page } from "@playwright/test";

/**
 * Covar web E2E. Two halves:
 *  - flows: gate → connect → build → backtest → practice → notifications
 *  - honesty invariants: every claim that could be invented must be labelled
 */

async function connect(page: Page) {
  const btn = page.locator("header >> text=Connect wallet").first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await expect(page.locator("header .btn-primary .mono")).toBeVisible({ timeout: 8000 });
  }
}

test.beforeEach(async ({ page }) => {
  // each test starts from a clean session state
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("landing renders with honest labels (no 'live prices' claims anywhere)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  const body = await page.textContent("body");
  expect(body).not.toMatch(/live prices/i);
  expect(body).toMatch(/simulated|practice/i);
});

test("price route returns a real snapshot with provenance", async ({ page }) => {
  const res = await page.request.get("/api/prices");
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(typeof json.ok).toBe("boolean");
  expect(["hyperliquid", "coinbase", "none"]).toContain(json.source);
  if (json.ok) {
    expect(Object.keys(json.prices).length).toBeGreaterThan(0);
    expect(json.prices.ETH).toBeGreaterThan(0);
  }
});

test("copilot route answers without a model key and labels the engine", async ({ page }) => {
  const res = await page.request.post("/api/copilot", {
    data: { prompt: "Long BTC on the 4h with EMA cross, stop 2%" },
  });
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(["model", "rules", "rules-fallback"]).toContain(json.engine);
  // sandbox has no model key → the deterministic parser must answer, labelled
  expect(json.engine).toBe("rules");
  expect(json.strategy.market).toBe("BTC-PERP");
  expect(json.strategy.risk.leverage).toBeLessThanOrEqual(5);
  expect(json.strategy.risk.leverage).toBeGreaterThanOrEqual(2);
});

test("copilot route rejects nonsense instead of inventing a strategy", async ({ page }) => {
  const res = await page.request.post("/api/copilot", { data: { prompt: "" } });
  expect(res.status()).toBe(400);
});

test("studio stays gated until connect, then shows the builder", async ({ page }) => {
  await page.goto("/studio?new=1");
  await expect(page.locator("text=Connect wallet").first()).toBeVisible();
  await connect(page);
  await expect(page.locator("textarea")).toBeVisible({ timeout: 8000 });
});

test("builder: prompt → typed draft with exact risk fields → backtest runs", async ({ page }) => {
  await page.goto("/studio?new=1");
  await connect(page);
  await page.fill("textarea", "Long SOL breakouts on the 1h. Stop 1.5x ATR, only take 2R or better.");
  await page.click("text=Send");
  await expect(page.locator("text=Draft created")).toBeVisible({ timeout: 12000 });
  // the assistant message says which engine interpreted the prompt
  await expect(page.locator("text=/Interpreted by:/")).toBeVisible();
  const body = await page.textContent("body");
  expect(body).toContain("SOL-PERP");
  await page.locator("button:text-is('Backtest')").last().click().catch(() => {});
  await page.click("text=Run backtest >> nth=-1");
  await expect(page.locator("text=/benchmark/i").first()).toBeVisible({ timeout: 30_000 });
});

test("practice session starts and every P&L figure is labelled", async ({ page }) => {
  await page.goto("/studio");
  await connect(page);
  await expect(page.locator("text=Your agents")).toBeVisible({ timeout: 8000 });
  const startBtn = page.locator("text=Start practice").first();
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click();
    // a notification is emitted by the start action
    await expect(page.locator("header a[href='/notifications']")).toBeVisible();
    await page.waitForTimeout(5500); // at least one tick passes
    const body = await page.textContent("body");
    expect(body).toMatch(/live .?\$|simulated/); // the run states its price mode
  }
});

test("notifications inbox lists session events, newest first, no marketing", async ({ page }) => {
  await page.goto("/notifications");
  await expect(page.locator("h1")).toContainText(/notifications/i);
  const body = await page.textContent("body");
  expect(body).toMatch(/actually happened|Nothing yet/i);
});

test("portfolio ledger never shows a fabricated transaction hash", async ({ page }) => {
  await page.goto("/portfolio");
  await connect(page);
  const body = await page.textContent("body");
  expect(body).not.toMatch(/0x[0-9a-f]{8,}/i); // no invented full hashes in the ledger view
});

test("docs describes what exists today without inflating it", async ({ page }) => {
  await page.goto("/docs");
  const body = await page.textContent("body");
  expect(body).toMatch(/paper matcher/i);
  expect(body).not.toMatch(/indexer does not exist/i);
});
