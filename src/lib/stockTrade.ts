/**
 * Covar Stock Trade — shared constants and pure helpers (browser + server).
 *
 * Spot swaps between USDG and Robinhood Stock Tokens on Robinhood Chain
 * mainnet, quoted and routed by the 0x Swap API (AllowanceHolder flow, RWA
 * trading enabled), signed in the user's own wallet. Covar never holds the
 * tokens and never sees a key.
 *
 * Sources of truth
 *   - token identity  : Robinhood asset registry (api.robinhood.com/rhj/assets)
 *                       + the token's own uid() on chain
 *   - reference price : Robinhood Stock Token API (/rhj/prices) and the Chainlink
 *                       feed for the token — shown as REFERENCE, never as the
 *                       execution price
 *   - execution price : the 0x quote for this exact pair, size and wallet
 *   - proof           : the transaction receipt (Transfer logs) and balances after
 */

/** Stock Tokens live on Robinhood Chain mainnet only — independent of the vault's network. */
export const TRADE_CHAIN_ID = 4663 as const;

export const USDG = {
  symbol: "USDG",
  name: "Global Dollar",
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
} as const;

/**
 * 0x AllowanceHolder on Robinhood Chain (same address and bytecode as on
 * Arbitrum, verified on chain). Approvals go ONLY to this contract, and a firm
 * quote whose transaction targets anything else is rejected.
 */
export const ALLOWANCE_HOLDER = "0x0000000000001fF3684f28c67538d4D072C22734";

export interface StockAsset {
  symbol: string;
  name: string;
  /** canonical Robinhood Stock Token (from the official registry) */
  address: string;
  /** on-chain uid() — equals the registry id */
  uid: string;
  decimals: number;
  /** Chainlink "Robinhood <SYM> / USD" feed proxy on 4663 (8 decimals) */
  chainlinkFeed: string;
  isin?: string;
  /** tradable in Covar today; other assets are added once the first pair is proven */
  enabled: boolean;
}

/**
 * Official Robinhood Stock Tokens Covar knows about (registry id = on-chain uid(),
 * Chainlink "Robinhood <SYM> / USD" 24/5 feed — all checked on chain 4663).
 * `enabled` = tradable in the app today. NVDA is the pilot; the others are shown
 * with prices and can be switched on with TRADE_ENABLED_SYMBOLS once the router
 * has them registered (setStockSupported) — no code change, no redeploy.
 */
