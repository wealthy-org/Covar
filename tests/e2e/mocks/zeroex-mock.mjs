// Minimal stand-in for the 0x Swap API (AllowanceHolder) used by tests/e2e/trade.spec.ts.
// Response shape follows docs.0x.org getPrice/getQuote (v2). Numbers mirror a real
// mainnet sell of 0.5 NVDA for 81.045664 USDG (tx 0x000d658d…ff3ff, block 113,974,803).
import http from "node:http";

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const AH = "0x0000000000001ff3684f28c67538d4d072c22734";
const PRICE = 162.091328; // USDG per NVDA
const port = Number(process.env.PORT || 4099);
let MODE = process.env.MOCK_MODE || "ok";
const mode = () => MODE;
const calls = [];
const SETTLER = "0xe8852602f84e04e284286d8db01a41edd0ccefb0";
const pad = (h) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
/** AllowanceHolder.exec(operator, token, amount, target, data) — same shape as a real 0x quote */
function execCalldata(token, amount) {
  const inner = "1fff991f" + "00".repeat(60);
  const len = inner.length / 2;
  return "0x2213bc0b" + pad(SETTLER) + pad(token) + pad(amount.toString(16)) + pad(SETTLER) + pad("a0") + pad(len.toString(16)) + inner.padEnd(Math.ceil(inner.length / 64) * 64, "0");
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    calls.push(u.pathname + u.search);
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === "/__calls") return send(200, calls);
    if (u.pathname === "/__mode") {
      MODE = u.searchParams.get("m") || "ok";
      return send(200, { mode: MODE });
    }
    if (!req.headers["0x-api-key"]) return send(401, { message: "No API key found in request" });
    const firm = u.pathname.endsWith("/quote");
    if (!u.pathname.startsWith("/swap/allowance-holder/")) return send(404, { message: "not found" });
    const q = Object.fromEntries(u.searchParams);
    if (q.chainId !== "4663") return send(400, { name: "INPUT_INVALID", message: "bad chain", data: { zid: "z" } });
    if (mode() === "noliq") return send(200, { liquidityAvailable: false, zid: "0xmock-noliq" });
    if (mode() === "badtarget" && firm) {
      // a quote whose transaction does NOT target AllowanceHolder must be refused by Covar
      q.__to = "0x000000000000000000000000000000000000dEaD";
    }
    const sell = BigInt(q.sellAmount);
    const buying = q.sellToken.toLowerCase() === USDG; // USDG → NVDA
    const buyAmount = buying
      ? (sell * 10n ** 12n * 1_000_000n) / BigInt(Math.round(PRICE * 1e6)) // 6 → 18 decimals
      : (sell * BigInt(Math.round(PRICE * 1e6))) / 10n ** 18n;
    const slip = BigInt(q.slippageBps || 100);
    const minBuy = (buyAmount * (10_000n - slip)) / 10_000n;
    const body = {
      allowanceTarget: AH,
      blockNumber: "114125000",
      buyAmount: buyAmount.toString(),
      buyToken: q.buyToken,
      fees: { integratorFee: null, integratorFees: null, zeroExFee: { amount: buying ? (sell * 15n / 10_000n).toString() : (buyAmount * 15n / 10_000n).toString(), token: USDG, type: "volume" }, gasFee: null },
      issues: { allowance: null, balance: null, simulationIncomplete: false, invalidSourcesPassed: [] },
      liquidityAvailable: true,
      minBuyAmount: minBuy.toString(),
      mode: "exactIn",
      route: { fills: [{ from: q.sellToken, to: q.buyToken, source: "0x_RFQ", proportionBps: "10000" }], tokens: [] },
      sellAmount: q.sellAmount,
      sellToken: q.sellToken,
      tokenMetadata: { buyToken: { buyTaxBps: "0", sellTaxBps: "0" }, sellToken: { buyTaxBps: "0", sellTaxBps: "0" } },
      totalNetworkFee: "2500000000000",
      zid: "0xmock" + Date.now(),
    };
    if (firm) body.transaction = { to: q.__to || AH, data: execCalldata(q.sellToken, BigInt(q.sellAmount)), gas: "350000", gasPrice: "10000000", value: "0" };
    send(200, body);
  })
  .listen(port, "127.0.0.1", () => console.log(`0x mock on :${port}`));
