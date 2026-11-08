/**
 * Live Lighter venue adapter tests (package 3.4).
 *
 * A local mock implements the Lighter REST surface the adapter uses
 * (orderBookDetails, nextNonce, sendTx, accountActiveOrders/InactiveOrders,
 * account). sendTx receives transactions REALLY signed by the official
 * lighter-go WASM signer, and the mock decodes their tx_info to check exactly
 * what would have reached Lighter.
 *
 * With LIGHTER_WIRE=1 the suite also talks to the real Lighter on Robinhood
 * Chain testnet: it lists markets and submits an order signed with a fresh,
 * UNREGISTERED key — the exchange must parse it and refuse it with
 * "api key not found". That proves the wire format end to end without trading.
 *
 * Run: pnpm test:lighter   (LIGHTER_WIRE=1 pnpm test:lighter for the wire check)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { LighterClient, clientOrderIndexFor, lighterConfigFromEnv, baseSymbol, LIGHTER_NETWORKS, type LighterConfig } from "../../services/venue/lighter/client";
import { lighterVenueAdapter, selectVenueAdapter } from "../../services/shared/venue-adapters";
import { loadSigner } from "../../services/venue/lighter/signer";
import { createExecution } from "../../services/execution/app";
import { createRisk } from "../../services/risk/app";
import { createSigner } from "../../services/signer/app";
import { demoIntent } from "../../services/exchange/app";

/* eslint-disable @typescript-eslint/no-explicit-any */

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const eq = (name: string, a: unknown, b: unknown) => ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const throws = async (name: string, fn: () => unknown, re: RegExp) => {
  try {
    await fn();
    ok(name, false, "did not throw");
  } catch (e) {
    ok(name, re.test((e as Error).message), (e as Error).message);
  }
};

/* ---------------------------------------------------------------- mock Lighter */
type MockOrder = { order_index: number; client_order_index: number; market_index: number; is_ask: boolean; status: string; initial_base_amount: string; filled_base_amount: string; filled_quote_amount: string; price: string };
function mockLighter(opts: { fill?: "full" | "none" | "partial"; failSendOnce?: boolean } = {}) {
  const state = {
    nonce: 7,
    sent: [] as any[],
    orders: [] as MockOrder[],
    authSeen: [] as string[],
    failSendOnce: !!opts.failSendOnce,
    fill: opts.fill ?? "full",
    nonceReads: 0,
  };
  const markets = [
    { symbol: "ETH", market_id: 4095, market_type: "perp", status: "active", size_decimals: 4, price_decimals: 2, min_base_amount: "0.0050", min_quote_amount: "10.000000", last_trade_price: 3000 },
    { symbol: "BTC", market_id: 4096, market_type: "perp", status: "active", size_decimals: 5, price_decimals: 1, min_base_amount: "0.00020", min_quote_amount: "10.000000", last_trade_price: 100000 },
  ];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (body: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    let raw = "";
    for await (const c of req) raw += c;
    if (url.pathname === "/api/v1/orderBookDetails") return send({ code: 200, order_book_details: markets });
    if (url.pathname === "/api/v1/nextNonce") {
      state.nonceReads++;
      return send({ code: 200, nonce: state.nonce });
    }
    if (url.pathname === "/api/v1/sendTx") {
      const form = new URLSearchParams(raw);
      const info = JSON.parse(form.get("tx_info") ?? "{}");
      state.sent.push({ txType: Number(form.get("tx_type")), info });
      if (state.failSendOnce) {
        state.failSendOnce = false;
        return send({ code: 21104, message: "invalid nonce" });
      }
      if (info.Nonce !== state.nonce) return send({ code: 21104, message: `invalid nonce ${info.Nonce}, want ${state.nonce}` });
      state.nonce++;
      const m = markets.find((x) => x.market_id === info.MarketIndex)!;
      const base = info.BaseAmount / 10 ** m.size_decimals;
      const px = info.Price / 10 ** m.price_decimals;
      const filled = state.fill === "full" ? base : state.fill === "partial" ? base / 2 : 0;
      state.orders.push({
        order_index: 1000 + state.orders.length,
        client_order_index: info.ClientOrderIndex,
        market_index: info.MarketIndex,
        is_ask: info.IsAsk === 1,
        status: state.fill === "full" ? "filled" : "canceled-not-enough-liquidity",
        initial_base_amount: base.toFixed(m.size_decimals),
        filled_base_amount: filled.toFixed(m.size_decimals),
        filled_quote_amount: (filled * px).toFixed(6),
        price: px.toFixed(m.price_decimals),
      });
      return send({ code: 200, tx_hash: `0xmock${state.sent.length}` });
    }
    if (url.pathname === "/api/v1/accountActiveOrders" || url.pathname === "/api/v1/accountInactiveOrders") {
      const auth = String(req.headers.authorization ?? "");
      state.authSeen.push(auth);
      if (!auth) return send({ code: 20013, message: "invalid auth" });
      const active = url.pathname.endsWith("ActiveOrders") && !url.pathname.includes("Inactive");
      const mid = Number(url.searchParams.get("market_id"));
      const orders = state.orders.filter((o) => o.market_index === mid && (active ? o.status === "open" : o.status !== "open"));
      return send({ code: 200, orders });
    }
    if (url.pathname === "/api/v1/account") {
      return send({
        code: 200,
        total: 1,
        accounts: [
          {
            index: 42,
            l1_address: "0x3D2FAC269954487a63F51bf059701FbD9647E3Bf",
            collateral: "250.000000",
            available_balance: "180.000000",
            total_asset_value: "253.125000",
            positions: [{ symbol: "ETH", market_id: 4095, position: "0.0100", sign: 1, avg_entry_price: "2990.00", unrealized_pnl: "3.125000", position_value: "30.00" }],
          },
        ],
      });
    }
    res.writeHead(404).end(JSON.stringify({ code: 404, message: "not found" }));
  });
  return new Promise<{ url: string; state: typeof state; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, state, close: () => server.close() })),
  );
}

