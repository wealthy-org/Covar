/**
 * Stock Trade server helpers — the parts that decide what a wallet is asked to sign.
 *
 *   pnpm test:trade
 */
import assert from "node:assert/strict";
import { AbiCoder, Interface, id } from "ethers";
import { encodeRouterCall, decodeExec, regionVerdict } from "../src/lib/stockTradeServer";
import { ROUTER_SEL, ROUTER_TOPICS, EXEC_SELECTOR, routerEvent, netTransfers, STOCKS, findStock, USDG } from "../src/lib/stockTrade";
import { marketStateAt, labelFor } from "../src/lib/stockPrices";

let passed = 0;
let failed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").join("\n    ")}`);
  }
}

const ROUTER = new Interface([
  "function usdg() view returns (address)",
  "function allowanceHolder() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function paused() view returns (bool)",
  "function isStockSupported(address) view returns (bool)",
  "function buyStock(address,uint256,uint256,bytes)",
  "function sellStock(address,uint256,uint256,bytes)",
  "event StockPurchased(address indexed buyer, address indexed stock, uint256 usdgIn, uint256 stockOut, uint256 fee)",
  "event StockSold(address indexed seller, address indexed stock, uint256 stockIn, uint256 usdgOut, uint256 fee)",
]);
const EXEC = new Interface(["function exec(address operator,address token,uint256 amount,address target,bytes data)"]);
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const SETTLER = "0xE8852602f84e04e284286d8Db01a41Edd0CCEFb0";
const ROUTER_ADDR = "0x1111111111111111111111111111111111111111";
const ALICE = "0x5CF7db17B8444504B0b2C2Cfe71e3E8351505464";

