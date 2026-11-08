import path from "node:path";
import { createRisk } from "./app";
import { serve } from "../shared/http";
import type { OrderIntent } from "../shared/types";

const PORT = Number(process.env.RISK_PORT || 4012);
const DIR = process.env.COVAR_STATE_DIR || path.join(process.cwd(), ".covar-state");

const risk = createRisk({ dir: DIR, equity: Number(process.env.RISK_START_EQUITY || 10_000) });

serve("risk", PORT, [
  { method: "POST", path: "/evaluate", handler: ({ body }) => ({ body: { decision: risk.evaluate(body.intent as OrderIntent) } }) },
  {
    method: "POST",
    path: "/fill",
    handler: ({ body }) => ({
      body: risk.applyFill({
        market: String(body.market),
        side: body.side === "sell" ? "sell" : "buy",
        qty: Number(body.qty),
        price: Number(body.price),
        fee: Number(body.fee ?? 0),
        realizedPnl: body.realizedPnl === undefined ? undefined : Number(body.realizedPnl),
      }),
    }),
  },
  {
    method: "POST",
    path: "/equity",
    handler: ({ body }) => ({ body: risk.setEquity(Number(body.equity), { resetDay: !!body.resetDay }) }),
  },
  { method: "POST", path: "/resume", handler: () => ({ body: risk.resume() }) },
  { method: "GET", path: "/state", handler: () => ({ body: risk.state() }) },
  { method: "GET", path: "/journal", handler: () => ({ body: risk.journalEntries() }) },
  { method: "GET", path: "/health", handler: () => ({ body: { service: "risk", ok: true, limits: risk.limits, state: risk.state() } }) },
]);
