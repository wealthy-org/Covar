import fs from "node:fs";
import path from "node:path";
import { Interface } from "ethers";
import { serve } from "../shared/http";

/**
 * Vault event indexer (:4014).
 *
 * Watches CovarVault logs over raw JSON-RPC (`eth_getLogs`), decodes the seven
 * investor-facing events, and serves them over HTTP. State is a JSONL file plus
 * a small checkpoint so a restart resumes from the last indexed block instead of
 * re-reading history or skipping it.
 *
 * The topic filter is applied client-side rather than in the RPC filter: the
 * local EVM silently returns nothing for a multi-topic OR filter, and an
 * indexer whose filter depends on node-specific behaviour would quietly miss
 * events. The chain returns the logs; we select from them deterministically.
 *
 * Nothing in this service invents data: an event appears in /events only after
 * it was returned by the configured RPC. If the RPC is unreachable the indexer
 * stays behind and says so in /health rather than fabricating a sync state.
 */

const PORT = Number(process.env.INDEXER_PORT ?? 4014);
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const DIR = process.env.COVAR_STATE_DIR ?? path.join(process.cwd(), ".covar-state");
const POLL_MS = Number(process.env.INDEXER_POLL_MS ?? 2_000);

const EVENTS = [
  "event Deposit(address indexed investor, uint256 assetsIn, uint256 fee, uint256 shares)",
  "event WithdrawalRequested(address indexed investor, uint256 shares, uint64 at)",
  "event PositionsClosed(address indexed investor)",
  "event WithdrawalSettled(address indexed investor, uint256 netAssets)",
  "event WithdrawalClaimed(address indexed investor, uint256 assets)",
  "event NavReported(uint256 previousAssets, uint256 newAssets, uint64 at)",
  "event Paused(bool depositsPaused, bool closeOnly)",
] as const;
const iface = new Interface([...EVENTS]);
/** Canonical topic0 hashes, taken from the parsed interface — never hand-derived. */
const KNOWN_TOPICS = new Set(["Deposit", "WithdrawalRequested", "PositionsClosed", "WithdrawalSettled", "WithdrawalClaimed", "NavReported", "Paused"].map((n) => iface.getEvent(n)!.topicHash));

interface IndexedEvent {
  event: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  args: Record<string, string>;
}

interface Checkpoint {
  vaultAddress: string | null;
  lastBlock: number;
  updatedAt: string;
}

const stateFile = path.join(DIR, "indexer.jsonl");
const checkpointFile = path.join(DIR, "indexer.checkpoint.json");

function loadCheckpoint(): Checkpoint {
  try {
    return JSON.parse(fs.readFileSync(checkpointFile, "utf8")) as Checkpoint;
  } catch {
    return { vaultAddress: process.env.INDEXER_VAULT_ADDRESS ?? null, lastBlock: -1, updatedAt: new Date().toISOString() };
  }
}

function saveCheckpoint(cp: Checkpoint) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(checkpointFile, JSON.stringify(cp, null, 2));
}

/** Resolve the vault address from the deployment manifest unless explicitly set. */
function resolveVaultAddress(): string | null {
  if (process.env.INDEXER_VAULT_ADDRESS) return process.env.INDEXER_VAULT_ADDRESS;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "deployments", "31337.json"), "utf8")) as {
      address?: string;
    };
    return manifest.address ?? null;
  } catch {
    return null;
  }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

let checkpoint = loadCheckpoint();
let lastError: string | null = null;
let lastPollAt: string | null = null;

function decode(log: RawLog): IndexedEvent | null {
  const parsed = iface.parseLog({ topics: log.topics, data: log.data });
  if (!parsed) return null;
  const args: Record<string, string> = {};
  parsed.fragment.inputs.forEach((input, i) => {
    args[input.name] = String(parsed.args[i]);
  });
  return {
    event: parsed.name,
    blockNumber: Number(BigInt(log.blockNumber)),
    txHash: log.transactionHash,
    logIndex: Number(BigInt(log.logIndex)),
    args,
  };
}

async function pollOnce() {
  const vault = checkpoint.vaultAddress ?? resolveVaultAddress();
  checkpoint.vaultAddress = vault;
  lastPollAt = new Date().toISOString();
  if (!vault) {
    lastError = "no vault address: set INDEXER_VAULT_ADDRESS or deploy (deployments/31337.json missing)";
    return;
  }
  const headHex = await rpc<string>("eth_blockNumber", []);
  const head = Number(BigInt(headHex));
  const from = checkpoint.lastBlock + 1;
  if (from > head) return;

  // Filter in-process (see module comment): ask for every log of the vault, decode,
  // drop what is not one of our events. Topic hashes come from the parsed interface.
  const logs = await rpc<RawLog[]>("eth_getLogs", [{ address: vault, fromBlock: `0x${from.toString(16)}`, toBlock: headHex }]);
  const decoded = logs.filter((l) => KNOWN_TOPICS.has(l.topics[0])).map(decode).filter((e): e is IndexedEvent => e !== null);
  if (decoded.length) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(stateFile, decoded.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  checkpoint = { vaultAddress: vault, lastBlock: head, updatedAt: new Date().toISOString() };
  saveCheckpoint(checkpoint);
  lastError = null;
}

function readEvents(): IndexedEvent[] {
  try {
    return fs
      .readFileSync(stateFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as IndexedEvent);
  } catch {
    return [];
  }
}

serve("indexer", PORT, [
  {
    method: "GET",
    path: "/events",
    handler: () => ({ body: { events: readEvents().slice(-200), vault: checkpoint.vaultAddress, lastBlock: checkpoint.lastBlock, lastError } }),
  },
  {
    method: "GET",
    path: "/health",
    handler: () => ({
      body: {
        service: "indexer",
        ok: checkpoint.vaultAddress !== null && lastError === null,
        mode: "vault event indexer — eth_getLogs over JSON-RPC, decoded from the chain only",
        vault: checkpoint.vaultAddress,
        lastBlock: checkpoint.lastBlock,
        lastPollAt,
        lastError,
        rpc: RPC_URL,
      },
    }),
  },
]);

const loop = async () => {
  try {
    await pollOnce();
  } catch (err) {
    lastError = (err as Error).message;
  }
};
void loop();
setInterval(loop, POLL_MS);