(async () => {
  console.log("stock trade helpers");

  await t("selectors and topics are the ones ethers computes", () => {
    for (const [k, v] of Object.entries(ROUTER_SEL)) assert.equal(v, ROUTER.getFunction(k)!.selector, k);
    assert.equal(ROUTER_TOPICS.StockPurchased, ROUTER.getEvent("StockPurchased")!.topicHash);
    assert.equal(ROUTER_TOPICS.StockSold, ROUTER.getEvent("StockSold")!.topicHash);
    assert.equal(EXEC_SELECTOR, id("exec(address,address,uint256,address,bytes)").slice(0, 10));
  });

  await t("router calldata encoder matches ethers byte for byte (all padding cases)", () => {
    for (const len of [0, 1, 31, 32, 33, 64, 1445]) {
      const swap = EXEC.encodeFunctionData("exec", [SETTLER, USDG.address, 49_925_000n, SETTLER, "0x" + "ab".repeat(len)]);
      for (const side of ["buy", "sell"] as const) {
        const mine = encodeRouterCall(side, NVDA, 50_000_000n, 306_000_000_000_000_000n, swap);
        const ref = ROUTER.encodeFunctionData(side === "buy" ? "buyStock" : "sellStock", [NVDA, 50_000_000n, 306_000_000_000_000_000n, swap]);
        assert.equal(mine.toLowerCase(), ref.toLowerCase(), `${side} len ${len}`);
      }
    }
  });

  await t("decodeExec reads token + amount from real 0x calldata, refuses anything else", () => {
    const swap = EXEC.encodeFunctionData("exec", [SETTLER, NVDA, 500_000_000_000_000_000n, SETTLER, "0x1fff991f"]);
    assert.deepEqual(decodeExec(swap), { token: NVDA.toLowerCase(), amount: 500_000_000_000_000_000n });
    assert.equal(decodeExec("0x095ea7b3" + "00".repeat(64)), null);
    assert.equal(decodeExec("0x2213bc0b"), null);
  });

  await t("routerEvent decodes StockPurchased / StockSold from the router only", () => {
    const coder = AbiCoder.defaultAbiCoder();
    const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const buy = { address: ROUTER_ADDR, topics: [ROUTER_TOPICS.StockPurchased, pad(ALICE), pad(NVDA)], data: coder.encode(["uint256", "uint256", "uint256"], [50_000_000n, 306_000_000_000_000_000n, 75_000n]) };
    const e = routerEvent([buy], ROUTER_ADDR)!;
    assert.equal(e.kind, "StockPurchased");
    assert.equal(e.trader, ALICE.toLowerCase());
    assert.equal(e.stock, NVDA.toLowerCase());
    assert.equal(e.usdg, 50_000_000n);
    assert.equal(e.stockAmount, 306_000_000_000_000_000n);
    assert.equal(e.fee, 75_000n);
    const sell = { address: ROUTER_ADDR, topics: [ROUTER_TOPICS.StockSold, pad(ALICE), pad(NVDA)], data: coder.encode(["uint256", "uint256", "uint256"], [500_000_000_000_000_000n, 80_924_096n, 121_568n]) };
    const s = routerEvent([sell], ROUTER_ADDR)!;
    assert.equal(s.kind, "StockSold");
    assert.equal(s.usdg, 80_924_096n);
    assert.equal(s.stockAmount, 500_000_000_000_000_000n);
    // the same event from another contract is not proof
    assert.equal(routerEvent([{ ...buy, address: "0x2222222222222222222222222222222222222222" }], ROUTER_ADDR), null);
    assert.equal(routerEvent([buy], null), null);
  });

  await t("netTransfers: wallet ↔ router hops net out to what the wallet actually moved", () => {
    const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const T = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const w = (v: bigint) => "0x" + v.toString(16).padStart(64, "0");
    const logs = [
      { address: USDG.address, topics: [T, pad(ALICE), pad(ROUTER_ADDR)], data: w(50_000_000n) },
      { address: USDG.address, topics: [T, pad(ROUTER_ADDR), pad("0x3333333333333333333333333333333333333333")], data: w(75_000n) },
      { address: NVDA, topics: [T, pad(ROUTER_ADDR), pad(ALICE)], data: w(306n) },
    ];
    const n = netTransfers(logs, ALICE);
    assert.equal(n[USDG.address.toLowerCase()], -50_000_000n);
    assert.equal(n[NVDA.toLowerCase()], 306n);
  });

  await t("region: blocked list, unknown country on Vercel, dev override ignored on Vercel", () => {
    const h = (c?: string) => new Headers(c ? { "x-vercel-ip-country": c } : {});
    assert.equal(regionVerdict(h("ID"), "NVDA").allowed, true);
    assert.equal(regionVerdict(h("US"), "NVDA").allowed, false);
    assert.match(regionVerdict(h("GB"), "NVDA").message ?? "", /NVDA is not available for trading in your region/);
    assert.equal(regionVerdict(h("PR"), "NVDA").allowed, false);
    const prev = { ...process.env };
    process.env.VERCEL = "1";
    process.env.TRADE_DEV_COUNTRY = "ID";
    assert.equal(regionVerdict(h(), "NVDA").allowed, false, "no header on Vercel must block even with TRADE_DEV_COUNTRY");
    delete process.env.VERCEL;
    assert.equal(regionVerdict(h(), "NVDA").allowed, true, "local dev override works off Vercel");
    process.env = prev;
  });

  await t("asset list: 8 official tokens, NVDA is the only pilot enabled by default", () => {
    assert.deepEqual(STOCKS.map((s) => s.symbol), ["NVDA", "TSLA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "AMD"]);
    assert.deepEqual(STOCKS.filter((s) => s.enabled).map((s) => s.symbol), ["NVDA"]);
    assert.equal(findStock("tsla")?.address, "0x322F0929c4625eD5bAd873c95208D54E1c003b2d");
    for (const s of STOCKS) assert.match(s.address, /^0x[0-9a-fA-F]{40}$/);
  });

  await t("market state + 'Market Closed · Using Last Close' label", () => {
    const period = { pre: { start: 100, end: 200 }, regular: { start: 200, end: 300 }, post: { start: 300, end: 400 } };
    assert.equal(marketStateAt(250, period), "open");
    assert.equal(marketStateAt(150, period), "pre");
    assert.equal(marketStateAt(350, period), "post");
    assert.equal(marketStateAt(500, period), "closed");
    assert.equal(labelFor("closed", "yahoo"), "Market Closed · Using Last Close");
    assert.equal(labelFor("open", "yahoo"), "Live");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
