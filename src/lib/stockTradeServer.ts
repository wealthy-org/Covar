/**
 * Covar Stock Trade — server side only (API routes, scripts).
 *
 * - holds the 0x API key (ZEROX_API_KEY) — it never reaches the browser
 * - enforces the region block before any quote is requested
 * - checks token identity against the Robinhood registry and the token's uid()
 * - validates every firm quote before the page may ask the wallet to sign it
 */
import {
  ALLOWANCE_HOLDER,
  DEFAULT_BLOCKED_COUNTRIES,
  DEFAULT_SLIPPAGE_BPS,
  EXEC_SELECTOR,
  MAX_SLIPPAGE_BPS,
  ROUTER_SEL,
  REGION_BLOCKED_MESSAGE,
  TRADE_CHAIN_ID,
  USDG,
  findStock,
  toUnits,
  unitPrice,
  type MarketInfo,
  type Side,
  type StockAsset,
  type TradeError,
  type TradeQuote,
} from "./stockTrade";

/* eslint-disable @typescript-eslint/no-explicit-any */

const env = (k: string) => (process.env[k] || "").trim();

export const ZEROX_BASE = () => env("ZEROX_API_BASE") || "https://api.0x.org";
export const RH_API = () => env("RH_ASSETS_API") || "https://api.robinhood.com/rhj";
export const TRADE_RPC = () =>
  env("TRADE_RPC_URL") || env("NEXT_PUBLIC_RH_MAINNET_RPC_URL") || env("NEXT_PUBLIC_RH_MAINNET_RPC") || "https://rpc.mainnet.chain.robinhood.com";

export const tradingConfigured = () => !!env("ZEROX_API_KEY") && env("TRADE_ENABLED") !== "0";

/** Tradable in the app: TRADE_ENABLED_SYMBOLS (comma list) overrides the built-in pilot flag. */
export const symbolEnabled = (asset: StockAsset) => {
  const list = env("TRADE_ENABLED_SYMBOLS");
  return list ? list.split(",").map((x) => x.trim().toUpperCase()).includes(asset.symbol) : asset.enabled;
};

/** CovarStockRouter on 4663 (set after `pnpm router:deploy`). */
export const stockRouterAddress = () => {
  const a = env("STOCK_ROUTER_ADDRESS");
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? a : null;
};

/**
 * TRADE_ROUTE: "router" (only through CovarStockRouter), "direct" (0x AllowanceHolder
 * from the user's wallet) or "auto" (router when usable, else direct).
 * Default: "router" when STOCK_ROUTER_ADDRESS is set, otherwise "direct".
 */
export const tradeRoutePolicy = (): "router" | "direct" | "auto" => {
  const v = env("TRADE_ROUTE").toLowerCase();
  if (v === "router" || v === "direct" || v === "auto") return v;
  return stockRouterAddress() ? "router" : "direct";
};

export const tradeLimits = () => ({
  minUsd: Number(env("TRADE_MIN_USD") || 1),
  maxUsd: Number(env("TRADE_MAX_USD") || 250),
});

const fail = (code: string, error: string): TradeError => ({ ok: false, code, error });

/* ------------------------------------------------------------------ region */

export interface RegionVerdict {
  allowed: boolean;
  country: string | null;
  region: string | null;
  message: string | null;
}

/** Ukraine regions under comprehensive sanctions, in case UA is ever removed from the list */
const BLOCKED_REGIONS = new Set(["UA-43", "UA-40", "UA-14", "UA-09"]);

export function regionVerdict(headers: Headers, symbol = "Stock Tokens"): RegionVerdict {
  // TRADE_DEV_COUNTRY is a local-only override; on Vercel only the edge header counts.
  const devCountry = process.env.VERCEL ? "" : env("TRADE_DEV_COUNTRY");
  const country = (headers.get("x-vercel-ip-country") || headers.get("cf-ipcountry") || devCountry || "").toUpperCase() || null;
  const regionCode = headers.get("x-vercel-ip-country-region");
  const region = country && regionCode ? `${country}-${regionCode.toUpperCase()}` : null;
  const list = (env("TRADE_BLOCKED_COUNTRIES") || DEFAULT_BLOCKED_COUNTRIES.join(","))
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  // On the hosted app a request without a country header is never trusted.
  const hosted = !!process.env.VERCEL || env("TRADE_REQUIRE_COUNTRY") === "1";
  if (!country) {
    return hosted
      ? { allowed: false, country: null, region: null, message: `We couldn't confirm your region, so ${symbol} trading is disabled for this visit.` }
      : { allowed: true, country: null, region: null, message: null };
  }
  if (list.includes(country) || country === "XX" || country === "T1" || (region && BLOCKED_REGIONS.has(region))) {
    return { allowed: false, country, region, message: REGION_BLOCKED_MESSAGE(symbol) };
  }
  return { allowed: true, country, region, message: null };
}

