/**
 * Read-only Robinhood Chain client.
 *
 * Deliberately dependency-free: plain JSON-RPC over fetch with hand-decoded
 * ABI words, because the app only *reads* chain state (no signing, no keys in
 * the browser). Anything that needs signing belongs in the isolated signer
 * service, not here.
 *
 * If no vault is configured (no NEXT_PUBLIC_COVAR_VAULT_ADDRESS), the app falls
 * back to the simulated ledger and every surface says so. The UI must never
 * present simulated numbers as on-chain values.
 */

export const CHAINS = {
  46630: {
    name: "Robinhood Chain Testnet",
    // Acuan key names first (NEXT_PUBLIC_RH_*_RPC_URL), legacy fallback kept.
    rpc:
      process.env.NEXT_PUBLIC_RH_TESTNET_RPC_URL ||
      process.env.NEXT_PUBLIC_RH_TESTNET_RPC ||
      "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    gasToken: "testnet ETH",
    isMainnet: false,
  },
  4663: {
    name: "Robinhood Chain",
    rpc:
      process.env.NEXT_PUBLIC_RH_MAINNET_RPC_URL ||
      process.env.NEXT_PUBLIC_RH_MAINNET_RPC ||
      "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    gasToken: "ETH",
    isMainnet: true,
  },
  // local rehearsal node (hardhat) — never a production target
  31337: {
    name: "Local rehearsal",
    rpc: process.env.NEXT_PUBLIC_LOCAL_RPC || "http://127.0.0.1:8545",
    explorer: "http://127.0.0.1:8545",
    gasToken: "local ETH",
    isMainnet: false,
  },
} as const;

export type ChainId = keyof typeof CHAINS;

// Acuan key names first (NEXT_PUBLIC_RH_*_CHAIN_ID / NEXT_PUBLIC_CHAIN_ENV),
// legacy NEXT_PUBLIC_RH_CHAIN_ID still honoured.
const chainEnv = (process.env.NEXT_PUBLIC_CHAIN_ENV || "").toLowerCase();
const defaultChain =
  chainEnv === "mainnet"
    ? Number(process.env.NEXT_PUBLIC_RH_MAINNET_CHAIN_ID || 4663)
    : Number(process.env.NEXT_PUBLIC_RH_TESTNET_CHAIN_ID || 46630);

export const EXPECTED_CHAIN_ID: ChainId =
  (Number(
    process.env.NEXT_PUBLIC_RH_CHAIN_ID || defaultChain
  ) as ChainId) || defaultChain || 46630;

export const VAULT_ADDRESS: string | null = process.env.NEXT_PUBLIC_COVAR_VAULT_ADDRESS || null;

export const rpcUrl = (chain: ChainId = EXPECTED_CHAIN_ID) => CHAINS[chain].rpc;
export const explorerAddress = (address: string, chain: ChainId = EXPECTED_CHAIN_ID) =>
  `${CHAINS[chain].explorer}/address/${address}`;

/** Selectors computed from the CovarVault ABI subset we read. */
const SEL = {
  navPerShare: "0xae097223",
  totalShares: "0x3a98ef39",
  reportedAssets: "0x22487656",
  lastNavUpdate: "0xb808e343",
  depositsPaused: "0x60da3e83",
  closeOnly: "0xc7dc844d",
  maxNavAge: "0xd3d86052",
  asset: "0x38d52e0f",
  assetDecimals: "0xc2d41601",
  shareDecimals: "0x3af8e5eb",
  owner: "0x8da5cb5b",
  operator: "0x570ca735",
  feeRecipient: "0x46904840",
  depositFeeBps: "0xab879827",
  depositFeeFlat: "0x48b1c17f",
  withdrawalFeeBps: "0x04336bb3",
  withdrawalFeeFlat: "0x441a7af6",
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
  balanceOf: "0x70a08231",
};

let rpcId = 0;

