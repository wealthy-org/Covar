/**
 * Execution plane acceptance tests (brief §15: "Test/live orders are bounded,
 * idempotent and reconciled after disconnect/restart").
 *
 * Run with `npm run test:services`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExchange, demoIntent } from "../../services/exchange/app";
import { createRisk } from "../../services/risk/app";
import { createSigner } from "../../services/signer/app";
import { createExecution } from "../../services/execution/app";
import type { OrderIntent } from "../../services/shared/types";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const eq = (name: string, a: unknown, b: unknown) =>
  ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "covar-exec-"));

function harness(dir: string, over: { fillDelayPolls?: number; equity?: number } = {}) {
  const exchange = createExchange({ dir, fillDelayPolls: over.fillDelayPolls ?? 1 });
  const risk = createRisk({ dir, equity: over.equity ?? 10_000 });
  const signer = createSigner({ dir });
  const submit = (exec: ReturnType<typeof createExecution>, intent: OrderIntent) => exec.submitIntent(intent);
  return { exchange, risk, signer, submit };
}

async function main() {
/* --------------------------------------------------------------- 1. happy path */
{
  const dir = tmp();
  const h = harness(dir);
  const exec = createExecution({ dir, risk: h.risk, signer: h.signer, exchange: h.exchange });
  console.log("\nHappy path");
  const intent = demoIntent({ intentId: "i-1", qty: 0.2, price: 3000, leverage: 2 });
  await h.submit(exec, intent);
  await exec.tick();
  await exec.tick();

  const order = exec.getOrder(exec.intentClientId("i-1"))!;
  eq("order status filled", order.status, "filled");
  eq("exactly one venue order", h.exchange.allOrders().length, 1);
  ok("position opened", exec.state().positions[0]?.qty === 0.2);
  ok("fill applied once", order.appliedFillIds.length === 1);
  ok("risk saw the fill", h.risk.journalEntries().some((e) => e.type === "fill_applied"));
  ok("signer signed once", h.signer.stats().signed === 1);
}

/* ------------------------------------------- 2. crash after venue ack → adoption */
{
  const dir = tmp();
  const h = harness(dir, { fillDelayPolls: 2 });
  const faults = { crashAfterVenueAckOnce: true };
  const exec1 = createExecution({ dir, risk: h.risk, signer: h.signer, exchange: h.exchange, faults });

  console.log("\nCrash after venue acknowledgment (restart reconciliation)");
  await h.submit(exec1, demoIntent({ intentId: "i-crash", qty: 0.3, price: 3100, leverage: 2 }));
  let crashed = false;
  try {
    await exec1.tick();
  } catch (e) {
    crashed = /simulated crash/.test((e as Error).message);
  }
  ok("process died inside the submit window", crashed);
  ok("venue already holds the order", h.exchange.allOrders().length === 1);
  eq("journal left the order in 'submitting'", [...exec1.state().orders][0].status, "submitting");

  // restart: new process, same journal dir, same venue
  const exec2 = createExecution({ dir, risk: h.risk, signer: h.signer, exchange: h.exchange });
  const report = await exec2.recover();
  eq("recovery adopted the in-flight order", report.adopted, [exec2.intentClientId("i-crash")]);
  eq("recovery did not resubmit", report.resubmitted.length, 0);
  await exec2.tick();
  await exec2.tick();

  eq("still exactly one venue order (no duplicate trade)", h.exchange.allOrders().length, 1);
  eq("order filled after recovery", exec2.getOrder(exec2.intentClientId("i-crash"))!.status, "filled");
  ok("position not doubled", exec2.state().positions[0].qty === 0.3);
  ok("fill applied exactly once", exec2.getOrder(exec2.intentClientId("i-crash"))!.appliedFillIds.length === 1);
}

/* ------------------------------------- 3. resubmit path when the venue lost it */
{
  const dir = tmp();
  const h = harness(dir, { fillDelayPolls: 1 });
  const execA = createExecution({ dir, risk: h.risk, signer: h.signer, exchange: h.exchange, faults: { crashAfterVenueAckOnce: true } });
  await h.submit(execA, demoIntent({ intentId: "i-lost", qty: 0.1, price: 3000, leverage: 2 }));
  try {
    await execA.tick();
  } catch {
    /* expected crash */
  }

  console.log("\nRecovery when the venue has no record (safe retry, same key)");
  const emptyVenue = createExchange({ dir: `${dir}-second`, fillDelayPolls: 1 });
  const execB = createExecution({ dir, risk: h.risk, signer: h.signer, exchange: emptyVenue });
  const report = await execB.recover();
  eq("recovery resubmitted with the same client order id", report.resubmitted, [execB.intentClientId("i-lost")]);
  await execB.tick();
  await execB.tick();
  eq("one order at the new venue", emptyVenue.allOrders().length, 1);
  eq("order filled", execB.getOrder(execB.intentClientId("i-lost"))!.status, "filled");
}

