/**
 * Venue adapters — the only place execution learns how to reach a venue.
 *
 * Select with VENUE_ADAPTER=paper|live (default: paper).
 *
 *  - paper: the local paper venue (:4011). Matches on its own clock, is keyed by
 *    clientOrderId, and is explicitly a rehearsal environment — not a real venue.
 *  - live:  NOT implemented. Any attempt to select it fails at boot with a clear
 *    reason instead of silently paper-trading under a "live" label. Wiring a real
 *    venue (signing, credentials, rate limits) is a deliberate, reviewable step.
 */
import { getJson, postJson } from "./http";
import type { VenuePort } from "../execution/app";
import type { VenueOrder } from "./types";

export interface VenueAdapter extends VenuePort {
  /** What this adapter actually is — surfaced on /execution alongside health. */
  descriptor: string;
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

export const LIVE_VENUE_REFUSAL =
  "VENUE_ADAPTER=live selected but no live venue adapter exists yet: credentials, signing and idempotency " +
  "must be reviewed against the real venue API before any order may leave this process. Refusing to boot rather than paper-trading under a live label.";

export function selectVenueAdapter(): VenueAdapter {
  const which = (process.env.VENUE_ADAPTER ?? "paper").toLowerCase();
  // Refuse AT BOOT: a process configured for a live venue never starts, so nothing
  // it owns can ever quietly paper-trade under a live label.
  if (which === "live") throw new Error(LIVE_VENUE_REFUSAL);
  if (which === "paper") return paperVenueAdapter(process.env.EXCHANGE_URL ?? "http://127.0.0.1:4011");
  throw new Error(`Unknown VENUE_ADAPTER "${which}" (expected paper|live). Refusing to guess.`);
}
