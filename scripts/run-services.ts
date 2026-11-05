/**
 * Runs the execution plane: four separate processes, each with its own port and
 * its own append-only journal.
 *
 *   npm run services          # foreground, logs interleaved
 *   npm run demo:reconcile    # one-shot crash/restart proof in a temp dir
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const STATE_DIR = process.env.COVAR_STATE_DIR ?? path.join(process.cwd(), ".covar-state");
const env = { ...process.env, COVAR_STATE_DIR: STATE_DIR };

const services = [
  { name: "exchange", port: 4011, entry: "services/exchange/main.ts" },
  { name: "risk", port: 4012, entry: "services/risk/main.ts" },
  { name: "signer", port: 4013, entry: "services/signer/main.ts" },
  { name: "execution", port: 4010, entry: "services/execution/main.ts" },
];

const children: ChildProcess[] = [];

const colour: Record<string, string> = { execution: "\x1b[35m", risk: "\x1b[36m", exchange: "\x1b[33m", signer: "\x1b[32m" };
const reset = "\x1b[0m";

console.log(`Covar execution plane · state dir ${STATE_DIR}`);
console.log(`  exchange  :4011    risk  :4012    signer  :4013    execution  :4010`);

for (const svc of services) {
  const child = spawn("npx", ["tsx", svc.entry], { env, cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.push(child);
  const prefix = `${colour[svc.name] ?? ""}[${svc.name}]${reset}`;
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(d.toString().split("\n").filter(Boolean).map((l) => `${prefix} ${l}\n`).join("")));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(`${prefix} ${d.toString()}`));
  child.on("exit", (code) => {
    console.log(`${prefix} exited with code ${code}`);
    shutdown(code ?? 0);
  });
}

let shuttingDown = false;
function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.pid) continue;
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
