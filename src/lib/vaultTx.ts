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

/**
 * Custom errors of CovarVault and of the USDG token, each with a plain-language
 * explanation an investor understands. `name` stays for logs/tests only; the UI
 * shows `hint`.
 */
export const VAULT_ERRORS: Record<string, { name: string; hint: string }> = {
  "0x30cd7471": { name: "NotOwner", hint: "Only the vault owner (admin wallet) can do this. Switch to that account in your wallet." },
  "0x7c214f04": { name: "NotOperator", hint: "Only the vault operator or owner can do this. Switch to that account in your wallet." },
  "0xd4bd01c5": { name: "Paused_", hint: "Deposits are paused for now. Withdrawals and claims still work." },
  "0x2ec0c96a": { name: "CloseOnly_", hint: "The vault is winding down positions, so new deposits are closed. Withdrawals and claims still work." },
  "0x0c5d582f": {
    name: "StaleNav",
    hint: "Deposits are paused for a moment: the vault's share price has not been updated in the last 6 hours. It refreshes automatically — please try again shortly.",
  },
  "0xa31eeef6": { name: "NavJumpTooLarge", hint: "The new share price differs too much from the last one, so the safety brake stopped it. It needs a manual review." },
  "0x1f2a2005": { name: "ZeroAmount", hint: "The amount is too small — after fees nothing would be left. Enter a larger amount." },
  "0x860b82a9": { name: "BelowMinimum", hint: "That is below the minimum deposit. Enter a larger amount." },
  "0x39996567": { name: "InsufficientShares", hint: "You don't hold that many vault shares. Enter a smaller number." },
  "0xcffd93ac": { name: "NoRequest", hint: "There is nothing to claim yet. Your withdrawal becomes claimable once it is settled." },
  "0xde4168ba": { name: "WrongState", hint: "Your withdrawal is not at this step yet. Refresh the page to see its current status." },
  "0x90b8ec18": { name: "TransferFailed", hint: "The USDG transfer did not go through — usually not enough USDG or a missing approval. Check your balance and try again." },
  // v2
  "0xa4875a49": { name: "CapExceeded", hint: "The vault is close to its size limit, so this deposit doesn't fit. Try a smaller amount." },
  "0xc56d46d3": { name: "DepositTooLarge", hint: "That is above the per-deposit limit. Split it into smaller deposits." },
  "0xbb55fd27": {
    name: "InsufficientLiquidity",
    hint: "The vault doesn't have enough free USDG on hand right now. The operator is bringing funds back; please try again later.",
  },
  "0xc56b549b": { name: "NoTradingAccount", hint: "The vault's trading account is not set up yet." },
  // USDG token (Robinhood Chain) and standard OpenZeppelin ERC-20 errors
  "0x356680b7": { name: "InsufficientFunds", hint: "Your wallet doesn't have enough USDG for this. Add USDG to this wallet or enter a smaller amount." },
  "0xe450d38c": { name: "ERC20InsufficientBalance", hint: "Your wallet doesn't have enough USDG for this. Add USDG to this wallet or enter a smaller amount." },
  "0xfb8f41b2": { name: "ERC20InsufficientAllowance", hint: "The vault isn't approved to use that much of your USDG yet. Approve first, then try again." },
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
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter an amount as a number, for example 25 or 12.5.");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`Use at most ${decimals} digits after the decimal point.`);
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

/** Error text that means "the network/RPC could not be reached", not "the transaction is invalid". */
const NETWORK_RE = /failed to fetch|fetch failed|networkerror|network error|load failed|timed out|timeout|econn|enotfound|socket hang up|http 5\d\d|http 429|rate limit|too many requests|rpc request failed|could not coalesce|missing response|bad gateway|service unavailable/i;

/**
 * Plain-language explanation for a failed call or transaction. Never returns
 * raw RPC dumps, request bodies, hex or stack text: those go to the console for
 * debugging, the person sees what happened and what to do next.
 */
export function explainError(e: unknown): string {
  const anyE = e as any;
  const raw = String(anyE?.shortMessage ?? anyE?.message ?? e ?? "");
  if (anyE?.code === 4001 || anyE?.code === "ACTION_REJECTED" || /user (rejected|denied|cancel)|rejected the request|request rejected/i.test(raw))
    return "You cancelled this in your wallet. Nothing was sent.";
  if (isStaleExtension(e)) return STALE_WALLET_MSG;
  if (anyE?.code === -32002 || /already pending|request of type .* already pending/i.test(raw))
    return "Your wallet already has a request waiting. Open the wallet extension to approve or reject it.";
  if (anyE?.code === 4100 || /not authorized|unauthorized|locked/i.test(raw)) return "Your wallet is locked or hasn't allowed this site yet. Unlock it and try again.";
  if (anyE?.code === 4902 || /unrecognized chain|unknown chain/i.test(raw)) return "Your wallet doesn't know Robinhood Chain yet. Approve “Add network” in your wallet, then try again.";

  const data = revertData(e);
  if (data) {
    const sel = data.slice(0, 10).toLowerCase();
    const known = VAULT_ERRORS[sel];
    if (known) return known.hint;
    if (sel === "0x08c379a0") {
      try {
        const body = strip(data).slice(8);
        const len = Number(BigInt("0x" + body.slice(64, 128)));
        const bytes = body.slice(128, 128 + len * 2).match(/../g)?.map((b) => parseInt(b, 16)) ?? [];
        const reason = new TextDecoder().decode(new Uint8Array(bytes));
        if (/exceeds balance|insufficient balance/i.test(reason)) return VAULT_ERRORS["0x356680b7"].hint;
        if (/allowance/i.test(reason)) return VAULT_ERRORS["0xfb8f41b2"].hint;
        if (reason && reason.length < 120 && !/0x[0-9a-f]{8}/i.test(reason)) return `The network refused this transaction: “${reason}”. Nothing was sent.`;
      } catch {
        /* fall through */
      }
    }
    console.warn("[covar] unrecognised revert", data, e);
    return "This transaction would fail, so it was not sent and nothing left your wallet. Refresh the page and try again; if it keeps happening, contact support.";
  }

  if (/insufficient funds|gas required exceeds|intrinsic gas/i.test(raw))
    return "Not enough ETH in this wallet to pay the network fee (gas). Add a little Robinhood Chain testnet ETH from the faucet, then try again.";
  if (/nonce too low|replacement transaction underpriced|already known/i.test(raw))
    return "Your wallet has an earlier transaction still in progress. Wait for it to finish (or reset the wallet's activity), then try again.";
  if (/execution reverted|revert/i.test(raw)) return "This transaction would fail, so it was not sent and nothing left your wallet. Check the amount and your balance, then try again.";
  if (/wallet is on chain|wrong network|chain mismatch|switch it to/i.test(raw)) return "Your wallet is on a different network. Switch it to Robinhood Chain and try again.";
  if (/no browser wallet/i.test(raw)) return "No wallet found in this browser. Install MetaMask or Rabby, then reload the page.";
  if (NETWORK_RE.test(raw)) {
    console.warn("[covar] network error", e);
    return "Couldn't reach Robinhood Chain right now. Check your internet connection (a VPN can help if the network is blocked where you are) and try again in a moment.";
  }
  // Already a friendly sentence written by this app? Keep it; anything that looks like a dump is replaced.
  const looksRaw = raw.length > 180 || /[{}[\]]|0x[0-9a-f]{16,}|request body|stack|version:|details:/i.test(raw);
  if (raw && !looksRaw) return raw;
  console.warn("[covar] unexplained error", e);
  return "Something went wrong and nothing was sent. Please try again in a moment.";
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
  if (walletChain !== opts.chain) throw new Error(`Your wallet is on a different network. Switch it to ${CHAINS[opts.chain]?.name ?? "Robinhood Chain"} and try again.`);
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
  throw new Error("The transaction is taking longer than usual to confirm. Check the explorer link — it may still go through.");
}
