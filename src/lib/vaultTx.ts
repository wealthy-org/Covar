/**
 * Wallet-signed CovarVault transactions (browser, injected EIP-1193 wallet).
 *
 * Dependency-free on purpose, like lib/chain.ts: hand-encoded calldata for the
 * small, fixed ABI surface the vault console needs. Keys never leave the
 * user's wallet — this module only builds calldata, asks the wallet to sign,
 * and reads state.
 *
 * Every write is SIMULATED first (eth_call from the sender). A revert is decoded
 * into the contract's custom error name and explained before any wallet prompt,
 * so an operator never pays gas to learn "StaleNav".
 */
import { CHAINS, type ChainId } from "./chain";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<any>; on?: any; removeListener?: any };

export const injected = (): Eip1193 | null =>
  typeof window === "undefined" ? null : ((window as any).ethereum ?? null);

/** A wallet extension was disabled/reloaded/updated while this tab stayed open. */
export const STALE_WALLET_MSG =
  "Your wallet extension was reloaded or turned off after this page opened. Refresh the page (F5) and try again.";
export const isStaleExtension = (e: unknown): boolean =>
  /extension context invalidated|disconnected port|receiving end does not exist/i.test(String((e as any)?.message ?? e));

// ----------------------------------------------------------------- selectors
export const SEL = {
  // vault writes
  reportNav: "0x368ddfe7",
  deposit: "0xb6b55f25",
  requestWithdrawal: "0x9ee679e8",
  markPositionsClosed: "0xbcd77d83",
  settleWithdrawal: "0xfa8c360c",
  claim: "0x4e71d92d",
  pause: "0xddeb5094",
  // v2 writes
  allocateToVenue: "0x87cb45ab",
  setLimits: "0xc4590d3f",
  setTradingAccount: "0x1fc8aca3",
  // erc20
  approve: "0x095ea7b3",
  allowance: "0xdd62ed3e",
  balanceOf: "0x70a08231",
  decimals: "0x313ce567",
  // vault reads
  requests: "0x74adad1d",
  requestCount: "0x5badbe4c",
  requesters: "0x5e1a6c17",
  minDeposit: "0x41b3d185",
  navPerShare: "0xae097223",
  asset: "0x38d52e0f",
  // v2 reads
  maxTotalAssets: "0xd820f492",
  maxDepositPerTx: "0x4e2e8d60",
  tradingAccount: "0x09b57d1e",
  totalAllocated: "0x45f7f249",
  reservedForClaims: "0x12b8984a",
  availableLiquidity: "0x74375359",
} as const;

/** Custom errors of CovarVault, with a plain explanation of what to do. */
export const VAULT_ERRORS: Record<string, { name: string; hint: string }> = {
  "0x30cd7471": { name: "NotOwner", hint: "Only the owner (admin wallet A) can do this. Switch account in your wallet." },
  "0x7c214f04": { name: "NotOperator", hint: "Only the operator (wallet B) or the owner can do this. Switch account in your wallet." },
  "0xd4bd01c5": { name: "Paused_", hint: "Deposits are paused by the owner. Claims still work." },
  "0x2ec0c96a": { name: "CloseOnly_", hint: "The vault is in close-only mode. Withdrawals and claims still work." },
  "0x0c5d582f": { name: "StaleNav", hint: "No NAV report in the last 6 hours. The operator must call reportNav first." },
  "0xa31eeef6": { name: "NavJumpTooLarge", hint: "The new NAV differs more than 20% from the last report (circuit breaker)." },
  "0x1f2a2005": { name: "ZeroAmount", hint: "Amount is zero, or the fee would consume the whole amount." },
  "0x860b82a9": { name: "BelowMinimum", hint: "Below the minimum deposit (10 USDG)." },
  "0x39996567": { name: "InsufficientShares", hint: "This wallet does not hold that many vault shares." },
  "0xcffd93ac": { name: "NoRequest", hint: "Nothing to claim yet — the withdrawal must be settled by the operator first." },
  "0xde4168ba": { name: "WrongState", hint: "The withdrawal request is not in the right step for this action." },
  "0x90b8ec18": { name: "TransferFailed", hint: "Token transfer failed — usually missing approval, low balance, or the vault does not hold the funds." },
  // v2
  "0xa4875a49": { name: "CapExceeded", hint: "This deposit would push the vault over its TVL cap. Deposit less, or the owner raises the cap." },
  "0xc56d46d3": { name: "DepositTooLarge", hint: "Above the per-deposit cap. Split it into smaller deposits." },
  "0xbb55fd27": {
    name: "InsufficientLiquidity",
    hint: "The vault's free USDG (balance minus settled-but-unclaimed withdrawals) is too low. Return capital from the venue first.",
  },
  "0xc56b549b": { name: "NoTradingAccount", hint: "The owner has not set a trading account yet." },
};

