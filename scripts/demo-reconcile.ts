/* eslint-disable @typescript-eslint/no-explicit-any -- demo tooling: rehearsed flows are deserialized from heterogeneous JSON */
/**
 * Cross-process crash/reconciliation rehearsal.
 *
 * The unit suite proves the state machine in one process. This proves the same
 * thing across real OS processes: the execution service is killed mid-window
 * after the venue has already accepted the order, then restarted against the
 * same journal. It must adopt the order instead of placing a second one.
 *
 *   npx tsx scripts/demo-reconcile.ts
 *
 * Everything is a paper venue and a simulated journal — no testnet or mainnet
 * funds are touched, and nothing here is a proof-of-trade.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".covar-state", `demo-${Date.now()}`);
const PORTS = { execution: 4110, exchange: 4111, risk: 4112, signer: 4113 };

const ENTRY: Record<string, string> = {
  exchange: "services/exchange/main.ts",
  risk: "services/risk/main.ts",
  signer: "services/signer/main.ts",
  execution: "services/execution/main.ts",
};

const ENV_FOR_PORT: Record<string, string> = {
  execution: "EXEC_PORT",
  exchange: "EXCHANGE_PORT",
  risk: "RISK_PORT",
  signer: "SIGNER_PORT",
};

const base = (svc: "execution" | "exchange" | "risk" | "signer") => `http://127.0.0.1:${PORTS[svc]}`;

const results: { check: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const started: ChildProcess[] = [];

function start(svc: string, extraEnv: Record<string, string> = {}): ChildProcess {
  const env = {
    ...process.env,
    COVAR_STATE_DIR: STATE_DIR,
    [ENV_FOR_PORT[svc]]: String(PORTS[svc as keyof typeof PORTS]),
    RISK_URL: base("risk"),
    SIGNER_URL: base("signer"),
    EXCHANGE_URL: base("exchange"),
    ...extraEnv,
  };
  // detached: the child gets its own process group so a SIGKILL on the group also
  // takes down the real node process behind the tsx wrapper.
  const child = spawn("npx", ["tsx", ENTRY[svc]], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(`    [${svc}] ${d}`));
  child.stderr?.on("data", (d: Buffer) => process.stdout.write(`    [${svc}] ${d}`));
  started.push(child);
  return child;
}

function killOne(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

function killAll() {
  for (const c of started) {
    if (!c.pid) continue;
    try {
      process.kill(-c.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

async function waitHealth(svc: "execution" | "exchange" | "risk" | "signer", timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base(svc)}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${svc} never became healthy on :${PORTS[svc]}`);
}

async function json<T>(svc: "execution" | "exchange" | "risk" | "signer", pathname: string): Promise<T> {
  const res = await fetch(`${base(svc)}${pathname}`);
  return (await res.json()) as T;
}

function journalEntries(service: string) {
  const file = path.join(STATE_DIR, `${service}.jsonl`);
  if (!fs.existsSync(file)) return [] as any[];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const INTENT_ID = "intent-demo-0001";
const CLIENT_ORDER_ID = `c-${INTENT_ID}`;

const intent = {
  intentId: INTENT_ID,
  agentId: "ag-01",
  market: "ETH-PERP",
  side: "buy" as const,
  qty: 0.5,
  price: 3200,
  reduceOnly: false,
  leverage: 2,
  strategyVersion: 3,
  proposedBy: "rules" as const,
  copilotDecision: "rules_only" as const,
  createdAt: new Date().toISOString(),
};

async function post(svc: "execution" | "exchange" | "risk" | "signer", pathname: string, body: unknown) {
  const res = await fetch(`${base(svc)}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  console.log(`\nCovar execution plane · cross-process rehearsal`);
  console.log(`state dir: ${STATE_DIR}\n`);

  console.log("1. start venue, risk and signer as their own processes");
  const exchangeChild = start("exchange");
  start("risk");
  start("signer");
  await Promise.all([waitHealth("exchange"), waitHealth("risk"), waitHealth("signer")]);
  check("three sibling services healthy on separate ports", true, ":4111 :4112 :4113");

  console.log("\n2. start execution with a fault armed: die after the venue ack");
  const first = start("execution", { EXEC_FAULT_CRASH_AFTER_ACK: "yes" });
  await waitHealth("execution");

  let deathCode: number | null = null;
  const died = new Promise<void>((resolve) => {
    first.on("exit", (code) => {
      deathCode = code ?? null;
      console.log(`\n  → execution process exited with code ${code}\n`);
      resolve();
    });
  });

  console.log("3. submit one intent, then let the process die mid-window");
  await post("execution", "/intents", { intent }).catch(() => null); // the connection dies with the process
  await Promise.race([died, new Promise((r) => setTimeout(r, 10_000))]);

  check("execution process died (not a caught exception)", deathCode !== null && deathCode !== 0, `exit ${deathCode}`);

  const execJournalAfterCrash = journalEntries("execution");
  const lastForOrder = execJournalAfterCrash.filter((e) => e.payload?.clientOrderId === CLIENT_ORDER_ID);
  const statuses = lastForOrder.filter((e) => e.type === "status").map((e) => e.payload?.status);
  check(
    "journal left the order in `submitting` with no venue ack recorded",
    statuses[statuses.length - 1] === "submitting" && !execJournalAfterCrash.some((e) => e.type === "submitted"),
    `statuses: ${statuses.join(" → ") || "(none)"}`
  );
  check(
    "the crash event is on disk",
    execJournalAfterCrash.some((e) => e.type === "crashed_after_venue_ack"),
    ""
  );

  const venueOrder = await json<any>("exchange", `/orders/${CLIENT_ORDER_ID}`);
  check(
    "the venue holds exactly one order under that clientOrderId",
    !!venueOrder && venueOrder.clientOrderId === CLIENT_ORDER_ID,
    `venue orderId ${venueOrder?.orderId ?? "—"}`
  );

  const venueJournal = journalEntries("exchange");
  const accepts = venueJournal.filter((e) => e.type === "order_accepted").length;
  check("the venue accepted the order exactly once", accepts === 1, `order_accepted events: ${accepts}`);

  console.log("\n4. restart execution against the same journal (no fault this time)");
  let execChild = start("execution");
  await waitHealth("execution");

  const state1 = await json<any>("execution", "/state");
  const report = state1.execution.lastRecovery;
  check("boot ran reconciliation and adopted the in-flight order", !!report && report.adopted.includes(CLIENT_ORDER_ID), `adopted: ${JSON.stringify(report?.adopted)}`);
  check("nothing was resubmitted", !!report && report.resubmitted.length === 0, `resubmitted: ${JSON.stringify(report?.resubmitted)}`);

  console.log("\n5. let the worker apply the fill");
  let filled = false;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const s = await json<any>("execution", "/state");
    const order = s.execution.orders.find((o: any) => o.clientOrderId === CLIENT_ORDER_ID);
    if (order?.status === "filled") {
      filled = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const state2 = await json<any>("execution", "/state");
  const order = state2.execution.orders.find((o: any) => o.clientOrderId === CLIENT_ORDER_ID);
  check("the adopted order reached `filled`", filled, `status: ${order?.status}`);
  check("filled quantity is 0.5, not doubled", order?.filledQty === 0.5, `filledQty: ${order?.filledQty}`);

  const pos = state2.execution.positions.find((p: any) => p.market === "ETH-PERP");
  check("position is a single 0.5 ETH-PERP lot", pos?.qty === 0.5, `qty: ${pos?.qty ?? "—"}`);
  const venuePos = (state2.venuePositions as any[])?.find((p: any) => p.market === "ETH-PERP");
  check("venue position agrees with ours", (venuePos?.qty ?? 0) === 0.5, `venue qty: ${venuePos?.qty ?? "—"}`);

  console.log("\n6. replay the same intentId after the fact");
  const replay = await post("execution", "/intents", { intent });
  const dedupe = journalEntries("execution").some((e) => e.type === "intent_deduplicated");
  check("replayed intent is deduplicated, not retraded", dedupe && (replay.body as any)?.order?.clientOrderId === CLIENT_ORDER_ID, `http ${replay.status}`);

  console.log("\n7. operator pause blocks new entries");
  await post("execution", "/pause", { paused: true });
  const blockedIntent = { ...intent, intentId: "intent-demo-0002" };
  const blocked = await post("execution", "/intents", { intent: blockedIntent });
  const blockedOrder = (blocked.body as any)?.order;
  check("an intent submitted while paused is held, not sent to the venue", blockedOrder?.status !== "submitted" && blockedOrder?.status !== "filled", `status: ${blockedOrder?.status}`);

  const riskState = await json<any>("risk", "/state");
  check("risk service has its own state and journal", !!riskState && Array.isArray(journalEntries("risk")), `risk journal entries: ${journalEntries("risk").length}`);

  console.log("\n8. a venue restart must not forget the clientOrderId it already accepted");
  const orderIdBefore = venueOrder?.orderId;
  killOne(exchangeChild);
  await new Promise((r) => setTimeout(r, 800));
  start("exchange");
  await waitHealth("exchange");
  const afterVenueRestart = await json<any>("exchange", `/orders/${CLIENT_ORDER_ID}`);
  check(
    "the venue still resolves the same order (same orderId) after restarting",
    afterVenueRestart?.orderId === orderIdBefore,
    `${orderIdBefore} → ${afterVenueRestart?.orderId ?? "—"}`
  );
  check(
    "the venue still holds exactly one accepted order",
    journalEntries("exchange").filter((e) => e.type === "order_accepted").length === 1,
    `order_accepted: ${journalEntries("exchange").filter((e) => e.type === "order_accepted").length}`
  );
  check(
    "and its fills survived the restart",
    (afterVenueRestart?.fills?.length ?? 0) === 1,
    `fills: ${afterVenueRestart?.fills?.length ?? 0}`
  );

  killOne(execChild);
  await new Promise((r) => setTimeout(r, 800));
  execChild = start("execution");
  await waitHealth("execution");
  const state3 = await json<any>("execution", "/state");
  check(
    "execution rebuilds one filled order and one position from the journal",
    state3.execution.counts.filled === 1 && state3.execution.positions.length === 1,
    `filled ${state3.execution.counts.filled} · positions ${state3.execution.positions.length}`
  );
  check(
    "state after a second restart is identical, not duplicated",
    state3.execution.positions.find((p: any) => p.market === "ETH-PERP")?.qty === 0.5,
    `qty: ${state3.execution.positions.find((p: any) => p.market === "ETH-PERP")?.qty ?? "—"}`
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  console.log(`journals kept in ${path.relative(ROOT, STATE_DIR)}/`);
  killAll();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  killAll();
  process.exit(1);
});
