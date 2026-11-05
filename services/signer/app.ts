import { Journal } from "../shared/journal";
import type { OrderIntent } from "../shared/types";

/**
 * Isolated signer.
 *
 * Exactly one kind of request is honoured: an order intent for an allowlisted
 * market, produced by the execution service. Withdrawals, transfers, approvals
 * and contract calls are refused by construction — AI output and creator input
 * never reach a key, so an injected instruction cannot move funds.
 *
 * In this build the "signature" is a deterministic stand-in (no key material is
 * held here). The boundary it demonstrates is the point: what is *allowed* to be
 * signed, and what is recorded when something is refused.
 */
export interface SignRequest {
  clientOrderId: string;
  intent: OrderIntent;
  destination?: string; // withdrawals would carry one — orders never do
}

export function createSigner(opts: { dir: string; allowedMarkets?: string[] }) {
  const journal = new Journal(opts.dir, "signer");
  const allowed = new Set(opts.allowedMarkets ?? ["ETH-PERP", "BTC-PERP", "SOL-PERP", "HYPE-PERP", "USDG-PERP"]);
  let signed = 0;
  let refused = 0;

  function sign(req: SignRequest): { ok: true; signature: string } | { ok: false; error: string } {
    const refuse = (error: string) => {
      refused++;
      journal.append("signer", "refused", { clientOrderId: req.clientOrderId, error, destination: req.destination ?? null });
      return { ok: false as const, error };
    };

    if (req.destination) return refuse("orders never carry a destination; only an order intent can be signed");
    if (!allowed.has(req.intent.market)) return refuse(`market ${req.intent.market} is not enabled for signing`);
    if (!(req.intent.qty > 0)) return refuse("non-positive size");
    if (!/^[a-z0-9-]+$/i.test(req.clientOrderId)) return refuse("malformed client order id");

    signed++;
    const signature = `sig_${Buffer.from(`${req.clientOrderId}:${req.intent.market}:${req.intent.side}:${req.intent.qty}`).toString("base64url").slice(0, 24)}`;
    journal.append("signer", "signed", { clientOrderId: req.clientOrderId, market: req.intent.market, signature });
    return { ok: true as const, signature };
  }

  return {
    sign,
    stats: () => ({ signed, refused, allowedMarkets: [...allowed] }),
    journalEntries: () => journal.read(),
  };
}

export type Signer = ReturnType<typeof createSigner>;