async function testConfig(apiKey: string) {
  const base = { LIGHTER_ACCOUNT_INDEX: "42", LIGHTER_API_KEY_INDEX: "5", LIGHTER_API_PRIVATE_KEY: apiKey } as Record<string, string>;
  console.log("\nConfiguration");
  const c = lighterConfigFromEnv(base);
  eq("defaults to Lighter on Robinhood Chain testnet", [c.network, c.baseUrl, c.chainId, c.collateral], ["rh-testnet", "https://api.rh-testnet.lighter.xyz", 300, "USDG"]);
  eq("RH mainnet keeps its own chain id with its URL", [LIGHTER_NETWORKS["rh-mainnet"].baseUrl, LIGHTER_NETWORKS["rh-mainnet"].chainId], ["https://api.rh.lighter.xyz", 466324]);
  await throws("missing credentials are named, not guessed", () => lighterConfigFromEnv({}), /LIGHTER_ACCOUNT_INDEX, LIGHTER_API_KEY_INDEX, LIGHTER_API_PRIVATE_KEY/);
  for (const idx of ["0", "3", "157", "255"]) await throws(`API key index ${idx} is refused (reserved/out of range)`, () => lighterConfigFromEnv({ ...base, LIGHTER_API_KEY_INDEX: idx }), /reserved/);
  await throws("mainnet needs an explicit confirmation", () => lighterConfigFromEnv({ ...base, LIGHTER_NETWORK: "rh-mainnet" }), /LIGHTER_MAINNET_CONFIRM=yes/);
  ok("mainnet loads once confirmed", lighterConfigFromEnv({ ...base, LIGHTER_NETWORK: "rh-mainnet", LIGHTER_MAINNET_CONFIRM: "yes" }).mainnet === true);
  await throws("custom network needs URL and chain id together", () => lighterConfigFromEnv({ ...base, LIGHTER_NETWORK: "custom", LIGHTER_BASE_URL: "http://x" }), /together/);
  await throws("slippage is bounded", () => lighterConfigFromEnv({ ...base, LIGHTER_SLIPPAGE_BPS: "900" }), /SLIPPAGE/);
  await throws("live venue is never selected by accident", () => {
    const prev = { ...process.env };
    process.env.VENUE_ADAPTER = "live";
    delete process.env.LIVE_TRADING_CONFIRM;
    try {
      selectVenueAdapter();
    } finally {
      process.env = prev;
    }
  }, /LIVE_TRADING_CONFIRM=yes/);

  console.log("\nIdentifiers");
  const a = clientOrderIndexFor("c-intent-1");
  ok("client order index is deterministic", a === clientOrderIndexFor("c-intent-1"));
  ok("client order index fits uint48 and is never 0", a > 0 && a < 2 ** 48);
  ok("different keys give different indexes", a !== clientOrderIndexFor("c-intent-2"));
  eq("market names map to Lighter symbols", ["ETH-PERP", "btc-usd", "SOL"].map(baseSymbol), ["ETH", "BTC", "SOL"]);
}