export const REQUEST_STATES = ["None", "ClosingPositions", "Settling", "Claimable", "Claimed"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

// ------------------------------------------------------------------ encoding
const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
export const encAddress = (a: string) => strip(a).toLowerCase().padStart(64, "0");
export const encUint = (v: bigint) => {
  if (v < 0n) throw new Error("negative amount");
  return v.toString(16).padStart(64, "0");
};
export const encBool = (b: boolean) => encUint(b ? 1n : 0n);
export const calldata = (selector: string, ...words: string[]) => selector + words.join("");

export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

/** "12.5" → 12_500_000n for 6 decimals. Throws on malformed input. */
export function parseUnits(input: string, decimals = 6): bigint {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`"${input}" is not a valid amount`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function formatUnits(v: bigint, decimals = 6, maxFrac = 6): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  let frac = (a % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  if (frac) frac = "." + frac;
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac}`;
}

const word = (hex: string, i: number) => {
  const body = strip(hex);
  const chunk = body.slice(i * 64, i * 64 + 64);
  return chunk ? BigInt("0x" + chunk) : 0n;
};
const wordAddress = (hex: string, i: number) => "0x" + strip(hex).slice(i * 64 + 24, i * 64 + 64);

// --------------------------------------------------------------------- reads
/** A read must never hang the UI: wallets can sit on a request (locked, busy, just reloaded). */
export const WALLET_READ_TIMEOUT_MS = 5_000;
export const RPC_TIMEOUT_MS = 15_000;

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`), { code: "TIMEOUT" })), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    );
  });
}