export const STOCKS: StockAsset[] = [
  { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", uid: "0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5", decimals: 18, chainlinkFeed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", isin: "US67066G1040", enabled: true },
  { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", uid: "0x00000000000000000000000000000000cfece3244ea34bb29414dd9488b32d9f", decimals: 18, chainlinkFeed: "0x4A1166a659A55625345e9515b32adECea5547C38", isin: "US88160R1014", enabled: false },
  { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", uid: "0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649", decimals: 18, chainlinkFeed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", isin: "US0378331005", enabled: false },
  { symbol: "MSFT", name: "Microsoft", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", uid: "0x00000000000000000000000000000000307bb0113ca54f93adf80f4ff2bf681a", decimals: 18, chainlinkFeed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E", isin: "US5949181045", enabled: false },
  { symbol: "GOOGL", name: "Alphabet Class A", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", uid: "0x0000000000000000000000000000000053b69e2076884cc9ae2ada9bc7095df3", decimals: 18, chainlinkFeed: "0xF6f373a037c30F0e5010d854385cA89185AE638b", isin: "US02079K3059", enabled: false },
  { symbol: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", uid: "0x000000000000000000000000000000004f508d5e2a7042299694d85c2f362ad2", decimals: 18, chainlinkFeed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", isin: "US0231351067", enabled: false },
  { symbol: "META", name: "Meta Platforms", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", uid: "0x00000000000000000000000000000000343e7beca03644bcba2e50b8236784f5", decimals: 18, chainlinkFeed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1", isin: "US30303M1027", enabled: false },
  { symbol: "AMD", name: "AMD", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", uid: "0x0000000000000000000000000000000086aeaac3c7d9422c90f6fd41aff0eaf7", decimals: 18, chainlinkFeed: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72", isin: "US0079031078", enabled: false },
];

export const findStock = (symbol: string | null | undefined) =>
  STOCKS.find((s) => s.symbol.toLowerCase() === String(symbol ?? "").toLowerCase()) ?? null;

export type Side = "buy" | "sell";

/** slippage the user can pick; the default leans safe for thin RFQ markets */
export const SLIPPAGE_CHOICES_BPS = [50, 100, 200] as const;
/** brief: minimums are computed with at most 0.5% slippage by default */
export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 300;

/**
 * Jurisdictions where trading is disabled (ISO 3166-1 alpha-2).
 * - 0x RWA agreement: the United States and comprehensively sanctioned jurisdictions.
 * - Issuer (Robinhood Assets (Jersey) Ltd, docs.robinhood.com/rhj/restricted-jurisdictions):
 *   U.S. + U.S. persons, Canada, United Kingdom, Switzerland, and Prohibited
 *   Investors in Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine,
 *   South Sudan, Sudan, Myanmar, Venezuela. UAE is listed in Robinhood's launch
 *   disclosures, so it is blocked too.
 * - U.S. territories are treated as the United States.
 * Override with TRADE_BLOCKED_COUNTRIES (comma-separated) on the server.
 */
export const DEFAULT_BLOCKED_COUNTRIES = [
  "US", "PR", "GU", "VI", "AS", "MP", "UM",
  "CA", "GB", "CH", "AE",
  "CU", "BY", "IR", "KP", "RU", "SY", "UA", "SS", "SD", "MM", "VE",
] as const;

export const REGION_BLOCKED_MESSAGE = (symbol: string) =>
  `${symbol} is not available for trading in your region at this time.`;

/**
 * CovarStockRouter (contracts/CovarStockRouter.sol): Covar's own entry point on
 * chain. It runs the 0x calldata through the AllowanceHolder, takes Covar's fee,
 * enforces the minimum and emits StockPurchased / StockSold. Selectors and
 * topics computed with ethers.id (never typed by hand).
 */
export const ROUTER_SEL = {
  usdg: "0xf5b91b7b",
  allowanceHolder: "0x11886685",
  feeBps: "0x24a9d853",
  paused: "0x5c975abb",
  isStockSupported: "0xb8896b92",
  buyStock: "0xe3d9303f",
  sellStock: "0x8e18f5f6",
} as const;
export const ROUTER_TOPICS = {
  StockPurchased: "0x07efe390e8ad8d1dd9f2c3cf35af301c7dc10e7ab8bab860a35b725773d04eb8",
  StockSold: "0x08f0255253d2410c7cf27ede930af6c3833d97d8176357a3d9c0d23b5d73d96f",
} as const;
/** AllowanceHolder.exec(address,address,uint256,address,bytes) */
export const EXEC_SELECTOR = "0x2213bc0b";

export interface RouterEvent {
  kind: "StockPurchased" | "StockSold";
  router: string;
  trader: string;
  stock: string;
  /** StockPurchased: usdgIn, stockOut · StockSold: stockIn, usdgOut */
  usdg: bigint;
  stockAmount: bigint;
  fee: bigint;
}

/** The router's own event in a receipt (proof that the swap ran through Covar). */
export function routerEvent(logs: RawLog[], router: string | null | undefined): RouterEvent | null {
  if (!router) return null;
  for (const l of logs) {
    if (l.address.toLowerCase() !== router.toLowerCase() || l.topics.length < 3) continue;
    const t0 = l.topics[0].toLowerCase();
    const kind = t0 === ROUTER_TOPICS.StockPurchased ? "StockPurchased" : t0 === ROUTER_TOPICS.StockSold ? "StockSold" : null;
    if (!kind) continue;
    const w = (l.data.replace(/^0x/, "").match(/.{64}/g) ?? []).map((x) => BigInt("0x" + x));
    const addr = (t: string) => "0x" + t.slice(-40);
    return {
      kind,
      router: l.address,
      trader: addr(l.topics[1]),
      stock: addr(l.topics[2]),
      usdg: kind === "StockPurchased" ? w[0] : w[1],
      stockAmount: kind === "StockPurchased" ? w[1] : w[0],
      fee: w[2] ?? 0n,
    };
  }
  return null;
}

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
}

/**
 * Net token movement for `wallet` in one receipt, per token contract.
 * Positive = received, negative = sent. Reads only ERC-20 Transfer logs.
 */
export function netTransfers(logs: RawLog[], wallet: string): Record<string, bigint> {
  const me = wallet.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const out: Record<string, bigint> = {};
  for (const l of logs) {
    if (!l.topics?.length || l.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || l.topics.length < 3) continue;
    const from = l.topics[1].toLowerCase().replace(/^0x/, "");
    const to = l.topics[2].toLowerCase().replace(/^0x/, "");
    if (from !== me && to !== me) continue;
    const amount = BigInt(l.data && l.data !== "0x" ? l.data : "0x0");
    const token = l.address.toLowerCase();
    out[token] = (out[token] ?? 0n) + (to === me ? amount : 0n) - (from === me ? amount : 0n);
  }
  return out;
}

/** "12.5" → base units. Throws a plain-language error on malformed input. */
export function toUnits(input: string, decimals: number): bigint {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter an amount as a number, for example 25 or 12.5.");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`Use at most ${decimals} digits after the decimal point.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** base units → "1,234.5678" (trimmed trailing zeros, at most maxFrac decimals) */
export function fromUnits(v: bigint, decimals: number, maxFrac = 6): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = (a % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  if (decimals === 0) frac = "";
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}${w}${frac ? "." + frac : ""}`;
}

/** USDG per one stock token, from two base-unit amounts. */
export function unitPrice(usdgUnits: bigint, stockUnits: bigint, stockDecimals = 18): number {
  if (stockUnits === 0n) return 0;
  // scale to 1e8 precision without floating the big numbers
  const scaled = (usdgUnits * 10n ** BigInt(stockDecimals) * 100_000_000n) / (stockUnits * 10n ** BigInt(USDG.decimals));
  return Number(scaled) / 1e8;
}

/** Normalised quote the API returns to the page (strings for every big number). */
export interface TradeQuote {
  ok: true;
  firm: boolean;
  side: Side;
  symbol: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string | null;
  /** USDG per token implied by this quote */
  price: number;
  fees: {
    zeroEx: { amount: string; token: string } | null;
    integrator: { amount: string; token: string } | null;
    gas: { amount: string; token: string } | null;
  };
  /** estimated network fee in wei (ETH) */
  networkFeeWei: string | null;
  allowance: { spender: string; actual: string } | null;
  balance: { token: string; actual: string; expected: string } | null;
  simulationIncomplete: boolean;
  route: { source: string; proportionBps: string }[];
  blockNumber: string | null;
  zid: string;
  slippageBps: number;
  /** firm quotes only */
  transaction?: { to: string; data: string; gas: string | null; gasPrice: string; value: string };
  /** "router": through CovarStockRouter (Covar fee, on-chain minimum, Covar event) · "direct": 0x AllowanceHolder */
  via: "router" | "direct";
  /** the contract the user approves (router or AllowanceHolder) */
  spender: string;
  quotedAt: number;
}

export interface TradeError {
  ok: false;
  code: string;
  error: string;
}

export interface MarketInfo {
  ok: true;
  asset: StockAsset;
  tradingEnabled: boolean;
  region: { allowed: boolean; country: string | null; message: string | null };
  registry: {
    verified: boolean;
    status: string | null;
    multiplier: string | null;
    sessions: Record<string, string> | null;
    checkedAt: number;
  };
  onchain: { uidMatches: boolean | null; paused: boolean | null; oraclePaused: boolean | null };
  robinhood: { bid: number | null; ask: number | null; tokenBid: number | null; tokenAsk: number | null; halted: boolean | null; at: string | null } | null;
  chainlink: { price: number | null; updatedAt: number | null } | null;
  limits: { minUsd: number; maxUsd: number };
  route: {
    via: "router" | "direct";
    router: { address: string; feeBps: number; supported: boolean; paused: boolean; verified: boolean } | null;
    /** why trading is off although a key is set, e.g. router not configured for this stock */
    problem: string | null;
  };
}