function cfgFor(url: string, apiKey: string): LighterConfig {
  return lighterConfigFromEnv({ LIGHTER_NETWORK: "custom", LIGHTER_BASE_URL: url, LIGHTER_CHAIN_ID: "300", LIGHTER_ACCOUNT_INDEX: "42", LIGHTER_API_KEY_INDEX: "5", LIGHTER_API_PRIVATE_KEY: apiKey });
}

async function testAdapter(apiKey: string) {
  console.log("\nSubmitting real signed orders (mock exchange)");
  const m = await mockLighter();
  try {
    const venue = lighterVenueAdapter(cfgFor(m.url, apiKey));
    const buy = await venue.submit({ clientOrderId: "c-buy-1", market: "ETH-PERP", side: "buy", qty: 0.0123, price: 3000 });
    const tx = m.state.sent[0];
    eq("tx type is CreateOrder (14)", tx.txType, 14);
    eq("size scaled by size_decimals", tx.info.BaseAmount, 123);
    eq("buy worst price = price +50 bps, scaled by price_decimals", tx.info.Price, 301500);
    eq("limit + immediate-or-cancel, no expiry (never rests unattended)", [tx.info.Type, tx.info.TimeInForce, tx.info.OrderExpiry], [0, 0, 0]);
    eq("client order index derived from our idempotency key", tx.info.ClientOrderIndex, clientOrderIndexFor("c-buy-1"));
    eq("account / API key / nonce from config and venue", [tx.info.AccountIndex, tx.info.ApiKeyIndex, tx.info.Nonce], [42, 5, 7]);
    ok("transaction carries a signature from the WASM signer", typeof tx.info.Sig === "string" && tx.info.Sig.length > 40, JSON.stringify(Object.keys(tx.info)));
    eq("submit returns open until the venue reports it", buy.status, "open");

    const got = await venue.get("c-buy-1");
    eq("filled order reported as one aggregate fill", [got?.status, got?.filledQty, got?.fills.length], ["filled", 0.0123, 1]);
    ok("average fill price from quote/base", Math.abs((got?.avgFillPrice ?? 0) - 3015) < 1e-6, String(got?.avgFillPrice));
    ok("order lookups are authenticated with an auth token", m.state.authSeen.every((a) => a.length > 20));

    await venue.submit({ clientOrderId: "c-sell-1", market: "BTC-PERP", side: "sell", qty: 0.0002, price: 100000, reduceOnly: true });
    const sell = m.state.sent[1].info;
    eq("sell worst price = price −50 bps", sell.Price, 995000);
    eq("reduce-only flag reaches the venue", [sell.IsAsk, sell.ReduceOnly], [1, 1]);
    eq("nonce increments locally without re-reading", [sell.Nonce, m.state.nonceReads], [8, 1]);

    const again = await venue.submit({ clientOrderId: "c-buy-1", market: "ETH-PERP", side: "buy", qty: 0.0123, price: 3000 });
    eq("resubmitting the same key adopts the existing order (no second tx)", [m.state.sent.length, again.status], [2, "filled"]);

    await throws("below-minimum size is refused before signing", () => venue.submit({ clientOrderId: "c-tiny", market: "ETH-PERP", side: "buy", qty: 0.001, price: 3000 }), /below ETH minimum/);
    await throws("below-minimum notional is refused before signing", () => venue.submit({ clientOrderId: "c-cheap", market: "ETH-PERP", side: "buy", qty: 0.005, price: 1000 }), /value .* below ETH minimum/);
    await throws("unlisted market is refused", () => venue.submit({ clientOrderId: "c-x", market: "DOGE-PERP", side: "buy", qty: 1, price: 1 }), /not listed/);
    eq("nothing extra was sent", m.state.sent.length, 2);

    const eqy = await venue.equity!();
    eq("equity = total_asset_value in USDG", [eqy.totalAssetValue, eqy.collateral, eqy.positions], [253.125, "USDG", 1]);
    const acct = await venue.client.account();
    eq("positions decoded", [acct.positions[0].symbol, acct.positions[0].size, acct.positions[0].unrealizedPnl], ["ETH", 0.01, 3.125]);
  } finally {
    m.close();
  }

  console.log("\nVenue outcomes");
  const none = await mockLighter({ fill: "none" });
  try {
    const venue = lighterVenueAdapter(cfgFor(none.url, apiKey));
    await venue.submit({ clientOrderId: "c-nofill", market: "ETH-PERP", side: "buy", qty: 0.01, price: 3000 });
    eq("IOC cancelled with nothing filled → rejected", (await venue.get("c-nofill"))?.status, "rejected");
  } finally {
    none.close();
  }
  const part = await mockLighter({ fill: "partial" });
  try {
    const venue = lighterVenueAdapter(cfgFor(part.url, apiKey));
    await venue.submit({ clientOrderId: "c-part", market: "ETH-PERP", side: "buy", qty: 0.02, price: 3000 });
    const g = await venue.get("c-part");
    eq("IOC partially filled → filled with the partial quantity", [g?.status, g?.filledQty], ["filled", 0.01]);
  } finally {
    part.close();
  }
  const bad = await mockLighter({ failSendOnce: true });
  try {
    const venue = lighterVenueAdapter(cfgFor(bad.url, apiKey));
    await throws("venue error surfaces with its code", () => venue.submit({ clientOrderId: "c-n1", market: "ETH-PERP", side: "buy", qty: 0.01, price: 3000 }), /21104/);
    await venue.submit({ clientOrderId: "c-n2", market: "ETH-PERP", side: "buy", qty: 0.01, price: 3000 });
    eq("after a rejected tx the nonce is re-read before the next one", bad.state.nonceReads, 2);
  } finally {
    bad.close();
  }
}

