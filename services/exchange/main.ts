import path from "node:path";
import { createExchange } from "./app";
import { serve } from "../shared/http";

const PORT = Number(process.env.EXCHANGE_PORT ?? 4011);
const DIR = process.env.COVAR_STATE_DIR ?? path.join(process.cwd(), ".covar-state");

const exchange = createExchange({
  dir: DIR,
  fillDelayPolls: Number(process.env.EXCHANGE_FILL_DELAY ?? 2),
  slippageBps: Number(process.env.EXCHANGE_SLIPPAGE_BPS ?? 4),
});

serve("exchange", PORT, [
  {
    method: "POST",
    path: "/orders",
    handler: ({ body }) => ({
      body: exchange.submit({
        clientOrderId: String(body.clientOrderId),
        market: String(body.market),
        side: body.side === "sell" ? "sell" : "buy",
        qty: Number(body.qty),
        price: Number(body.price),
      }),
    }),
  },
  { method: "GET", path: "/orders/:clientOrderId", handler: ({ params }) => ({ status: 200, body: exchange.get(params.clientOrderId) ?? null }) },
  { method: "POST", path: "/advance", handler: () => ({ body: { advanced: true, orders: exchange.allOrders().length } }) },
  { method: "GET", path: "/positions", handler: () => ({ body: exchange.positions() }) },
  { method: "GET", path: "/journal", handler: () => ({ body: exchange.journalEntries() }) },
  { method: "GET", path: "/health", handler: () => ({ body: { service: "exchange", ok: true, mode: "paper venue (testnet rehearsal)", venue: "Lighter-compatible stand-in" } }) },
]);

// The paper venue matches submitted orders on its own clock.
setInterval(() => exchange.advance(), 900);