/* ---------------------------------------------------------------- fetching */

async function getJson(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<{ status: number; body: any }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    const text = await r.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text.slice(0, 200) };
    }
    return { status: r.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function rpc(method: string, params: unknown[]): Promise<any> {
  const { body } = await getJson(TRADE_RPC(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (body?.error) throw new Error(body.error.message || "rpc error");
  return body?.result;
}

const call = (to: string, data: string) => rpc("eth_call", [{ to, data }, "latest"]);

/* --------------------------------------------------------- registry + market */

let registryCache: { at: number; assets: any[] } | null = null;

export async function registryAssets(): Promise<any[]> {
  if (registryCache && Date.now() - registryCache.at < 10 * 60_000) return registryCache.assets;
  const { status, body } = await getJson(`${RH_API()}/assets`);
  if (status !== 200 || !Array.isArray(body?.assets)) throw new Error(`registry HTTP ${status}`);
  registryCache = { at: Date.now(), assets: body.assets };
  return body.assets;
}

/** The asset is the canonical Robinhood Stock Token: same address on 4663 and active in the registry. */
export async function registryCheck(asset: StockAsset) {
  try {
    const assets = await registryAssets();
    const hit = assets.find((a) => a.tokenSymbol === asset.symbol);
    const dep = hit?.deployments?.find((d: any) => Number(d.chainId) === TRADE_CHAIN_ID);
    const verified = !!dep && String(dep.contractAddress).toLowerCase() === asset.address.toLowerCase() && String(hit.id).toLowerCase() === asset.uid.toLowerCase();
    const sessions: Record<string, string> | null = hit?.tradingCapabilities
      ? Object.fromEntries(Object.entries(hit.tradingCapabilities).map(([k, v]: [string, any]) => [k, String(v?.fractional ?? v?.whole ?? "")]))
      : null;
    return { verified, status: hit?.status ?? null, multiplier: hit?.currentMultiplier ?? null, sessions, checkedAt: Date.now() };
  } catch {
    return { verified: false, status: null, multiplier: null, sessions: null, checkedAt: Date.now() };
  }
}

// selectors: uid(), paused(), oraclePaused(), latestRoundData()
const SEL = { uid: "0xf514ce36", paused: "0x5c975abb", oraclePaused: "0x7706ba52", latestRoundData: "0xfeaf968c" };

export async function onchainCheck(asset: StockAsset) {
  const word = (h: string | undefined | null) => (h && h.length >= 66 ? h.slice(0, 66) : null);
  const [uid, paused, oPaused] = await Promise.all([
    call(asset.address, SEL.uid).catch(() => null),
    call(asset.address, SEL.paused).catch(() => null),
    call(asset.address, SEL.oraclePaused).catch(() => null),
  ]);
  return {
    uidMatches: uid ? word(uid)!.toLowerCase() === asset.uid.toLowerCase() : null,
    paused: paused ? BigInt(word(paused)!) !== 0n : null,
    oraclePaused: oPaused ? BigInt(word(oPaused)!) !== 0n : null,
  };
}

export async function chainlinkPrice(asset: StockAsset) {
  try {
    const r: string = await call(asset.chainlinkFeed, SEL.latestRoundData);
    const words = r.slice(2).match(/.{64}/g) ?? [];
    const answer = BigInt("0x" + words[1]);
    const updatedAt = Number(BigInt("0x" + words[3]));
    return { price: Number(answer) / 1e8, updatedAt };
  } catch {
    return { price: null, updatedAt: null };
  }
}

export interface RouterStatus {
  address: string;
  /** usdg() and allowanceHolder() match the expected contracts */
  verified: boolean;
  feeBps: number;
  paused: boolean;
  supported: boolean;
}

const routerCache = new Map<string, { at: number; v: RouterStatus | null }>();

/** On-chain state of CovarStockRouter for one stock (cached 30 s). null = no router configured. */
export async function routerStatus(asset: StockAsset): Promise<RouterStatus | null> {
  const address = stockRouterAddress();
  if (!address) return null;
  const key = `${address}:${asset.address}`.toLowerCase();
  const hit = routerCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const w = (h: string) => BigInt(h && h.length >= 66 ? h.slice(0, 66) : "0x0");
  const pad = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  try {
    const [u, ah, fee, paused, sup] = await Promise.all([
      call(address, ROUTER_SEL.usdg),
      call(address, ROUTER_SEL.allowanceHolder),
      call(address, ROUTER_SEL.feeBps),
      call(address, ROUTER_SEL.paused),
      call(address, ROUTER_SEL.isStockSupported + pad(asset.address)),
    ]);
    const asAddr = (h: string) => "0x" + h.slice(-40).toLowerCase();
    const v: RouterStatus = {
      address,
      verified: asAddr(u) === USDG.address.toLowerCase() && asAddr(ah) === ALLOWANCE_HOLDER.toLowerCase(),
      feeBps: Number(w(fee)),
      paused: w(paused) !== 0n,
      supported: w(sup) !== 0n,
    };
    routerCache.set(key, { at: Date.now(), v });
    return v;
  } catch (e) {
    console.error("[trade] router status", (e as Error).message);
    const v: RouterStatus = { address, verified: false, feeBps: 0, paused: true, supported: false };
    routerCache.set(key, { at: Date.now() - 20_000, v }); // retry soon
    return v;
  }
}

const routerUsable = (r: RouterStatus | null) => !!r && r.verified && r.supported && !r.paused && r.feeBps <= 100;

/** Which path a trade in this asset takes right now, and why trading is off if it is. */
export async function resolveRoute(asset: StockAsset): Promise<{ via: "router" | "direct"; router: RouterStatus | null; problem: string | null }> {
  const policy = tradeRoutePolicy();
  const router = policy === "direct" ? null : await routerStatus(asset);
  if (policy === "direct") return { via: "direct", router: null, problem: null };
  if (routerUsable(router)) return { via: "router", router, problem: null };
  if (policy === "auto") return { via: "direct", router, problem: null };
  const why = !router
    ? "The Covar router isn't configured yet."
    : !router.verified
      ? "The Covar router address doesn't match the expected contracts."
      : router.paused
        ? "Trading through Covar is paused."
        : !router.supported
          ? `${asset.symbol} isn't registered on the Covar router yet.`
          : "The Covar router fee is out of range.";
  return { via: "router", router, problem: why };
}

export async function robinhoodQuote(asset: StockAsset) {
  try {
    const { status, body } = await getJson(`${RH_API()}/prices/${asset.symbol}`, {}, 8_000);
    const q = status === 200 ? body?.quotes?.[0] : null;
    if (!q) return null;
    const n = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
    return { bid: n(q.bid), ask: n(q.ask), tokenBid: n(q.tokenBid), tokenAsk: n(q.tokenAsk), halted: typeof q.isTradingHalt === "boolean" ? q.isTradingHalt : null, at: q.generatedAt ?? null };
  } catch {
    return null;
  }
}

export async function marketInfo(asset: StockAsset, headers: Headers): Promise<MarketInfo> {
  const [registry, onchain, robinhood, chainlink, route] = await Promise.all([registryCheck(asset), onchainCheck(asset), robinhoodQuote(asset), chainlinkPrice(asset), resolveRoute(asset)]);
  const region = regionVerdict(headers, asset.symbol);
  return {
    ok: true,
    asset: { ...asset, enabled: symbolEnabled(asset) },
    tradingEnabled: tradingConfigured() && symbolEnabled(asset) && !route.problem,
    route: {
      via: route.via,
      router: route.router ? { address: route.router.address, feeBps: route.router.feeBps, supported: route.router.supported, paused: route.router.paused, verified: route.router.verified } : null,
      problem: tradingConfigured() ? route.problem : null,
    },
    region: { allowed: region.allowed, country: region.country, message: region.message },
    registry,
    onchain,
    robinhood,
    chainlink,
    limits: tradeLimits(),
  };
}

/* -------------------------------------------------------------------- 0x */

/** 0x error names → plain language for the person trading */
function explain0x(status: number, body: any, symbol: string): TradeError {
  const name: string = body?.name || body?.code || "";
  const map: Record<string, string> = {
    INPUT_INVALID: "That amount can't be traded. Check the amount and try again.",
    SWAP_VALIDATION_FAILED: "This trade would fail on chain right now. Try a different amount or a bit later.",
    TOKEN_NOT_SUPPORTED: `${symbol} can't be routed right now.`,
    USER_NOT_AUTHORIZED: "Stock trading is temporarily unavailable. Please try again later.",
    TAKER_NOT_AUTHORIZED_FOR_TRADE: "This wallet can't trade this asset.",
    RECIPIENT_NOT_AUTHORIZED_FOR_TRADE: "This wallet can't receive this asset.",
    BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE: "Stock trading is temporarily unavailable. Please try again later.",
    SELL_TOKEN_NOT_AUTHORIZED_FOR_TRADE: "Stock trading is temporarily unavailable. Please try again later.",
    XSTOCKS_NOT_AUTHORIZED: "Stock trading is temporarily unavailable. Please try again later.",
  };
  if (map[name]) return fail(name, map[name]);
  if (status === 401 || status === 403) return fail("UNAUTHORIZED", "Stock trading is temporarily unavailable. Please try again later.");
  if (status === 429) return fail("RATE_LIMITED", "Too many price requests right now. Wait a few seconds and try again.");
  return fail(name || `HTTP_${status}`, "Couldn't get a price right now. Please try again in a moment.");
}

export interface QuoteRequest {
  symbol: string;
  side: Side;
  /** human amount of the SELL token: USDG when buying, stock tokens when selling */
  amount: string;
  taker: string;
  slippageBps?: number;
  firm: boolean;
}

/** Decode AllowanceHolder.exec(operator, token, amount, target, data) head words. */
export function decodeExec(data: string): { token: string; amount: bigint } | null {
  const d = String(data || "").toLowerCase();
  if (!d.startsWith(EXEC_SELECTOR) || d.length < 10 + 64 * 5) return null;
  const words = d.slice(10).match(/.{64}/g) ?? [];
  return { token: "0x" + words[1].slice(-40), amount: BigInt("0x" + words[2]) };
}

const hexWord = (v: bigint) => v.toString(16).padStart(64, "0");
const addrWord = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** ABI-encode buyStock / sellStock(address stock, uint256 amount, uint256 minOut, bytes swapData). */
export function encodeRouterCall(side: Side, stock: string, amount: bigint, minOut: bigint, swapData: string): string {
  const sel = side === "buy" ? ROUTER_SEL.buyStock : ROUTER_SEL.sellStock;
  const bytes = swapData.replace(/^0x/, "");
  const len = bytes.length / 2;
  const padded = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0");
  return sel + addrWord(stock) + hexWord(amount) + hexWord(minOut) + hexWord(128n) + hexWord(BigInt(len)) + padded;
}

export async function getTradeQuote(req: QuoteRequest): Promise<TradeQuote | TradeError> {
  const asset = findStock(req.symbol);
  if (!asset || !symbolEnabled(asset)) return fail("ASSET", "This asset isn't available to trade on Covar yet.");
  const hasTaker = /^0x[0-9a-fA-F]{40}$/.test(req.taker || "");
  if (req.firm && !hasTaker) return fail("TAKER", "Connect your wallet to trade.");
  if (req.side !== "buy" && req.side !== "sell") return fail("SIDE", "Choose Buy or Sell.");
  if (!tradingConfigured()) return fail("DISABLED", "Stock trading opens soon.");

  const route = await resolveRoute(asset);
  if (route.problem) return fail("ROUTE", route.problem);
  const viaRouter = route.via === "router" && !!route.router;
  const routerFeeBps = viaRouter ? BigInt(route.router!.feeBps) : 0n;

  const sellToken = req.side === "buy" ? USDG : { address: asset.address, decimals: asset.decimals, symbol: asset.symbol };
  const buyToken = req.side === "buy" ? { address: asset.address, decimals: asset.decimals, symbol: asset.symbol } : USDG;
  let userAmount: bigint;
  try {
    userAmount = toUnits(req.amount, sellToken.decimals);
  } catch (e) {
    return fail("AMOUNT", (e as Error).message);
  }
  if (userAmount <= 0n) return fail("AMOUNT", "Enter an amount greater than zero.");

  // size limits in USD (stock side valued at the Chainlink reference)
  const { minUsd, maxUsd } = tradeLimits();
  let usd: number | null = req.side === "buy" ? Number(userAmount) / 10 ** USDG.decimals : null;
  if (usd === null) {
    const cl = await chainlinkPrice(asset);
    if (cl.price) usd = (Number(userAmount) / 10 ** asset.decimals) * cl.price;
  }
  if (usd !== null && usd < minUsd) return fail("MIN", `The smallest trade is ${minUsd} USDG.`);
  if (usd !== null && usd > maxUsd) return fail("MAX", `During launch a single trade is limited to ${maxUsd} USDG.`);

  // Through the router, Covar's fee on a buy comes off the USDG before 0x sees it.
  const buyFee = viaRouter && req.side === "buy" ? (userAmount * routerFeeBps) / 10_000n : 0n;
  const zeroExSell = userAmount - buyFee;

  const slippageBps = Math.min(MAX_SLIPPAGE_BPS, Math.max(10, Math.round(req.slippageBps ?? DEFAULT_SLIPPAGE_BPS)));
  const params = new URLSearchParams({
    chainId: String(TRADE_CHAIN_ID),
    sellToken: sellToken.address,
    buyToken: buyToken.address,
    sellAmount: zeroExSell.toString(),
    slippageBps: String(slippageBps),
  });
  if (viaRouter) {
    // the router is the taker on 0x; the person signing is the transaction origin
    params.set("taker", route.router!.address);
    if (hasTaker) params.set("txOrigin", req.taker);
  } else {
    if (hasTaker) params.set("taker", req.taker);
    const feeBps = Number(env("TRADE_FEE_BPS") || 0);
    const feeRecipient = env("TRADE_FEE_RECIPIENT");
    if (feeBps > 0 && /^0x[0-9a-fA-F]{40}$/.test(feeRecipient)) {
      params.set("swapFeeBps", String(Math.min(feeBps, 100)));
      params.set("swapFeeRecipient", feeRecipient);
      params.set("swapFeeToken", USDG.address); // fee always taken in USDG
    }
  }

  let res: { status: number; body: any };
  try {
    res = await getJson(`${ZEROX_BASE()}/swap/allowance-holder/${req.firm ? "quote" : "price"}?${params}`, {
      headers: { "0x-api-key": env("ZEROX_API_KEY"), "0x-version": "v2" },
    });
  } catch {
    return fail("UPSTREAM", "Couldn't reach the pricing service. Please try again in a moment.");
  }
  const q = res.body;
  if (res.status !== 200) {
    console.error(`[trade] 0x ${req.firm ? "quote" : "price"} HTTP ${res.status} via ${route.via}`, q?.name || "", q?.message || "", q?.data?.zid || q?.zid || "");
    return explain0x(res.status, q, asset.symbol);
  }
  if (!q?.liquidityAvailable) {
    return fail("NO_LIQUIDITY", `No market maker is quoting ${asset.symbol} for this amount right now. Try a smaller amount, or try again during U.S. market hours.`);
  }

  // ---- validation: the page may only sign what we expect
  const eq = (x: unknown, y: string) => String(x ?? "").toLowerCase() === y.toLowerCase();
  if (!eq(q.sellToken, sellToken.address) || !eq(q.buyToken, buyToken.address)) return fail("MISMATCH", "The price we received doesn't match this trade. Nothing was sent.");
  if (BigInt(q.sellAmount ?? 0) !== zeroExSell) return fail("MISMATCH", "The price we received doesn't match this amount. Nothing was sent.");
  const zxSpender = q.issues?.allowance?.spender ?? q.allowanceTarget ?? null;
  if (zxSpender && !eq(zxSpender, ALLOWANCE_HOLDER)) return fail("SPENDER", "The approval target isn't the expected 0x contract, so we stopped. Nothing was sent.");
  if (req.firm) {
    const tx = q.transaction;
    if (!tx?.to || !tx?.data) return fail("NO_TX", "The quote came back without a transaction. Please try again.");
    if (!eq(tx.to, ALLOWANCE_HOLDER)) return fail("TX_TARGET", "The transaction target isn't the expected 0x contract, so we stopped. Nothing was sent.");
    if (BigInt(tx.value ?? 0) !== 0n) return fail("TX_VALUE", "This trade should not send ETH, so we stopped. Nothing was sent.");
    const ex = decodeExec(tx.data);
    if (!ex || !eq(ex.token, sellToken.address) || ex.amount !== zeroExSell) return fail("TX_DATA", "The transaction doesn't match this trade, so we stopped. Nothing was sent.");
  }

  // ---- amounts as the USER sees them (after Covar's fee on the router path)
  const zxBuy = BigInt(q.buyAmount ?? 0);
  const zxMin = q.minBuyAmount ? BigInt(q.minBuyAmount) : null;
  const sellFee = (v: bigint) => (viaRouter && req.side === "sell" ? (v * routerFeeBps) / 10_000n : 0n);
  const userBuy = zxBuy - sellFee(zxBuy);
  const userMin = zxMin === null ? null : zxMin - sellFee(zxMin);
  const covarFee = req.side === "buy" ? buyFee : sellFee(zxBuy);

  const usdgUnits = req.side === "buy" ? userAmount : userBuy;
  const stockUnits = req.side === "buy" ? userBuy : userAmount;
  const fee = (f: any) => (f && f.amount ? { amount: String(f.amount), token: String(f.token) } : null);
  const integrator = viaRouter ? (covarFee > 0n ? { amount: covarFee.toString(), token: USDG.address } : null) : fee(q.fees?.integratorFee);

  let transaction: TradeQuote["transaction"];
  if (req.firm) {
    const zx = q.transaction;
    if (viaRouter) {
      if (userMin === null) return fail("NO_MIN", "The quote came back without a minimum. Please try again.");
      transaction = {
        to: route.router!.address,
        data: encodeRouterCall(req.side, asset.address, userAmount, userMin, String(zx.data)),
        gas: zx.gas ? String(BigInt(zx.gas) + 150_000n) : null, // router: pull, fee, approve/reset, forward
        gasPrice: String(zx.gasPrice ?? "0"),
        value: "0",
      };
    } else {
      transaction = { to: String(zx.to), data: String(zx.data), gas: zx.gas ? String(zx.gas) : null, gasPrice: String(zx.gasPrice ?? "0"), value: "0" };
    }
  }

  return {
    ok: true,
    firm: req.firm,
    side: req.side,
    symbol: asset.symbol,
    sellToken: sellToken.address,
    buyToken: buyToken.address,
    sellAmount: userAmount.toString(),
    buyAmount: userBuy.toString(),
    minBuyAmount: userMin === null ? null : userMin.toString(),
    price: unitPrice(usdgUnits, stockUnits, asset.decimals),
    fees: { zeroEx: fee(q.fees?.zeroExFee), integrator, gas: fee(q.fees?.gasFee) },
    networkFeeWei: q.totalNetworkFee ? String(q.totalNetworkFee) : null,
    // on the router path 0x's allowance/balance issues describe the router, not the user: the page checks the user itself
    allowance: !viaRouter && q.issues?.allowance ? { spender: String(q.issues.allowance.spender), actual: String(q.issues.allowance.actual) } : null,
    balance: !viaRouter && q.issues?.balance ? { token: String(q.issues.balance.token), actual: String(q.issues.balance.actual), expected: String(q.issues.balance.expected) } : null,
    simulationIncomplete: !viaRouter && !!q.issues?.simulationIncomplete,
    route: Array.isArray(q.route?.fills) ? q.route.fills.map((f: any) => ({ source: String(f.source), proportionBps: String(f.proportionBps) })) : [],
    blockNumber: q.blockNumber ? String(q.blockNumber) : null,
    zid: String(q.zid ?? ""),
    slippageBps,
    transaction,
    via: viaRouter ? "router" : "direct",
    spender: viaRouter ? route.router!.address : ALLOWANCE_HOLDER,
    quotedAt: Date.now(),
  };
}

/* ------------------------------------------------------------- rate limit */

const hits = new Map<string, number[]>();
/** tiny per-instance limiter: `max` requests per `windowMs` per key */
export function rateLimited(key: string, max = 40, windowMs = 60_000): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5_000) hits.clear();
  return arr.length > max;
}

export const clientKey = (h: Headers) => (h.get("x-forwarded-for") || h.get("x-real-ip") || "local").split(",")[0].trim();