async function rpc<T>(method: string, params: unknown[], chain: ChainId = EXPECTED_CHAIN_ID): Promise<T> {
  // hard timeout: a hung RPC must surface as an error the UI can retry, never "…" forever
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  let json: { result?: T; error?: { message: string } };
  try {
    const res = await fetch(rpcUrl(chain), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      cache: "no-store",
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
    json = (await res.json()) as { result?: T; error?: { message: string } };
  } catch (e) {
    if (ctl.signal.aborted) throw new Error(`RPC ${method} timed out after 15s (${rpcUrl(chain)})`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

const word = (hex: string, index = 0) => {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const chunk = body.slice(index * 64, index * 64 + 64);
  return chunk ? BigInt(`0x${chunk || "0"}`) : 0n;
};

const bigToNumber = (v: bigint, decimals = 0) => Number(v) / 10 ** decimals;

async function call(to: string, data: string, chain: ChainId = EXPECTED_CHAIN_ID): Promise<string> {
  return rpc<string>("eth_call", [{ to, data }, "latest"], chain);
}

async function callBig(to: string, data: string): Promise<bigint> {
  const out = await call(to, data);
  return out === "0x" ? 0n : word(out, 0);
}

async function callAddress(to: string, data: string): Promise<string> {
  const out = await call(to, data);
  if (!out || out === "0x") return "";
  return `0x${out.slice(-40)}`;
}

async function callString(to: string, data: string): Promise<string> {
  const out = await call(to, data);
  if (!out || out === "0x") return "";
  const body = out.slice(2);
  const len = Number(BigInt(`0x${body.slice(64, 128)}`));
  const hex = body.slice(128, 128 + len * 2);
  return Buffer.from(hex, "hex").toString("utf8");
}

export interface ChainStatus {
  ok: boolean;
  chainId: number;
  chainIdMatches: boolean;
  blockNumber: number;
  latencyMs: number;
  error?: string;
  checkedAt: string;
}

export async function getChainStatus(): Promise<ChainStatus> {
  const started = Date.now();
  try {
    const [chainIdHex, blockHex] = await Promise.all([rpc<string>("eth_chainId", []), rpc<string>("eth_blockNumber", [])]);
    const chainId = Number(BigInt(chainIdHex));
    return {
      ok: true,
      chainId,
      chainIdMatches: chainId === EXPECTED_CHAIN_ID,
      blockNumber: Number(BigInt(blockHex)),
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      ok: false,
      chainId: 0,
      chainIdMatches: false,
      blockNumber: 0,
      latencyMs: Date.now() - started,
      error: (e as Error).message,
      checkedAt: new Date().toISOString(),
    };
  }
}

export interface VaultState {
  address: string;
  chainId: number;
  /** NAV per share scaled to 1e18, as the contract returns it. */
  navPerShareWad: bigint;
  navPerShare: number;
  totalShares: number;
  reportedAssets: number;
  lastNavUpdate: number; // unix seconds, 0 = never reported
  navAgeSeconds: number;
  navIsStale: boolean;
  maxNavAgeSeconds: number;
  depositsPaused: boolean;
  closeOnly: boolean;
  asset: string;
  assetSymbol: string;
  assetDecimals: number;
  depositFeeBps: number;
  depositFeeFlat: number;
  withdrawalFeeBps: number;
  withdrawalFeeFlat: number;
  owner: string;
  operator: string;
  feeRecipient: string;
  blockNumber: number;
  /** Exact on-chain integers (asset units), for amount maths without float error. */
  raw: { reportedAssets: bigint; totalShares: bigint; depositFeeFlat: bigint; withdrawalFeeFlat: bigint };
}

export async function readVault(address: string = VAULT_ADDRESS ?? ""): Promise<VaultState> {
  if (!address) throw new Error("No vault address configured");
  const code = await rpc<string>("eth_getCode", [address, "latest"]);
  if (!code || code === "0x") throw new Error(`No contract bytecode at ${address} on chain ${EXPECTED_CHAIN_ID}`);

  const [
    navWad,
    totalShares,
    reportedAssets,
    lastNavUpdate,
    depositsPaused,
    closeOnly,
    maxNavAge,
    assetAddress,
    assetDecimals,
    depositFeeBps,
    depositFeeFlat,
    withdrawalFeeBps,
    withdrawalFeeFlat,
    owner,
    operator,
    feeRecipient,
    blockHex,
  ] = await Promise.all([
    callBig(address, SEL.navPerShare),
    callBig(address, SEL.totalShares),
    callBig(address, SEL.reportedAssets),
    callBig(address, SEL.lastNavUpdate),
    callBig(address, SEL.depositsPaused),
    callBig(address, SEL.closeOnly),
    callBig(address, SEL.maxNavAge),
    callAddress(address, SEL.asset),
    callBig(address, SEL.assetDecimals),
    callBig(address, SEL.depositFeeBps),
    callBig(address, SEL.depositFeeFlat),
    callBig(address, SEL.withdrawalFeeBps),
    callBig(address, SEL.withdrawalFeeFlat),
    callAddress(address, SEL.owner),
    callAddress(address, SEL.operator),
    callAddress(address, SEL.feeRecipient),
    rpc<string>("eth_blockNumber", []),
  ]);

  const decimals = Number(assetDecimals);
  const symbol = assetAddress ? await callString(assetAddress, SEL.symbol).catch(() => "USDG") : "USDG";
  const now = Math.floor(Date.now() / 1000);
  const navAge = lastNavUpdate > 0n ? now - Number(lastNavUpdate) : Number.POSITIVE_INFINITY;

  return {
    address,
    chainId: EXPECTED_CHAIN_ID,
    navPerShareWad: navWad,
    navPerShare: bigToNumber(navWad, 18),
    totalShares: bigToNumber(totalShares, decimals),
    reportedAssets: bigToNumber(reportedAssets, decimals),
    lastNavUpdate: Number(lastNavUpdate),
    navAgeSeconds: Number.isFinite(navAge) ? navAge : -1,
    navIsStale: !Number.isFinite(navAge) || navAge > Number(maxNavAge),
    maxNavAgeSeconds: Number(maxNavAge),
    depositsPaused: depositsPaused === 1n,
    closeOnly: closeOnly === 1n,
    asset: assetAddress,
    assetSymbol: symbol || "USDG",
    assetDecimals: decimals,
    depositFeeBps: Number(depositFeeBps),
    depositFeeFlat: bigToNumber(depositFeeFlat, decimals),
    withdrawalFeeBps: Number(withdrawalFeeBps),
    withdrawalFeeFlat: bigToNumber(withdrawalFeeFlat, decimals),
    owner,
    operator,
    feeRecipient,
    blockNumber: Number(BigInt(blockHex)),
    raw: { reportedAssets, totalShares, depositFeeFlat, withdrawalFeeFlat },
  };
}

/** ERC-20 balance read used for the wallet card. */
export async function readTokenBalance(token: string, holder: string): Promise<number> {
  const data = `${SEL.balanceOf}${holder.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const [raw, decimalsOut] = await Promise.all([callBig(token, data), callBig(token, SEL.decimals)]);
  return bigToNumber(raw, Number(decimalsOut) || 6);
}
