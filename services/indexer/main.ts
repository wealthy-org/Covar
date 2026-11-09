import "dotenv/config";
import { redactSecrets } from "../shared/redact";
import fs from "node:fs";
import path from "node:path";
import { Interface, zeroPadValue } from "ethers";
import { serve } from "../shared/http";
import { buildSummary, type IndexedEvent, type TransferOut } from "./summary";

/**
 * Vault event indexer (:4016) — packages 3.6 and 3.10.
 *
 * Watches CovarVault logs over raw JSON-RPC (`eth_getLogs`) and decodes the
 * investor-facing events and the v2 admin events. It also reads USDG transfers
 * *out of* the vault, which gives exact fee and allocation figures, and stamps
 * every event with its block time. State is a JSONL file plus a checkpoint, so a
 * restart resumes from the last indexed block instead of re-reading history or
 * skipping it.
 *
 * Long histories are scanned in chunks (INDEXER_CHUNK blocks, a few per poll).
 * The scan starts at INDEXER_START_BLOCK, or at the vault's deployment block,
 * which is found by binary search on eth_getCode.
 *
 * Vault topics are filtered client-side (the local EVM silently returns nothing
 * for a multi-topic OR filter). Transfers use a positional AND filter
 * (Transfer, from = vault), which every node supports.
 *
 * Nothing in this service invents data. An event appears only after the
 * configured RPC returned it. If the RPC is unreachable, the indexer stays
 * behind and says so in /health.
 *
 *   GET /events   last 200 decoded events (?investor=0x… → that investor's full history)
 *   GET /summary  NAV series, return, drawdown, investors, fees, allocation (+ live reads)
 *   GET /health
 */

const PORT = Number(process.env.INDEXER_PORT || 4016);
function rpcUrl() {
  if (process.env.INDEXER_RPC_URL || process.env.RPC_URL) return (process.env.INDEXER_RPC_URL || process.env.RPC_URL)!;
  const chain = process.env.INDEXER_CHAIN || process.env.OPERATOR_CHAIN || "local";
  if (chain === "mainnet") return process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
  if (chain === "testnet") return process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com";
  return process.env.NEXT_PUBLIC_LOCAL_RPC || "http://127.0.0.1:8545";
}
const RPC_URL = rpcUrl();
const DIR = process.env.COVAR_STATE_DIR || path.join(process.cwd(), ".covar-state");
const POLL_MS = Number(process.env.INDEXER_POLL_MS || 2_000);
const CHUNK = Math.max(100, Number(process.env.INDEXER_CHUNK || 5_000));
const CHUNKS_PER_POLL = Math.max(1, Number(process.env.INDEXER_CHUNKS_PER_POLL || 10));

const EVENTS = [
  "event Deposit(address indexed investor, uint256 assetsIn, uint256 fee, uint256 shares)",
  "event WithdrawalRequested(address indexed investor, uint256 shares, uint64 at)",
  "event PositionsClosed(address indexed investor)",
  "event WithdrawalSettled(address indexed investor, uint256 netAssets)",
  "event WithdrawalClaimed(address indexed investor, uint256 assets)",
  "event NavReported(uint256 previousAssets, uint256 newAssets, uint64 at)",
  "event Paused(bool depositsPaused, bool closeOnly)",
  // v2
  "event LimitsChanged(uint256 maxTotalAssets, uint256 maxDepositPerTx)",
  "event TradingAccountChanged(address indexed previous, address indexed next)",
  "event AllocatedToVenue(address indexed to, uint256 amount)",
] as const;
const iface = new Interface([...EVENTS]);
/** Canonical topic0 hashes, taken from the parsed interface — never hand-derived. */
const KNOWN_TOPICS = new Set(EVENTS.map((e) => iface.getEvent(e.slice(6, e.indexOf("(")))!.topicHash));
const erc20 = new Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const TRANSFER = erc20.getEvent("Transfer")!.topicHash;

