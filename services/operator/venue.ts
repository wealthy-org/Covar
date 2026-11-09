/**
 * Venue-side ports for the operator.
 *
 * Equity (term 3 of the NAV formula):
 *   none     the vault has no capital at a venue → 0. If capital *was* allocated,
 *            the NAV drop trips the deviation guard instead of being reported.
 *   manual   OPERATOR_VENUE_EQUITY_USDG, a declared figure (journaled as manual)
 *   lighter  Lighter account `total_asset_value` (collateral + unrealised PnL)
 *
 * Closing (withdrawal step 2):
 *   execution    reduce-only exits for the investor's fraction of every position,
 *                submitted to the execution service (risk, idempotency, journal)
 *   no-positions the vault does not trade (yet): nothing to close → done
 *   manual       a human closes and calls markPositionsClosed from the console
 */
import { getJson, postJson } from "../shared/http";
import { round, TERMINAL, type OrderIntent, type OrderRecord, type Position } from "../shared/types";
import { LighterClient, lighterConfigFromEnv } from "../venue/lighter/client";
import type { CloseStatus, ClosePort, VenueEquityPort } from "./app";

/** "123.4567891" → 123456789n (6 dp, truncated). Rejects anything that is not a plain decimal. */
export function usdgUnits(value: string | number): bigint {
  const s = typeof value === "number" ? value.toFixed(6) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a decimal amount: ${value}`);
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  const v = BigInt(i) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  return neg ? -v : v;
}

export function equityPortFromEnv(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): VenueEquityPort {
  const mode = (env.OPERATOR_VENUE || "none").toLowerCase();
  if (mode === "none") return { describe: "none (vault-only NAV)", equity: async () => 0n };
  if (mode === "manual") {
    const raw = env.OPERATOR_VENUE_EQUITY_USDG;
    if (!raw) throw new Error("OPERATOR_VENUE=manual requires OPERATOR_VENUE_EQUITY_USDG");
    const v = usdgUnits(raw);
    return { describe: `manual (${raw} USDG declared)`, equity: async () => v };
  }
  if (mode === "lighter") {
    const client = new LighterClient(lighterConfigFromEnv(env, { readOnly: true }), fetchImpl);
    return {
      describe: `lighter ${client.cfg.network} account #${client.cfg.accountIndex}`,
      equity: async () => {
        const a = await client.account();
        if (!Number.isFinite(a.totalAssetValue)) throw new Error("Lighter returned no total_asset_value");
        return usdgUnits(a.totalAssetValue);
      },
    };
  }
  throw new Error(`OPERATOR_VENUE must be none | manual | lighter (got "${mode}")`);
}

/* ------------------------------------------------------------------ closing */

const prefixFor = (r: { investor: string; requestedAt: number }) => `wd-${r.investor.toLowerCase()}-${r.requestedAt}-`;

/** The reduce-only exits for `fraction` of each open position (6 dp, rounded down). */
export function exitsFor(positions: Position[], fraction: number) {
  return positions
    .filter((p) => Math.abs(p.qty) > 0)
    .map((p) => ({ market: p.market, side: (p.qty > 0 ? "sell" : "buy") as "buy" | "sell", qty: Math.floor(Math.abs(p.qty) * fraction * 1e6) / 1e6, ref: p.avgPrice }))
    .filter((e) => e.qty > 0);
}

type ExecState = { execution: { orders: OrderRecord[]; positions: Position[]; intents: OrderIntent[] } };

export function executionClosePort(opts: { execUrl: string; agentId?: string; price?: (market: string) => Promise<number | null> }): ClosePort {
  const state = async () => {
    const s = await getJson<ExecState>(`${opts.execUrl}/state`);
    if (!s?.execution) throw new Error(`execution service at ${opts.execUrl} is not answering`);
    return s.execution;
  };
  return {
    describe: `execution service ${opts.execUrl}`,
    async status(r, fraction): Promise<CloseStatus> {
      const s = await state();
      const ours = s.orders.filter((o) => o.intentId.startsWith(prefixFor(r)));
      if (ours.length === 0) return exitsFor(s.positions, fraction).length === 0 ? "done" : "not_started";
      if (ours.some((o) => o.status === "failed" || o.status === "risk_rejected")) return "failed";
      return ours.every((o) => TERMINAL.includes(o.status)) ? "done" : "pending";
    },
    async start(r, fraction) {
      const s = await state();
      for (const e of exitsFor(s.positions, fraction)) {
        const price = (await opts.price?.(e.market)) ?? e.ref;
        const intent: OrderIntent = {
          // deterministic → replaying a cycle after a crash cannot double-close
          intentId: `${prefixFor(r)}${e.market}`,
          agentId: opts.agentId ?? "vault-operator",
          market: e.market,
          side: e.side,
          qty: e.qty,
          price: round(price, 6),
          reduceOnly: true,
          leverage: 1,
          strategyVersion: 0,
          proposedBy: "rules",
          copilotDecision: "rules_only",
          createdAt: new Date().toISOString(),
        };
        await postJson(`${opts.execUrl}/intents`, { intent });
      }
    },
  };
}

export function closePortFromEnv(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): ClosePort {
  const venue = (env.OPERATOR_VENUE || "none").toLowerCase();
  const mode = (env.OPERATOR_CLOSE || (venue === "none" ? "no-positions" : "execution")).toLowerCase();
  if (mode === "no-positions") return { describe: "no-positions (vault does not trade)", status: async () => "done", start: async () => undefined };
  if (mode === "manual") return { describe: "manual (human marks positions closed)", status: async () => "pending", start: async () => undefined };
  if (mode === "execution") {
    let price: ((m: string) => Promise<number | null>) | undefined;
    if (venue === "lighter") {
      const client = new LighterClient(lighterConfigFromEnv(env, { readOnly: true }), fetchImpl);
      price = async (m) => (await client.market(m).catch(() => null))?.lastPrice || null;
    }
    return executionClosePort({ execUrl: env.EXEC_URL || "http://127.0.0.1:4010", price });
  }
  throw new Error(`OPERATOR_CLOSE must be execution | no-positions | manual (got "${mode}")`);
}
