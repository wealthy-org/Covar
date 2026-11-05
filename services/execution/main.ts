import path from "node:path";
import { createExecution } from "./app";
import { serve, postJson, getJson } from "../shared/http";

import type { OrderIntent, RiskDecision } from "../shared/types";
import { selectVenueAdapter } from "../shared/venue-adapters";

/**
 * Execution service process.
 *
 * Talks to the risk, signer and venue services over HTTP — they are separate
 * processes with separate journals, so "risk cannot be bypassed" and "the signer
 * refuses withdrawals" are boundaries, not conventions.
 *
 * Boot sequence: replay the intent journal, then reconcile against the venue
 * before accepting anything new. A restart must never place a duplicate order.
 */
const PORT = Number(process.env.EXEC_PORT ?? 4010);
const DIR = process.env.COVAR_STATE_DIR ?? path.join(process.cwd(), ".covar-state");
const RISK_URL = process.env.RISK_URL ?? "http://127.0.0.1:4012";
const SIGNER_URL = process.env.SIGNER_URL ?? "http://127.0.0.1:4013";
const EXCHANGE_URL = process.env.EXCHANGE_URL ?? "http://127.0.0.1:4011";

// The venue is selected through the adapter seam: paper (default) or live (which
// refuses to boot — no silent paper-trading under a live label).
const venue = selectVenueAdapter();

const exec = createExecution({
  dir: DIR,
  risk: {
    evaluate: (intent: OrderIntent) => postJson<{ decision: RiskDecision }>(`${RISK_URL}/evaluate`, { intent }).then((r) => r.decision),
    applyFill: (input) => postJson(`${RISK_URL}/fill`, input),
  },
  signer: {
    sign: (req) => postJson(`${SIGNER_URL}/sign`, req),
  },
  exchange: venue,
  faults: {
    crashAfterVenueAckOnce: process.env.EXEC_FAULT_CRASH_AFTER_ACK === "yes",
    onFault: (reason) => {
      console.error(`[execution] FATAL — ${reason}; dying without an ack. Journal says "submitting".`);
      process.exit(137);
    },
  },
});

let booted = false;
let booting = false;

/**
 * Reconciliation must succeed before a single new intent is accepted. If the venue
 * is not listening yet we retry with backoff instead of serving traffic blind —
 * "could not reach the venue" is not the same as "the venue has no such order".
 */
async function boot(attempt = 1) {
  if (booting) return;
  booting = true;
  try {
    const report = await exec.recover();
    booted = true;
    console.log(
      `[execution] recovered from journal · scanned ${report.scanned} · adopted ${report.adopted.length} · resubmitted ${report.resubmitted.length}`
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (attempt < 20) {
      const wait = Math.min(200 * attempt, 2000);
      console.error(`[execution] reconciliation attempt ${attempt} failed (${msg}); retrying in ${wait}ms — entries stay closed`);
      setTimeout(() => {
        booting = false;
        void boot(attempt + 1);
      }, wait);
      return;
    }
    console.error(`[execution] reconciliation failed after ${attempt} attempts (${msg}); refusing to start`);
    process.exit(1);
  } finally {
    if (booted) booting = false;
  }
}

serve("execution", PORT, [
  {
    method: "GET",
    path: "/health",
    handler: () => ({ body: { service: "execution", ok: booted, booted, acceptingIntents: booted, venueAdapter: venue.descriptor } }),
  },
  {
    method: "POST",
    path: "/intents",
    handler: async ({ body }) => {
      if (!booted) return { status: 503, body: { error: "reconciliation has not completed; intents are closed" } };
      const intent = body.intent as OrderIntent;
      if (!intent?.intentId) return { status: 400, body: { error: "intent.intentId is required (idempotency key)" } };
      const order = await exec.submitIntent(intent);
      return { body: { order, state: exec.state() } };
    },
  },
  { method: "POST", path: "/tick", handler: async () => ({ body: await exec.tick() }) },
  { method: "POST", path: "/recover", handler: async () => ({ body: await exec.recover() }) },
  { method: "POST", path: "/pause", handler: ({ body }) => ({ body: exec.setNewRiskPaused(!!body.paused) }) },
  {
    method: "GET",
    path: "/state",
    handler: async () => {
      const [risk, venuePositions, signer] = await Promise.all([
        getJson<Record<string, unknown>>(`${RISK_URL}/state`).catch(() => undefined),
        getJson<Record<string, unknown>[]>(`${EXCHANGE_URL}/positions`).catch(() => undefined),
        getJson<Record<string, unknown>>(`${SIGNER_URL}/stats`).catch(() => undefined),
      ]);
      return { body: { execution: exec.state(), risk, venuePositions: venuePositions ?? [], signer, venueAdapter: venue.descriptor } };
    },
  },
  { method: "GET", path: "/journal", handler: () => ({ body: exec.journalEntries() }) },
]);

void boot();
setInterval(() => {
  if (!booted) return;
  exec.tick().catch((e) => console.error("[execution] tick failed:", (e as Error).message));
}, 1200);