const READS = new Interface([
  "function asset() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function tradingAccount() view returns (address)",
  "function reportedAssets() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function navPerShare() view returns (uint256)",
  "function lastNavUpdate() view returns (uint64)",
  "function maxNavAge() view returns (uint64)",
  "function depositsPaused() view returns (bool)",
  "function closeOnly() view returns (bool)",
  "function maxTotalAssets() view returns (uint256)",
  "function maxDepositPerTx() view returns (uint256)",
]);

interface Checkpoint {
  vaultAddress: string | null;
  lastBlock: number;
  updatedAt: string;
}

const stateFile = path.join(DIR, "indexer.jsonl");
const transferFile = path.join(DIR, "indexer.transfers.jsonl");
const checkpointFile = path.join(DIR, "indexer.checkpoint.json");

function loadCheckpoint(): Checkpoint {
  try {
    const cp = JSON.parse(fs.readFileSync(checkpointFile, "utf8")) as Checkpoint;
    // the vault this run is configured for (INDEXER_ / OPERATOR_ / NEXT_PUBLIC_ … or the local manifest)
    const want = resolveVaultAddress();
    // a different vault means a different history: never mix two vaults' events
    if (want && cp.vaultAddress && want.toLowerCase() !== cp.vaultAddress.toLowerCase()) throw new Error("vault changed");
    return cp;
  } catch {
    for (const f of [stateFile, transferFile]) fs.rmSync(f, { force: true });
    return { vaultAddress: resolveVaultAddress(), lastBlock: -1, updatedAt: new Date().toISOString() };
  }
}

function saveCheckpoint(cp: Checkpoint) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(checkpointFile, JSON.stringify(cp, null, 2));
}

/** Vault address: explicit env, the web app's env, or the local deployment manifest. */
function resolveVaultAddress(): string | null {
  const env = process.env.INDEXER_VAULT_ADDRESS || process.env.OPERATOR_VAULT_ADDRESS || process.env.NEXT_PUBLIC_COVAR_VAULT_ADDRESS;
  if (env) return env;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "deployments", "31337.json"), "utf8")) as { address?: string };
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
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}
const hex = (n: number) => `0x${n.toString(16)}`;

async function call(to: string, fn: string): Promise<unknown | null> {
  try {
    const out = await rpc<string>("eth_call", [{ to, data: READS.encodeFunctionData(fn) }, "latest"]);
    if (!out || out === "0x") return null;
    return READS.decodeFunctionResult(fn, out)[0];
  } catch {
    return null; // v1 vault: v2 getters do not exist
  }
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
let head = -1;
let chainId: number | null = null;
let meta: { asset: string | null; feeRecipient: string | null } = { asset: null, feeRecipient: null };
const blockTs = new Map<number, number>();

async function tsOf(block: number) {
  if (!blockTs.has(block)) {
    const b = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [hex(block), false]);
    blockTs.set(block, Number(BigInt(b.timestamp)));
    if (blockTs.size > 5000) blockTs.delete(blockTs.keys().next().value as number);
  }
  return blockTs.get(block)!;
}

function decode(log: RawLog): IndexedEvent | null {
  const parsed = iface.parseLog({ topics: log.topics, data: log.data });
  if (!parsed) return null;
  const args: Record<string, string> = {};
  parsed.fragment.inputs.forEach((input, i) => {
    args[input.name] = String(parsed.args[i]);
  });
  return { event: parsed.name, blockNumber: Number(BigInt(log.blockNumber)), txHash: log.transactionHash, logIndex: Number(BigInt(log.logIndex)), args };
}

/** Deployment block by binary search on eth_getCode (needs historical state; falls back to 0). */
async function findDeployBlock(vault: string, latest: number): Promise<number> {
  if (process.env.INDEXER_START_BLOCK) return Number(process.env.INDEXER_START_BLOCK);
  try {
    let lo = 0;
    let hi = latest;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const code = await rpc<string>("eth_getCode", [vault, hex(mid)]);
      if (code && code !== "0x") hi = mid;
      else lo = mid + 1;
    }
    return lo;
  } catch {
    return 0;
  }
}

