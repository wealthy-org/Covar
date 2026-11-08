/**
 * Lighter REST client (docs.lighter.xyz/api).
 *
 * One config object keeps base URL and signing chain ID together — Lighter's own
 * checklist warns that both testnets use chain ID 300, so the chain ID alone
 * never identifies an exchange.
 *
 * Lighter on Robinhood Chain ("RH") is the default: its collateral is USDG on
 * Robinhood Chain, the same asset the Covar vault holds (verified: RH mainnet
 * assetDetails lists USDG at 0x5fc5…d168, the vault's mainnet asset).
 */
import { createHash } from "node:crypto";
import { loadSigner, type LighterSigner, type SignedTx } from "./signer";

/* eslint-disable @typescript-eslint/no-explicit-any -- REST payloads are decoded defensively below */

export const LIGHTER_NETWORKS = {
  "rh-testnet": { baseUrl: "https://api.rh-testnet.lighter.xyz", chainId: 300, collateral: "USDG", mainnet: false },
  "rh-mainnet": { baseUrl: "https://api.rh.lighter.xyz", chainId: 466324, collateral: "USDG", mainnet: true },
  "zk-testnet": { baseUrl: "https://testnet.zklighter.elliot.ai", chainId: 300, collateral: "USDC", mainnet: false },
  "zk-mainnet": { baseUrl: "https://mainnet.zklighter.elliot.ai", chainId: 304, collateral: "USDC", mainnet: true },
} as const;
export type LighterNetwork = keyof typeof LIGHTER_NETWORKS;

export interface LighterConfig {
  network: LighterNetwork | "custom";
  baseUrl: string;
  chainId: number;
  collateral: string;
  mainnet: boolean;
  accountIndex: number;
  apiKeyIndex: number;
  apiPrivateKey: string;
  /** Worst-price buffer for IOC orders, in basis points of the intent price. */
  slippageBps: number;
}

/** Reads LIGHTER_* env. Throws a precise reason instead of guessing. */
export function lighterConfigFromEnv(env: Record<string, string | undefined> = process.env, opts: { readOnly?: boolean } = {}): LighterConfig {
  const network = (env.LIGHTER_NETWORK ?? "rh-testnet") as LighterConfig["network"];
  let base: { baseUrl: string; chainId: number; collateral: string; mainnet: boolean };
  if (network === "custom") {
    // used by tests against a local mock; both values must be given together
    if (!env.LIGHTER_BASE_URL || !env.LIGHTER_CHAIN_ID) throw new Error("LIGHTER_NETWORK=custom needs LIGHTER_BASE_URL and LIGHTER_CHAIN_ID together");
    base = { baseUrl: env.LIGHTER_BASE_URL, chainId: Number(env.LIGHTER_CHAIN_ID), collateral: env.LIGHTER_COLLATERAL ?? "USDG", mainnet: false };
  } else if (network in LIGHTER_NETWORKS) {
    base = LIGHTER_NETWORKS[network as LighterNetwork];
  } else {
    throw new Error(`Unknown LIGHTER_NETWORK "${network}" (expected ${Object.keys(LIGHTER_NETWORKS).join(" | ")})`);
  }
  const accountIndex = Number(env.LIGHTER_ACCOUNT_INDEX);
  const apiKeyIndex = Number(env.LIGHTER_API_KEY_INDEX);
  const apiPrivateKey = env.LIGHTER_API_PRIVATE_KEY ?? "";
  if (opts.readOnly) {
    // public reads (account equity, markets) need only the account index — no key, no trading
    if (!Number.isInteger(accountIndex) || env.LIGHTER_ACCOUNT_INDEX === undefined) throw new Error("Reading a Lighter account needs LIGHTER_ACCOUNT_INDEX");
    return { network, ...base, accountIndex, apiKeyIndex: -1, apiPrivateKey: "", slippageBps: 50 };
  }
  const missing = [
    !Number.isInteger(accountIndex) || env.LIGHTER_ACCOUNT_INDEX === undefined ? "LIGHTER_ACCOUNT_INDEX" : null,
    !Number.isInteger(apiKeyIndex) || env.LIGHTER_API_KEY_INDEX === undefined ? "LIGHTER_API_KEY_INDEX" : null,
    !apiPrivateKey ? "LIGHTER_API_PRIVATE_KEY" : null,
  ].filter(Boolean);
  if (missing.length) throw new Error(`Live Lighter venue needs ${missing.join(", ")} (set on the server, never in chat or git)`);
  // RH reserves 0–3 and 157 for Lighter's own apps; mainnet reserves 0–3.
  if (apiKeyIndex < 4 || apiKeyIndex > 254 || (network.startsWith("rh") && apiKeyIndex === 157)) {
    throw new Error(`LIGHTER_API_KEY_INDEX ${apiKeyIndex} is reserved; use 4–156 or 158–254`);
  }
  if (base.mainnet && env.LIGHTER_MAINNET_CONFIRM !== "yes") {
    throw new Error(`LIGHTER_NETWORK=${network} trades real funds. Set LIGHTER_MAINNET_CONFIRM=yes only after the testnet acceptance run passed.`);
  }
  const slippageBps = Number(env.LIGHTER_SLIPPAGE_BPS ?? 50);
  if (!(slippageBps >= 1 && slippageBps <= 500)) throw new Error("LIGHTER_SLIPPAGE_BPS must be between 1 and 500");
  return { network, ...base, accountIndex, apiKeyIndex, apiPrivateKey, slippageBps };
}