async function testExecutionIntegration(apiKey: string) {
  console.log("\nExecution service on the live adapter (mock exchange)");
  const m = await mockLighter();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covar-lighter-"));
  try {
    const risk = createRisk({ dir, equity: 10_000 });
    const signer = createSigner({ dir });
    const exec = createExecution({ dir, risk, signer, exchange: lighterVenueAdapter(cfgFor(m.url, apiKey)) });
    await exec.submitIntent(demoIntent({ intentId: "L-1", market: "ETH-PERP", qty: 0.01, price: 3000, leverage: 2 }));
    await exec.tick();
    await exec.tick();
    const o = exec.getOrder(exec.intentClientId("L-1"))!;
    eq("intent → risk → signer → Lighter → filled", o.status, "filled");
    eq("exactly one order reached Lighter", m.state.sent.length, 1);

    // restart: a brand-new adapter instance knows nothing; recovery must adopt, not resend
    const exec2 = createExecution({ dir, risk, signer, exchange: lighterVenueAdapter(cfgFor(m.url, apiKey)) });
    await exec2.submitIntent(demoIntent({ intentId: "L-1", market: "ETH-PERP", qty: 0.01, price: 3000, leverage: 2 }));
    await exec2.tick();
    eq("replaying the same intent after restart sends nothing new", m.state.sent.length, 1);
  } finally {
    m.close();
  }
}

async function testWire() {
  if (process.env.LIGHTER_WIRE !== "1") {
    console.log("\nReal Lighter RH testnet wire check: skipped (set LIGHTER_WIRE=1)");
    return;
  }
  console.log("\nReal Lighter on Robinhood Chain testnet (read + signed-but-unauthorised order)");
  const s = await loadSigner();
  const k = s.generateApiKey();
  const client = new LighterClient(
    lighterConfigFromEnv({ LIGHTER_NETWORK: "rh-testnet", LIGHTER_ACCOUNT_INDEX: "1", LIGHTER_API_KEY_INDEX: "200", LIGHTER_API_PRIVATE_KEY: k.privateKey }),
  );
  const markets = await client.listMarkets();
  ok("markets listed from the real exchange", markets.has("ETH") && markets.has("BTC"), [...markets.keys()].join(","));
  const eth = await client.market("ETH-PERP");
  ok("market decimals are read, not assumed", eth.sizeDecimals > 0 && eth.priceDecimals > 0, JSON.stringify(eth));
  const tx = await client.signCreateOrder({ market: eth, clientOrderIndex: clientOrderIndexFor(`wire-${Date.now()}`), baseAmount: Math.round(eth.minBase * 10 ** eth.sizeDecimals), price: Math.round(eth.lastPrice * 0.5 * 10 ** eth.priceDecimals), isAsk: false, reduceOnly: false });
  try {
    await client.sendTx(tx);
    ok("unregistered key must be refused", false, "order was accepted?!");
  } catch (e) {
    ok("Lighter parsed our signed order and refused only the unregistered key", /21109|api key not found/i.test((e as Error).message), (e as Error).message);
  }
}

async function main() {
  const s = await loadSigner();
  const { privateKey } = s.generateApiKey();
  await testConfig(privateKey);
  await testAdapter(privateKey);
  await testExecutionIntegration(privateKey);
  await testWire();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) console.log(`Failing: ${fails.join("; ")}`);
  process.exit(fails.length ? 1 : 0); // the Go runtime keeps Node alive otherwise
}

void main();