/**
 * Block range per eth_getLogs. Starts at INDEXER_CHUNK and shrinks when the RPC
 * refuses the range (e.g. Alchemy free tier: 10 blocks; it even suggests one).
 */
let chunk = CHUNK;
let rangeNote: string | null = null;
function shrinkChunk(message: string): boolean {
  if (!/block range|range should work|range is too large|exceed|too many (blocks|results)|limit/i.test(message) || chunk <= 1) return false;
  const hint = message.match(/\[(0x[0-9a-f]+),\s*(0x[0-9a-f]+)\]/i);
  const suggested = hint ? Number(BigInt(hint[2]) - BigInt(hint[1])) + 1 : 0;
  const next = suggested > 0 && suggested < chunk ? suggested : Math.max(1, Math.floor(chunk / 2));
  rangeNote = `RPC limits eth_getLogs ranges: scanning ${next} blocks per request (was ${chunk}). A public or paid RPC is much faster.`;
  console.warn(`[indexer] ${rangeNote}`);
  chunk = next;
  return true;
}

async function pollOnce() {
  const vault = checkpoint.vaultAddress ?? resolveVaultAddress();
  checkpoint.vaultAddress = vault;
  lastPollAt = new Date().toISOString();
  if (!vault) {
    lastError = "no vault address: set INDEXER_VAULT_ADDRESS (or NEXT_PUBLIC_COVAR_VAULT_ADDRESS) or deploy locally";
    return;
  }
  chainId ??= Number(BigInt(await rpc<string>("eth_chainId", [])));
  if (!meta.asset) meta = { asset: (await call(vault, "asset")) as string | null, feeRecipient: (await call(vault, "feeRecipient")) as string | null };
  head = Number(BigInt(await rpc<string>("eth_blockNumber", [])));
  if (checkpoint.lastBlock < 0) checkpoint.lastBlock = (await findDeployBlock(vault, head)) - 1;

  // Small ranges (forced by the RPC) are cheap, so allow more of them per poll.
  const maxIter = chunk < CHUNK ? Math.max(CHUNKS_PER_POLL, 200) : CHUNKS_PER_POLL;
  for (let i = 0; i < maxIter && checkpoint.lastBlock < head; i++) {
    const from = checkpoint.lastBlock + 1;
    const to = Math.min(head, from + chunk - 1);
    // vault logs: ask for every log of the vault, keep our events (see module comment)
    let logs: RawLog[];
    try {
      logs = await rpc<RawLog[]>("eth_getLogs", [{ address: vault, fromBlock: hex(from), toBlock: hex(to) }]);
    } catch (e) {
      if (shrinkChunk((e as Error).message)) continue; // retry the same range, smaller
      throw e;
    }
    const decoded = logs.filter((l) => KNOWN_TOPICS.has(l.topics[0])).map(decode).filter((e): e is IndexedEvent => e !== null);
    for (const e of decoded) e.ts = await tsOf(e.blockNumber);
    // USDG transfers out of the vault (fees, allocations, claims)
    let transfers: TransferOut[] = [];
    if (meta.asset) {
      let tl: RawLog[];
      try {
        tl = await rpc<RawLog[]>("eth_getLogs", [{ address: meta.asset, topics: [TRANSFER, zeroPadValue(vault, 32)], fromBlock: hex(from), toBlock: hex(to) }]);
      } catch (e) {
        if (shrinkChunk((e as Error).message)) continue; // nothing was written for this range yet
        throw e;
      }
      transfers = tl
        .filter((l) => l.topics[0] === TRANSFER && l.topics[1]?.toLowerCase() === zeroPadValue(vault, 32).toLowerCase())
        .map((l) => ({ to: "0x" + l.topics[2].slice(26), value: BigInt(l.data).toString(), blockNumber: Number(BigInt(l.blockNumber)), txHash: l.transactionHash, logIndex: Number(BigInt(l.logIndex)) }));
      for (const t of transfers) t.ts = await tsOf(t.blockNumber);
    }
    fs.mkdirSync(DIR, { recursive: true });
    if (decoded.length) fs.appendFileSync(stateFile, decoded.map((e) => JSON.stringify(e)).join("\n") + "\n");
    if (transfers.length) fs.appendFileSync(transferFile, transfers.map((e) => JSON.stringify(e)).join("\n") + "\n");
    checkpoint = { vaultAddress: vault, lastBlock: to, updatedAt: new Date().toISOString() };
    saveCheckpoint(checkpoint);
  }
  lastError = null;
}

