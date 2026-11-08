/**
 * Venue adapters — the only place execution learns how to reach a venue.
 *
 * Select with VENUE_ADAPTER=paper|live (default: paper).
 *
 *  - paper: the local paper venue (:4011). Matches on its own clock, is keyed by
 *    clientOrderId, and is explicitly a rehearsal environment — not a real venue.
 *  - live:  Lighter (default: Lighter on Robinhood Chain testnet), real orders
 *    signed with the official lighter-go WASM signer. Boot fails with a precise
 *    reason if credentials are missing, the key index is reserved, or a mainnet
 *    network is selected without LIGHTER_MAINNET_CONFIRM=yes. Additionally
 *    LIVE_TRADING_CONFIRM=yes is required so "live" is never selected by accident.
 */
import { getJson, postJson } from "./http";
import type { VenuePort } from "../execution/app";
import type { VenueOrder } from "./types";
import { LighterClient, clientOrderIndexFor, lighterConfigFromEnv, type LighterConfig } from "../venue/lighter/client";

export interface VenueAdapter extends VenuePort {
  /** What this adapter actually is — surfaced on /execution alongside health. */
  descriptor: string;
  /** Account equity at the venue in collateral units, when the venue can report it. */
  equity?: () => Promise<{ totalAssetValue: number; collateral: string; positions: number }>;
}

export function paperVenueAdapter(exchangeUrl: string): VenueAdapter {
  return {
    descriptor: `paper venue at ${exchangeUrl} (Lighter-compatible stand-in, simulated fills)`,
    submit: (order) => postJson<VenueOrder>(`${exchangeUrl}/orders`, order),
    get: async (clientOrderId) => (await getJson<VenueOrder | null>(`${exchangeUrl}/orders/${clientOrderId}`)) ?? undefined,
    advance: async () => {
      await postJson(`${exchangeUrl}/advance`, {});
    },
  };
}

/**
 * Live Lighter venue.
 *
 * Orders are limit + immediate-or-cancel at the intent price ± LIGHTER_SLIPPAGE_BPS,
 * so nothing rests on the book unattended and the worst fill price is bounded.
 * The client order index is derived from our clientOrderId (sha256 → uint48), so a
 * resubmission after a crash is found at the venue and adopted, never doubled.
 * Fills are reported once the order is terminal, as one aggregate fill.
 */
export function lighterVenueAdapter(cfg: LighterConfig, fetchImpl: typeof fetch = fetch): VenueAdapter & { client: LighterClient } {
  const client = new LighterClient(cfg, fetchImpl);
  const meta = new Map<string, { market: string; marketId: number; side: "buy" | "sell"; qty: number; price: number; createdAt: string; txHash?: string }>();

  const toVenueOrder = (clientOrderId: string, o: Awaited<ReturnType<LighterClient["findOrder"]>>): VenueOrder | undefined => {
    const m = meta.get(clientOrderId);
    if (!o || !m) return undefined;
    const terminal = o.status === "filled" || o.status.startsWith("canceled");
    const filled = o.filledBase;
    const avg = filled > 0 ? o.filledQuote / filled : 0;
    const status: VenueOrder["status"] = !terminal ? "open" : filled > 0 ? "filled" : "rejected";
    return {
      clientOrderId,
      orderId: `lighter:${cfg.network}:${o.orderIndex}`,
      market: m.market,
      side: m.side,
      qty: m.qty,
      price: m.price,
      status,
      filledQty: terminal ? filled : 0,
      avgFillPrice: terminal ? Number(avg.toFixed(8)) : 0,
      // Standard-tier fees on Lighter RH are 0%/0%; fee is taken from the venue's own
      // trade records by the reconciliation job, not guessed here.
      fills: status === "filled" ? [{ fillId: `${o.orderIndex}:final`, clientOrderId, qty: filled, price: Number(avg.toFixed(8)), fee: 0, at: new Date().toISOString() }] : [],
      createdAt: m.createdAt,
    };
  };

  return {
    client,
    descriptor: `LIVE Lighter ${cfg.network} (${cfg.baseUrl}, chain ${cfg.chainId}) · account #${cfg.accountIndex} · API key #${cfg.apiKeyIndex} · collateral ${cfg.collateral} — real orders`,
    async submit(input) {
      const market = await client.market(input.market);
      const coi = clientOrderIndexFor(input.clientOrderId);
      const createdAt = new Date().toISOString();
      meta.set(input.clientOrderId, { market: input.market, marketId: market.marketId, side: input.side, qty: input.qty, price: input.price, createdAt });

      // idempotency: an order with this client index already at the venue is adopted, not re-sent
      const existing = await client.findOrder(market.marketId, coi).catch(() => null);
      if (existing) return toVenueOrder(input.clientOrderId, existing)!;

      const baseAmount = Math.round(input.qty * 10 ** market.sizeDecimals);
      if (baseAmount <= 0 || input.qty < market.minBase) throw new Error(`Order size ${input.qty} below ${market.symbol} minimum ${market.minBase}`);
      if (input.qty * input.price < market.minQuote) throw new Error(`Order value ${(input.qty * input.price).toFixed(2)} below ${market.symbol} minimum ${market.minQuote}`);
      const isAsk = input.side === "sell";
      const worst = input.price * (1 + ((isAsk ? -1 : 1) * cfg.slippageBps) / 10_000);
      const price = Math.round(worst * 10 ** market.priceDecimals);

      const tx = await client.signCreateOrder({ market, clientOrderIndex: coi, baseAmount, price, isAsk, reduceOnly: !!input.reduceOnly });
      const { txHash } = await client.sendTx(tx);
      meta.get(input.clientOrderId)!.txHash = txHash;
      return {
        clientOrderId: input.clientOrderId,
        orderId: `lighter-tx:${txHash}`,
        market: input.market,
        side: input.side,
        qty: input.qty,
        price: input.price,
        status: "open",
        filledQty: 0,
        avgFillPrice: 0,
        fills: [],
        createdAt,
      };
    },
    async get(clientOrderId) {
      const m = meta.get(clientOrderId);
      if (!m) return undefined; // unknown to this process: recovery must call submit() again, which adopts by client index
      const o = await client.findOrder(m.marketId, clientOrderIndexFor(clientOrderId));
      return toVenueOrder(clientOrderId, o);
    },
    async advance() {
      // the real venue matches on its own; nothing to drive
    },
    async equity() {
      const a = await client.account();
      return { totalAssetValue: a.totalAssetValue, collateral: cfg.collateral, positions: a.positions.filter((p) => p.size !== 0).length };
    },
  };
}

export const LIVE_CONFIRM_REFUSAL =
  "VENUE_ADAPTER=live sends REAL orders to Lighter. Set LIVE_TRADING_CONFIRM=yes to acknowledge (and LIGHTER_MAINNET_CONFIRM=yes for a mainnet network).";

export function selectVenueAdapter(): VenueAdapter {
  const which = (process.env.VENUE_ADAPTER || "paper").toLowerCase();
  // Refuse AT BOOT when the live configuration is incomplete: a process configured
  // for a live venue never starts half-configured, and never paper-trades under a live label.
  if (which === "live") {
    if (process.env.LIVE_TRADING_CONFIRM !== "yes") throw new Error(LIVE_CONFIRM_REFUSAL);
    return lighterVenueAdapter(lighterConfigFromEnv());
  }
  if (which === "paper") return paperVenueAdapter(process.env.EXCHANGE_URL || "http://127.0.0.1:4011");
  throw new Error(`Unknown VENUE_ADAPTER "${which}" (expected paper|live). Refusing to guess.`);
}