export interface LighterMarket {
  symbol: string;
  marketId: number;
  sizeDecimals: number;
  priceDecimals: number;
  minBase: number;
  minQuote: number;
  lastPrice: number;
  status: string;
}

export interface LighterOrder {
  orderIndex: number;
  clientOrderIndex: number;
  marketId: number;
  isAsk: boolean;
  status: string;
  initialBase: number;
  filledBase: number;
  filledQuote: number;
  price: number;
}

export interface LighterAccount {
  index: number;
  l1Address: string;
  /** Total account value in collateral units (USDG on RH): collateral + unrealised PnL. */
  totalAssetValue: number;
  collateral: number;
  availableBalance: number;
  positions: { symbol: string; marketId: number; size: number; sign: number; avgEntryPrice: number; unrealizedPnl: number; positionValue: number }[];
}

/** Stable uint48 client order index from our idempotency key (never 0). */
export function clientOrderIndexFor(clientOrderId: string): number {
  const h = createHash("sha256").update(clientOrderId).digest();
  const v = h.readUIntBE(0, 6) % (2 ** 48 - 1);
  return v + 1;
}

/** "BTC-PERP" / "BTC-USD" / "btc" → "BTC". */
export const baseSymbol = (market: string) => market.toUpperCase().replace(/[-_/](PERP|USD|USDC|USDG)$/, "");

const num = (v: any) => (v === undefined || v === null || v === "" ? 0 : Number(v));

export class LighterClient {
  private markets: Map<string, LighterMarket> | null = null;
  private marketsAt = 0;
  private nonce: number | null = null;
  private token: { value: string; until: number } | null = null;
  private signer: LighterSigner | null = null;
  calls = 0;