function readJsonl<T>(file: string): T[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

async function summary() {
  const vault = checkpoint.vaultAddress;
  if (!vault) return { ok: false, error: lastError ?? "no vault configured" };
  const events = readJsonl<IndexedEvent>(stateFile);
  const transfers = readJsonl<TransferOut>(transferFile);
  const tradingAccount = (await call(vault, "tradingAccount")) as string | null;
  const s = buildSummary({ vault, chainId, lastBlock: checkpoint.lastBlock, events, transfers, feeRecipient: meta.feeRecipient, tradingAccount });
  // live contract reads override the replay for "now" values
  const [reported, shares, nav, lastNav, maxAge, paused, closeOnly, cap, perTx] = await Promise.all(
    ["reportedAssets", "totalShares", "navPerShare", "lastNavUpdate", "maxNavAge", "depositsPaused", "closeOnly", "maxTotalAssets", "maxDepositPerTx"].map((f) => call(vault, f)),
  );
  const live = {
    reportedAssets: reported?.toString() ?? null,
    totalShares: shares?.toString() ?? null,
    navPerShare: nav !== null ? Number(nav as bigint) / 1e18 : null,
    lastNavUpdate: lastNav !== null ? Number(lastNav as bigint) : null,
    maxNavAge: maxAge !== null ? Number(maxAge as bigint) : null,
    depositsPaused: paused as boolean | null,
    closeOnly: closeOnly as boolean | null,
    maxTotalAssets: cap?.toString() ?? null,
    maxDepositPerTx: perTx?.toString() ?? null,
    feeRecipient: meta.feeRecipient,
    tradingAccount: tradingAccount && !/^0x0{40}$/i.test(tradingAccount) ? tradingAccount : null,
  };
  return { ok: true, synced: checkpoint.lastBlock >= head, head, ...s, live };
}

serve("indexer", PORT, [
  {
    method: "GET",
    path: "/events",
    // ?investor=0x… → that investor's full history (deposit/request/close/settle/claim), else the last 200 events
    handler: ({ query }) => {
      const who = (query.get("investor") ?? "").toLowerCase();
      if (who && !/^0x[0-9a-f]{40}$/.test(who)) return { status: 400, body: { error: "investor must be a 0x address" } };
      const all = readJsonl<IndexedEvent>(stateFile);
      const events = who ? all.filter((e) => (e.args.investor ?? "").toLowerCase() === who) : all.slice(-200);
      return { body: { events, vault: checkpoint.vaultAddress, lastBlock: checkpoint.lastBlock, head, lastError: lastError ? redactSecrets(lastError) : null } };
    },
  },
  { method: "GET", path: "/summary", handler: async () => ({ body: await summary() }) },
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
        head,
        behind: head >= 0 ? Math.max(0, head - checkpoint.lastBlock) : null,
        lastPollAt,
        lastError: lastError ? redactSecrets(lastError) : null,
        blocksPerRequest: chunk,
        note: rangeNote,
        rpc: redactSecrets(RPC_URL),
      },
    }),
  },
]);

let polling = false;
const loop = async () => {
  if (polling) return;
  polling = true;
  try {
    await pollOnce();
  } catch (err) {
    lastError = redactSecrets((err as Error).message);
  } finally {
    polling = false;
  }
};
void loop();
setInterval(loop, POLL_MS);