/** POST a JSON-RPC body with a hard timeout; a hung RPC becomes a normal, retryable error. */
export async function rpcFetch(url: string, body: unknown, what: string): Promise<{ result?: unknown; error?: { message: string; data?: unknown } }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: ctl.signal });
    if (!res.ok) throw new Error(`RPC ${what} failed: HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (ctl.signal.aborted) throw Object.assign(new Error(`RPC ${what} timed out after ${RPC_TIMEOUT_MS / 1000}s (${url})`), { code: "TIMEOUT" });
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/**
 * eth_call through the wallet when connected (its RPC already works for the
 * user, VPN or not), else through the public RPC of the expected chain.
 */
export async function ethCall(to: string, data: string, chain: ChainId, from?: string): Promise<string> {
  const eth = injected();
  const params = [{ to, data, ...(from ? { from } : {}) }, "latest"];
  if (eth) {
    try {
      const walletChain = Number(BigInt(await withTimeout(eth.request({ method: "eth_chainId" }), WALLET_READ_TIMEOUT_MS, "wallet eth_chainId")));
      if (walletChain === chain) return await withTimeout(eth.request({ method: "eth_call", params }), WALLET_READ_TIMEOUT_MS, "wallet eth_call");
    } catch (e) {
      // a revert from the wallet's RPC must surface, not silently fall back
      if (revertData(e)) throw e;
    }
  }
  const json = await rpcFetch(CHAINS[chain].rpc, { jsonrpc: "2.0", id: Date.now(), method: "eth_call", params }, "eth_call");
  if (json.error) throw Object.assign(new Error(json.error.message), { data: json.error.data });
  return json.result as string;
}

export interface ConsoleSnapshot {
  usdgBalance: bigint;
  allowance: bigint;
  shares: bigint;
  minDeposit: bigint;
  navWad: bigint;
  request: { shares: bigint; settledAssets: bigint; requestedAt: number; settledAt: number; state: RequestState };
}

export async function readAccount(vault: string, asset: string, account: string, chain: ChainId): Promise<ConsoleSnapshot> {
  const [bal, allow, shares, min, nav, req] = await Promise.all([
    ethCall(asset, calldata(SEL.balanceOf, encAddress(account)), chain),
    ethCall(asset, calldata(SEL.allowance, encAddress(account), encAddress(vault)), chain),
    ethCall(vault, calldata(SEL.balanceOf, encAddress(account)), chain),
    ethCall(vault, SEL.minDeposit, chain),
    ethCall(vault, SEL.navPerShare, chain),
    ethCall(vault, calldata(SEL.requests, encAddress(account)), chain),
  ]);
  return {
    usdgBalance: word(bal, 0),
    allowance: word(allow, 0),
    shares: word(shares, 0),
    minDeposit: word(min, 0),
    navWad: word(nav, 0),
    request: decodeRequest(req),
  };
}

/** v2 fields. `null` when the vault is a v1 deployment (the getters do not exist). */
export interface VaultV2 {
  maxTotalAssets: bigint;
  maxDepositPerTx: bigint;
  tradingAccount: string;
  totalAllocated: bigint;
  reservedForClaims: bigint;
  availableLiquidity: bigint;
}

export async function readV2(vault: string, chain: ChainId): Promise<VaultV2 | null> {
  try {
    const [tvl, perTx, ta, alloc, reserved, free] = await Promise.all(
      [SEL.maxTotalAssets, SEL.maxDepositPerTx, SEL.tradingAccount, SEL.totalAllocated, SEL.reservedForClaims, SEL.availableLiquidity].map(
        (sel) => ethCall(vault, sel, chain),
      ),
    );
    if ([tvl, perTx, ta].some((h) => !h || h === "0x")) return null;
    return {
      maxTotalAssets: word(tvl, 0),
      maxDepositPerTx: word(perTx, 0),
      tradingAccount: wordAddress(ta, 0),
      totalAllocated: word(alloc, 0),
      reservedForClaims: word(reserved, 0),
      availableLiquidity: word(free, 0),
    };
  } catch {
    return null; // v1 vault: getters revert
  }
}

function decodeRequest(hex: string) {
  return {
    shares: word(hex, 1),
    settledAssets: word(hex, 2),
    requestedAt: Number(word(hex, 3)),
    settledAt: Number(word(hex, 4)),
    state: REQUEST_STATES[Number(word(hex, 5))] ?? "None",
  };
}

export interface PendingRequest {
  investor: string;
  shares: bigint;
  settledAssets: bigint;
  requestedAt: number;
  state: RequestState;
}

/** Withdrawal requests (latest first, unique investors) for the operator view. */
export async function readRequests(vault: string, chain: ChainId, limit = 25): Promise<PendingRequest[]> {
  const count = Number(word(await ethCall(vault, SEL.requestCount, chain), 0));
  const idx = Array.from({ length: Math.min(count, limit) }, (_, i) => count - 1 - i);
  const addrs = await Promise.all(idx.map((i) => ethCall(vault, calldata(SEL.requesters, encUint(BigInt(i))), chain)));
  const unique = [...new Set(addrs.map((h) => wordAddress(h, 0)))];
  const reqs = await Promise.all(unique.map((a) => ethCall(vault, calldata(SEL.requests, encAddress(a)), chain)));
  return unique.map((investor, i) => ({ investor, ...decodeRequest(reqs[i]) }));
}

// -------------------------------------------------------------------- errors
function revertData(e: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (x: any): string | null => {
    if (!x || typeof x !== "object" || seen.has(x)) return typeof x === "string" && /^0x[0-9a-f]{8}/i.test(x) ? x : null;
    seen.add(x);
    for (const k of ["data", "error", "cause", "originalError", "info"]) {
      const v = x[k];
      if (typeof v === "string" && /^0x[0-9a-f]{8}/i.test(v)) return v;
      const deeper = walk(v);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(e);
}

/** Human explanation for a failed call/transaction. */
export function explainError(e: unknown): string {
  const anyE = e as any;
  if (anyE?.code === 4001 || /user (rejected|denied)/i.test(anyE?.message ?? "")) return "Cancelled in the wallet — nothing was sent.";
  if (isStaleExtension(e)) return STALE_WALLET_MSG;
  const data = revertData(e);
  if (data) {
    const sel = data.slice(0, 10).toLowerCase();
    const known = VAULT_ERRORS[sel];
    if (known) return `${known.name} — ${known.hint}`;
    if (sel === "0x08c379a0") {
      try {
        const body = strip(data).slice(8);
        const len = Number(BigInt("0x" + body.slice(64, 128)));
        const bytes = body.slice(128, 128 + len * 2).match(/../g)?.map((b) => parseInt(b, 16)) ?? [];
        return `Reverted: ${new TextDecoder().decode(new Uint8Array(bytes))}`;
      } catch {
        /* fall through */
      }
    }
  }
  const msg = String(anyE?.shortMessage ?? anyE?.message ?? e);
  if (/insufficient funds/i.test(msg)) return "Not enough ETH for gas in this wallet — claim from the Robinhood testnet faucet or send a little ETH.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

// --------------------------------------------------------------------- wallet
export async function connectWallet(): Promise<{ account: string; chainId: number }> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found. Install MetaMask (or Rabby) and reload this page.");
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  const chainId = Number(BigInt(await eth.request({ method: "eth_chainId" })));
  if (!accounts?.[0]) throw new Error("The wallet returned no account.");
  return { account: accounts[0], chainId };
}

export async function switchChain(chain: ChainId): Promise<void> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found.");
  const hex = "0x" + chain.toString(16);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    if ((e as any)?.code !== 4902) throw e;
    const c = CHAINS[chain];
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hex, chainName: c.name, rpcUrls: [c.rpc], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [c.explorer] }],
    });
  }
}

/**
 * Simulate, then send. Returns the tx hash once the wallet broadcasts it.
 * Throws an explained error if the simulation reverts — no wallet prompt then.
 */
export async function sendTx(opts: { from: string; to: string; data: string; chain: ChainId }): Promise<string> {
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found.");
  const walletChain = Number(BigInt(await eth.request({ method: "eth_chainId" })));
  if (walletChain !== opts.chain) throw new Error(`Wallet is on chain ${walletChain}; switch it to ${opts.chain} first.`);
  try {
    await ethCall(opts.to, opts.data, opts.chain, opts.from);
  } catch (e) {
    throw new Error(explainError(e));
  }
  try {
    return await eth.request({ method: "eth_sendTransaction", params: [{ from: opts.from, to: opts.to, data: opts.data }] });
  } catch (e) {
    throw new Error(explainError(e));
  }
}

export async function waitForReceipt(hash: string, timeoutMs = 120_000): Promise<{ ok: boolean; blockNumber: number }> {
  const eth = injected();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const r = eth ? await withTimeout(eth.request({ method: "eth_getTransactionReceipt", params: [hash] }), WALLET_READ_TIMEOUT_MS, "wallet receipt").catch(() => null) : null;
    if (r) return { ok: r.status === "0x1", blockNumber: Number(BigInt(r.blockNumber)) };
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("No receipt after 2 minutes — check the explorer link.");
}