  constructor(
    readonly cfg: LighterConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async signerReady(): Promise<LighterSigner> {
    if (this.signer) return this.signer;
    const s = await loadSigner();
    s.createClient({ privateKey: this.cfg.apiPrivateKey, chainId: this.cfg.chainId, apiKeyIndex: this.cfg.apiKeyIndex, accountIndex: this.cfg.accountIndex });
    this.signer = s;
    return s;
  }

  async get(path: string, opts: { auth?: boolean } = {}): Promise<any> {
    const headers: Record<string, string> = {};
    if (opts.auth) headers.Authorization = await this.authToken();
    this.calls++;
    const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
    const json: any = await res.json().catch(() => ({ code: res.status, message: `non-JSON response (${res.status})` }));
    if (json.code !== undefined && json.code !== 200) throw new LighterError(json.code, json.message ?? "error", path);
    return json;
  }

  async authToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.until - 600 > now) return this.token.value;
    const s = await this.signerReady();
    const until = now + 6 * 3600;
    const value = s.authToken({ apiKeyIndex: this.cfg.apiKeyIndex, accountIndex: this.cfg.accountIndex, deadlineUnix: until });
    this.token = { value, until };
    return value;
  }

  async listMarkets(force = false): Promise<Map<string, LighterMarket>> {
    if (!force && this.markets && Date.now() - this.marketsAt < 5 * 60_000) return this.markets;
    const r = await this.get("/api/v1/orderBookDetails");
    const m = new Map<string, LighterMarket>();
    for (const d of r.order_book_details ?? []) {
      if (d.market_type && d.market_type !== "perp") continue;
      m.set(String(d.symbol).toUpperCase(), {
        symbol: String(d.symbol).toUpperCase(),
        marketId: Number(d.market_id),
        sizeDecimals: Number(d.size_decimals ?? d.supported_size_decimals),
        priceDecimals: Number(d.price_decimals ?? d.supported_price_decimals),
        minBase: num(d.min_base_amount),
        minQuote: num(d.min_quote_amount),
        lastPrice: num(d.last_trade_price) || num(d.mark_price),
        status: String(d.status ?? "active"),
      });
    }
    this.markets = m;
    this.marketsAt = Date.now();
    return m;
  }

  async market(marketName: string): Promise<LighterMarket> {
    const sym = baseSymbol(marketName);
    const m = (await this.listMarkets()).get(sym);
    if (!m) throw new Error(`Market ${marketName} (${sym}) is not listed on Lighter ${this.cfg.network}`);
    if (m.status !== "active") throw new Error(`Market ${sym} is ${m.status} on Lighter ${this.cfg.network}`);
    return m;
  }

  async nextNonce(): Promise<number> {
    if (this.nonce === null) {
      const r = await this.get(`/api/v1/nextNonce?account_index=${this.cfg.accountIndex}&api_key_index=${this.cfg.apiKeyIndex}`);
      this.nonce = Number(r.nonce);
    }
    return this.nonce++;
  }

  resyncNonce() {
    this.nonce = null;
  }

  async sendTx(tx: SignedTx): Promise<{ txHash: string }> {
    this.calls++;
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/api/v1/sendTx`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ tx_type: String(tx.txType), tx_info: tx.txInfo }),
      signal: AbortSignal.timeout(10_000),
    });
    const json: any = await res.json().catch(() => ({ code: res.status, message: "non-JSON response" }));
    if (json.code !== 200) {
      // a rejected tx may or may not consume the nonce: re-read it before the next one
      this.resyncNonce();
      throw new LighterError(json.code, json.message ?? "sendTx failed", "sendTx");
    }
    return { txHash: String(json.tx_hash ?? tx.txHash ?? "") };
  }

  async signCreateOrder(o: { market: LighterMarket; clientOrderIndex: number; baseAmount: number; price: number; isAsk: boolean; reduceOnly: boolean }) {
    const s = await this.signerReady();
    return s.createOrder({
      marketIndex: o.market.marketId,
      clientOrderIndex: o.clientOrderIndex,
      baseAmount: o.baseAmount,
      price: o.price,
      isAsk: o.isAsk,
      orderType: 0, // limit …
      timeInForce: 0, // … immediate-or-cancel: never rests on the book unattended
      reduceOnly: o.reduceOnly,
      orderExpiry: 0, // IOC orders carry no expiry
      nonce: await this.nextNonce(),
      apiKeyIndex: this.cfg.apiKeyIndex,
      accountIndex: this.cfg.accountIndex,
    });
  }

  async account(): Promise<LighterAccount> {
    const r = await this.get(`/api/v1/account?by=index&value=${this.cfg.accountIndex}`);
    const a = r.accounts?.[0];
    if (!a) throw new Error(`Lighter account #${this.cfg.accountIndex} not found on ${this.cfg.network}`);
    return {
      index: Number(a.index ?? a.account_index),
      l1Address: String(a.l1_address ?? ""),
      totalAssetValue: num(a.total_asset_value),
      collateral: num(a.collateral),
      availableBalance: num(a.available_balance),
      positions: (a.positions ?? []).map((p: any) => ({
        symbol: String(p.symbol),
        marketId: Number(p.market_id),
        size: num(p.position),
        sign: Number(p.sign ?? 1),
        avgEntryPrice: num(p.avg_entry_price),
        unrealizedPnl: num(p.unrealized_pnl),
        positionValue: num(p.position_value),
      })),
    };
  }

  /** Finds our order by client order index: active first, then recent inactive. */
  async findOrder(marketId: number, clientOrderIndex: number): Promise<LighterOrder | null> {
    const idx = this.cfg.accountIndex;
    const active = await this.get(`/api/v1/accountActiveOrders?account_index=${idx}&market_id=${marketId}`, { auth: true });
    let hit = (active.orders ?? []).find((o: any) => Number(o.client_order_index) === clientOrderIndex);
    if (!hit) {
      const inactive = await this.get(`/api/v1/accountInactiveOrders?account_index=${idx}&market_id=${marketId}&limit=100`, { auth: true });
      hit = (inactive.orders ?? []).find((o: any) => Number(o.client_order_index) === clientOrderIndex);
    }
    if (!hit) return null;
    return {
      orderIndex: Number(hit.order_index),
      clientOrderIndex: Number(hit.client_order_index),
      marketId: Number(hit.market_index ?? marketId),
      isAsk: !!hit.is_ask,
      status: String(hit.status),
      initialBase: num(hit.initial_base_amount),
      filledBase: num(hit.filled_base_amount),
      filledQuote: num(hit.filled_quote_amount),
      price: num(hit.price),
    };
  }
}

export class LighterError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly where: string,
  ) {
    super(`Lighter ${where}: ${code} ${message}`);
  }
}
