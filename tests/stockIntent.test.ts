/**
 * Instant Stock Agent intent parser — bilingual cases from the architecture brief
 * plus the edge cases that would otherwise put a wrong number in front of a wallet.
 *
 *   pnpm test:intent
 */
import assert from "node:assert/strict";
import { parseStockIntent, intentCore, describeIntent, type StockTradeIntent } from "../src/lib/stockIntent";

let passed = 0;
let failed = 0;
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").join("\n    ")}`);
  }
}
const ok = (text: string): StockTradeIntent => {
  const r = parseStockIntent(text);
  if (!r.ok) throw new Error(`expected ok for "${text}", got ${r.code}: ${r.message}`);
  return r.intent;
};
const no = (text: string) => {
  const r = parseStockIntent(text);
  if (r.ok) throw new Error(`expected a refusal for "${text}", got ${JSON.stringify(r.intent)}`);
  return r;
};

console.log("stock intent parser");

t("brief QA #4: Indonesian and English produce identical intents", () => {
  const id = ok("Beli 50 USDG NVDA jual pas untung 4%");
  const en = ok("Buy $50 NVDA take profit 4%");
  assert.deepEqual(intentCore(id), intentCore(en));
  assert.deepEqual(intentCore(en), { kind: "stock_trade", side: "BUY", stock: "NVDA", amountUsdg: 50, takeProfitPct: 4, amountDefaulted: false });
  assert.equal(id.lang, "id");
  assert.equal(en.lang, "en");
});

t("leader's prompt: beli sekarang, jual pas naik 3–5% → TP 4%", () => {
  const i = ok("beli $50 NVDA sekarang, jual pas naik 3-5%");
  assert.equal(i.side, "BUY");
  assert.equal(i.amountUsdg, 50);
  assert.equal(i.takeProfitPct, 4);
  assert.equal(ok("buy 50 usdg of nvidia, sell when up 3–5%").takeProfitPct, 4);
  assert.equal(ok("Beli NVDA 100 USDG jual pas naik 3 sampai 5%").takeProfitPct, 4);
});

t("the user journey prompt from the brief", () => {
  const i = ok("Beli $50 NVDA, jual pas naik 4%");
  assert.deepEqual(intentCore(i), { kind: "stock_trade", side: "BUY", stock: "NVDA", amountUsdg: 50, takeProfitPct: 4, amountDefaulted: false });
  const j = ok("Beli NVDA senilai 50 USDG, tolong jual pas profit 4%");
  assert.deepEqual(intentCore(j), intentCore(i));
});

t("the percentage is never read as the amount", () => {
  const i = ok("beli nvda tp 4%");
  assert.equal(i.amountUsdg, 50);
  assert.equal(i.amountDefaulted, true);
  assert.equal(i.takeProfitPct, 4);
  assert.equal(ok("buy NVDA +5% take profit, $20").amountUsdg, 20);
});

t("sell by value, by shares, and all", () => {
  assert.deepEqual(intentCore(ok("Jual NVDA $50")), { kind: "stock_trade", side: "SELL", stock: "NVDA", amountUsdg: 50, amountDefaulted: false });
  assert.deepEqual(intentCore(ok("sell 0.3 NVDA")), { kind: "stock_trade", side: "SELL", stock: "NVDA", amountShares: 0.3, amountDefaulted: false });
  assert.equal(ok("jual 0,5 saham nvda").amountShares, 0.5);
  assert.equal(ok("jual 2 lembar NVDA").amountShares, 2);
  const all = ok("jual semua NVDA");
  assert.equal(all.sellAll, true);
  assert.equal(all.amountUsdg, undefined);
  assert.equal(ok("sell all my nvidia").sellAll, true);
});

t("a sell without an amount asks instead of guessing", () => {
  assert.equal(no("jual NVDA").code, "NO_AMOUNT");
  assert.equal(no("sell nvda").code, "NO_AMOUNT");
});

t("stop-loss in both languages, TP and SL together", () => {
  const a = ok("buy $40 NVDA take profit 5% stop loss 2%");
  const b = ok("beli 40 usdg nvda, jual pas naik 5%, cut loss 2%");
  assert.deepEqual(intentCore(a), intentCore(b));
  assert.equal(a.takeProfitPct, 5);
  assert.equal(a.stopLossPct, 2);
  assert.equal(ok("beli nvda $10 jual kalau turun 3%").stopLossPct, 3);
});

t("company names and other tickers", () => {
  assert.equal(ok("buy $25 of tesla").stock, "TSLA");
  assert.equal(ok("beli apple 30 usd").stock, "AAPL");
  assert.equal(ok("Buy $15 GOOGL").stock, "GOOGL");
  assert.equal(ok("buy $15 google tp 3%").stock, "GOOGL");
  assert.equal(ok("beli $10 $NVDA").stock, "NVDA");
  // "amd" inside another word is not AMD
  assert.equal(no("buy $10 of ramdisk").code, "NO_STOCK");
});

t("unknown tickers and nonsense are refused with a reason", () => {
  const r = no("buy $50 COIN");
  assert.equal(r.code, "UNSUPPORTED_STOCK");
  assert.match(r.message, /COIN/);
  assert.equal(no("halo apa kabar").code, "NO_STOCK");
  assert.equal(no("NVDA to the moon").code, "NO_SIDE");
  assert.equal(no("").code, "EMPTY");
});

t("thousands separators follow the language", () => {
  assert.equal(ok("buy $1,000 NVDA").amountUsdg, 1000);
  assert.equal(ok("beli NVDA senilai 1.000 USDG").amountUsdg, 1000);
  assert.equal(ok("beli NVDA 12,5 USDG").amountUsdg, 12.5);
  assert.equal(ok("buy NVDA 12.5 USDG").amountUsdg, 12.5);
  assert.equal(ok("sell 0.300 NVDA").amountShares, 0.3);
  assert.equal(ok("buy $1,250.50 NVDA").amountUsdg, 1250.5);
});

t("bad numbers are refused", () => {
  assert.equal(no("buy $0 NVDA").code, "BAD_NUMBER");
  assert.equal(no("buy $50 NVDA take profit 500%").code, "BAD_NUMBER");
});

t("the first action word decides the side", () => {
  assert.equal(ok("Beli 50 USDG NVDA jual pas untung 4%").side, "BUY");
  assert.equal(ok("sell 1 NVDA then buy later").side, "SELL");
});

t("TP/SL are ignored on a sell (they belong to a position)", () => {
  const i = ok("sell 1 NVDA take profit 4%");
  assert.equal(i.takeProfitPct, undefined);
});

t("copilot reply answers in the user's language with the target price", () => {
  const id = describeIntent(ok("Beli $50 NVDA, jual pas naik 4%"), { price: 162.85, label: "Market Closed · Using Last Close" });
  assert.match(id, /pembelian NVDA senilai 50\.00 USDG/);
  assert.match(id, /\+4% \(\$169\.36\)/);
  assert.match(id, /Market Closed · Using Last Close/);
  const en = describeIntent(ok("Buy $50 NVDA take profit 4%"), { price: 162.85 });
  assert.match(en, /buy of NVDA for 50\.00 USDG/);
  assert.match(en, /\$169\.36/);
});

t("parsing is instant (< 100 ms for 1,000 prompts)", () => {
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) parseStockIntent("Beli 50 USDG NVDA jual pas untung 4%, stop loss 2%");
  const ms = performance.now() - t0;
  assert.ok(ms < 100, `took ${ms.toFixed(1)} ms`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