/* ------------------------------------------------ 4. replayed intent never trades */
{
  const dir = tmp();
  const h = harness(dir);
  const exec = createExecution({ dir, risk: h.risk, signer: h.signer, exchange: h.exchange });
  console.log("\nIdempotent intents");
  const intent = demoIntent({ intentId: "i-dup" });
  await h.submit(exec, intent);
  await h.submit(exec, intent); // caller retries the same intent
  await exec.tick();
  await exec.tick();
  eq("single order for a replayed intent", h.exchange.allOrders().length, 1);
  ok("deduplication journaled", exec.journalEntries().some((e) => e.type === "intent_deduplicated"));

  const execRestart = createExecution({ dir, risk: h.risk, signer: h.signer, exchange: h.exchange });
  eq("state survives restart", execRestart.state().counts.total, 1);
  eq("restarted service sees it as filled", execRestart.getOrder(execRestart.intentClientId("i-dup"))!.status, "filled");
}

/* ----------------------------------------------------------- 5. risk independence */
{
  const dir = tmp();
  const h = harness(dir);
  const exec = createExecution({ dir, risk: h.risk, signer: h.signer, exchange: h.exchange });
  console.log("\nRisk service independence");

  await h.submit(exec, demoIntent({ intentId: "i-lev", leverage: 10, qty: 0.1, price: 3000 }));
  await exec.tick();
  const levOrder = exec.getOrder(exec.intentClientId("i-lev"))!;
  eq("10x request rejected despite Copilot approval", levOrder.status, "risk_rejected");
  ok("venue never called for a rejected order", h.exchange.allOrders().length === 0);
  ok("reason names the failing check", /leverage_ceiling/.test(levOrder.riskDecision!.reason));
  ok("the reason stays on the order record for the UI", /leverage_ceiling/.test(levOrder.lastError ?? ""));

  await h.submit(exec, demoIntent({ intentId: "i-size", qty: 40, price: 3000, leverage: 5 }));
  await exec.tick();
  eq("oversized notional rejected", exec.getOrder(exec.intentClientId("i-size"))!.status, "risk_rejected");
  ok("size check named", /position_size_cap/.test(exec.getOrder(exec.intentClientId("i-size"))!.riskDecision!.reason));

  // drawdown halt: equity −26% from peak
  h.risk.setEquity(7_400);
  await h.submit(exec, demoIntent({ intentId: "i-dd-entry", qty: 0.1, price: 3000 }));
  await exec.tick();
  eq("new entry blocked after 25% drawdown", exec.getOrder(exec.intentClientId("i-dd-entry"))!.status, "risk_rejected");

  await h.submit(exec, demoIntent({ intentId: "i-dd-exit", qty: 0.1, price: 3000, reduceOnly: true, side: "sell" }));
  await exec.tick();
  await exec.tick();
  eq("exit still allowed while halted", exec.getOrder(exec.intentClientId("i-dd-exit"))!.status, "filled");
}

/* ----------------------------------------------------------------- 6. signer scope */
{
  const dir = tmp();
  const h = harness(dir);
  console.log("\nSigner boundary");
  const withdrawal = h.signer.sign({
    clientOrderId: "c-withdraw",
    intent: demoIntent(),
    destination: "0xoperator000000000000000000000000000000",
  });
  ok("withdrawal-style request refused", withdrawal.ok === false);
  ok("refusal recorded in the signer journal", h.signer.journalEntries().some((e) => e.type === "refused"));
  const bad = h.signer.sign({ clientOrderId: "c-x", intent: demoIntent({ market: "DOGE-PERP" }) });
  ok("non-allowlisted market refused", bad.ok === false);
}

/* -------------------------------------------------- 7. operator pause of new risk */
{
  const dir = tmp();
  const h = harness(dir);
  const exec = createExecution({ dir, risk: h.risk, signer: h.signer, exchange: h.exchange });
  console.log("\nOperator controls");
  exec.setNewRiskPaused(true);
  await h.submit(exec, demoIntent({ intentId: "i-paused", qty: 0.1, price: 3000 }));
  await exec.tick();
  const paused = exec.getOrder(exec.intentClientId("i-paused"))!;
  eq("new entry held while paused, not rejected", paused.status, "queued");
  eq("the hold is journalled", paused.lastError?.includes("paused by operator"), true);
  const venueCallsWhilePaused = h.exchange.allOrders().length;
  await h.submit(exec, demoIntent({ intentId: "i-exit", qty: 0.1, price: 3000, reduceOnly: true, side: "sell" }));
  await exec.tick();
  await exec.tick();
  eq("exit still processed while paused", exec.getOrder(exec.intentClientId("i-exit"))!.status, "filled");
  eq("the held entry did not reach the venue", h.exchange.allOrders().some((o) => o.clientOrderId === exec.intentClientId("i-paused")), false);
  exec.setNewRiskPaused(false);
  await exec.tick();
  await exec.tick();
  eq("releasing the pause lets the held entry through", exec.getOrder(exec.intentClientId("i-paused"))!.status, "filled");
  eq("and it is still one venue order", h.exchange.allOrders().filter((o) => o.clientOrderId === exec.intentClientId("i-paused")).length, 1);
  void venueCallsWhilePaused;
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(`Failing: ${fails.join("; ")}`);
  process.exit(1);
}
}

void main();
