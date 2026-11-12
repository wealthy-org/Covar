/**
 * CLI step 5 — a real execution daemon process, killed inside the crash window.
 *
 *   tsx cli/daemon.ts crash   <stateDir>   → dies with exit 137 right after the
 *                                            venue accepted the order and BEFORE
 *                                            the ack reached our journal
 *   tsx cli/daemon.ts recover <stateDir>   → new process, same journals: replay,
 *                                            reconcile with the venue, finish
 *
 * Real modules: createExecution (services/execution), createRisk, createSigner,
 * and the journaled paper venue (services/exchange). The paper venue stands in
 * for Lighter; it is keyed by clientOrderId exactly like the real one. Every
 * line printed is one JSON event that run.js renders.
 */
import { createExchange } from "../services/exchange/app";
import { createExecution } from "../services/execution/app";
import { createRisk } from "../services/risk/app";
import { createSigner } from "../services/signer/app";
import type { OrderIntent } from "../services/shared/types";

const [mode, dir] = process.argv.slice(2);
const ethMid = Number(process.env.COVAR_ETH_MID || 0);
const intentId = process.env.COVAR_INTENT_ID || "cli-demo";
const emit = (type: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ type, pid: process.pid, ...data }));

if (!dir || !ethMid) {
  emit("error", { error: "usage: daemon.ts crash|recover <stateDir> with COVAR_ETH_MID set" });
  process.exit(2);
}

const exchange = createExchange({ dir, fillDelayPolls: 1 });
const risk = createRisk({ dir, equity: 10_000 });
const signer = createSigner({ dir });
const venueSubmits = { n: 0 };
const venue = {
  submit: (i: Parameters<typeof exchange.submit>[0]) => {
    venueSubmits.n++;
    const o = exchange.submit(i);
    emit("venue_accepted", { clientOrderId: i.clientOrderId, venueOrderId: o.orderId });
    return o;
  },
  get: (id: string) => exchange.get(id),
  advance: () => exchange.advance(),
};

const intent: OrderIntent = {
  intentId,
  agentId: "cli",
  market: "ETH-PERP",
  side: "buy",
  qty: Number((1000 / ethMid).toFixed(4)), // 1,000 USDG paper notional at the live mid
  price: ethMid,
  reduceOnly: false,
  leverage: 1,
  strategyVersion: 1,
  proposedBy: "rules",
  copilotDecision: "rules_only",
  createdAt: new Date().toISOString(),
};

async function crash() {
  const exec = createExecution({
    dir,
    risk,
    signer,
    exchange: venue,
    faults: {
      crashAfterVenueAckOnce: true,
      onFault: (reason) => {
        emit("crash", { reason, code: 137 });
        process.exit(137); // hard death: no cleanup, no ack journaled
      },
    },
  });
  emit("boot", { mode: "crash" });
  const o = await exec.submitIntent(intent);
  emit("intent_accepted", { intentId, clientOrderId: o.clientOrderId, qty: intent.qty, price: intent.price });
  await exec.tick(); // risk → signer → "submitting" journaled → venue accepts → process dies here
  emit("unexpected", { note: "should have crashed" });
}

async function recover() {
  const exec = createExecution({ dir, risk, signer, exchange: venue });
  const before = exec.getOrder(`c-${intentId}`);
  emit("boot", { mode: "recover", replayedStatus: before?.status ?? null, venueOrdersOnBoot: exchange.journalEntries().filter((e) => e.type === "order_accepted").length });
  const report = await exec.recover();
  emit("recovery", { scanned: report.scanned, adopted: report.adopted, resubmitted: report.resubmitted, duplicatePrevented: report.duplicatePrevented });
  // the strategy loop re-emits the same intent after a restart: it must not create a second order
  const again = await exec.submitIntent(intent);
  emit("replay", { clientOrderId: again.clientOrderId, status: again.status });
  for (let i = 0; i < 3; i++) await exec.tick();
  const final = exec.getOrder(`c-${intentId}`)!;
  const venueEntries = exchange.journalEntries();
  const execEntries = exec.journalEntries();
  emit("done", {
    status: final.status,
    filledQty: final.filledQty,
    avgFillPrice: final.avgFillPrice,
    venueOrderId: final.venueOrderId,
    venueOrdersForKey: venueEntries.filter((e) => e.type === "order_accepted" && e.payload.clientOrderId === final.clientOrderId).length,
    venueSubmitCallsAfterRestart: venueSubmits.n,
    venueDedupes: venueEntries.filter((e) => e.type === "submit_deduplicated").length,
    fillsApplied: execEntries.filter((e) => e.type === "fill_applied" && e.payload.clientOrderId === final.clientOrderId).length,
    intentDeduplicated: execEntries.filter((e) => e.type === "intent_deduplicated").length,
    position: exec.state().positions.find((p) => p.market === "ETH-PERP")?.qty ?? 0,
  });
}

(mode === "crash" ? crash() : recover()).catch((e) => {
  emit("error", { error: (e as Error).message });
  process.exit(1);
});
