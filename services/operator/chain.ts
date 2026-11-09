/**
 * On-chain port for the operator: reads a CovarVault snapshot and sends operator
 * transactions with wallet B. Every send is simulated first (estimateGas runs the
 * call), so a revert is decoded into the contract's custom error before any gas
 * is spent, and each send waits for its receipt before the next one.
 */
import { Contract, Interface, JsonRpcProvider, Wallet, getAddress, type Provider } from "ethers";
import type { Action, RequestState, VaultPort, VaultSnapshot } from "./app";

export const VAULT_ABI = [
  "function asset() view returns (address)",
  "function operator() view returns (address)",
  "function reportedAssets() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function lastNavUpdate() view returns (uint64)",
  "function maxNavAge() view returns (uint64)",
  "function maxNavChangeBps() view returns (uint256)",
  "function depositsPaused() view returns (bool)",
  "function closeOnly() view returns (bool)",
  "function requestCount() view returns (uint256)",
  "function requesters(uint256) view returns (address)",
  "function requests(address) view returns (address investor, uint256 shares, uint256 settledAssets, uint64 requestedAt, uint64 settledAt, uint8 state)",
  // v2
  "function tradingAccount() view returns (address)",
  "function reservedForClaims() view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
  // operator writes
  "function reportNav(uint256 newAssets)",
  "function markPositionsClosed(address investor)",
  "function settleWithdrawal(address investor, uint256 netAssets)",
  "function allocateToVenue(uint256 amount)",
  // errors
  "error NotOwner()",
  "error NotOperator()",
  "error Paused_()",
  "error CloseOnly_()",
  "error StaleNav()",
  "error NavJumpTooLarge()",
  "error ZeroAmount()",
  "error BelowMinimum()",
  "error InsufficientShares()",
  "error NoRequest()",
  "error WrongState()",
  "error TransferFailed()",
  "error CapExceeded()",
  "error DepositTooLarge()",
  "error InsufficientLiquidity()",
  "error NoTradingAccount()",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function transfer(address to, uint256 amount) returns (bool)"];
const STATES: RequestState[] = ["None", "ClosingPositions", "Settling", "Claimable", "Claimed"];
const vaultIface = new Interface(VAULT_ABI);

/** Turn an ethers revert into "Vault reverted: StaleNav()" where possible. */
export function decodeRevert(err: unknown): string {
  const e = err as { data?: string; info?: { error?: { data?: string } }; error?: { data?: string }; shortMessage?: string; message?: string };
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try {
      const parsed = vaultIface.parseError(data);
      if (parsed) return `vault reverted: ${parsed.name}()`;
    } catch {
      /* not ours */
    }
  }
  return e?.shortMessage ?? e?.message ?? String(err);
}

export interface ChainPortConfig {
  rpcUrl: string;
  vault: string;
  /** Required for live sends. */
  privateKey?: string;
  /** Used for gas/USDG balance reads in dry-run when no key is configured. */
  operatorAddress?: string;
  provider?: Provider;
}

export function createChainPort(cfg: ChainPortConfig): VaultPort & { address: string | null; checkRole(): Promise<string | null> } {
  const provider = cfg.provider ?? new JsonRpcProvider(cfg.rpcUrl);
  const wallet = cfg.privateKey ? new Wallet(cfg.privateKey, provider) : null;
  // Addresses pasted from chat/explorers often have the wrong mixed-case checksum;
  // ethers rejects those. Normalise (a malformed address still throws here).
  const norm = (a: string, what: string) => {
    try {
      return getAddress(a.trim().toLowerCase());
    } catch {
      throw new Error(`${what} is not a valid 0x address: ${a}`);
    }
  };
  const opAddr = wallet?.address ?? (cfg.operatorAddress ? norm(cfg.operatorAddress, "OPERATOR_ADDRESS") : null);
  const vault = new Contract(norm(cfg.vault, "vault address"), VAULT_ABI, wallet ?? provider);
  let assetAddr: string | null = null;
  let v2: boolean | null = null;

  async function asset() {
    assetAddr ??= (await vault.asset()) as string;
    return new Contract(assetAddr, ERC20_ABI, wallet ?? provider);
  }

  async function isV2() {
    if (v2 === null) {
      try {
        await vault.reservedForClaims();
        v2 = true;
      } catch {
        v2 = false;
      }
    }
    return v2;
  }

  async function snapshot(): Promise<VaultSnapshot> {
    const usdg = await asset();
    const v2now = await isV2();
    const [block, reportedAssets, totalShares, lastNavUpdate, maxNavAge, maxNavChangeBps, depositsPaused, closeOnly, count, vaultBalance] = await Promise.all([
      provider.getBlock("latest"),
      vault.reportedAssets() as Promise<bigint>,
      vault.totalShares() as Promise<bigint>,
      vault.lastNavUpdate() as Promise<bigint>,
      vault.maxNavAge() as Promise<bigint>,
      vault.maxNavChangeBps() as Promise<bigint>,
      vault.depositsPaused() as Promise<boolean>,
      vault.closeOnly() as Promise<boolean>,
      vault.requestCount() as Promise<bigint>,
      usdg.balanceOf(cfg.vault) as Promise<bigint>,
    ]);

    const requests: VaultSnapshot["requests"] = [];
    let claimableSum = 0n;
    for (let i = 0n; i < count; i++) {
      const who = (await vault.requesters(i)) as string;
      const r = await vault.requests(who);
      const state = STATES[Number(r.state)] ?? "None";
      if (state === "Claimable") claimableSum += r.settledAssets as bigint;
      requests.push({ investor: who, shares: r.shares as bigint, requestedAt: Number(r.requestedAt), state });
    }
    // a requester can re-request after claiming; keep one entry per address
    const unique = [...new Map(requests.map((r) => [r.investor.toLowerCase(), r])).values()];

    let reservedForClaims = claimableSum; // v1 has no on-chain reserve: derive it from Claimable requests
    let availableLiquidity = vaultBalance > claimableSum ? vaultBalance - claimableSum : 0n;
    let tradingAccount: string | null = null;
    if (v2now) {
      [reservedForClaims, availableLiquidity, tradingAccount] = await Promise.all([vault.reservedForClaims(), vault.availableLiquidity(), vault.tradingAccount()]);
      if (tradingAccount === "0x0000000000000000000000000000000000000000") tradingAccount = null;
    }

    // no address configured (e.g. the monitor): watch the wallet the vault names as operator
    const who = opAddr ?? ((await vault.operator()) as string);
    const [operatorGasWei, operatorUsdg] = await Promise.all([provider.getBalance(who), usdg.balanceOf(who) as Promise<bigint>]);

    return {
      isV2: v2now,
      now: block?.timestamp ?? Math.floor(Date.now() / 1000),
      reportedAssets,
      totalShares,
      lastNavUpdate: Number(lastNavUpdate),
      maxNavAge: Number(maxNavAge),
      maxNavChangeBps: Number(maxNavChangeBps),
      depositsPaused,
      closeOnly,
      vaultBalance,
      reservedForClaims,
      availableLiquidity,
      tradingAccount,
      operatorUsdg,
      operatorGasWei,
      requests: unique,
    };
  }

  async function send(a: Exclude<Action, { kind: "closePositions" }>): Promise<{ hash: string }> {
    if (!wallet) throw new Error("no OPERATOR_PRIVATE_KEY configured — live sends are impossible");
    try {
      let tx;
      switch (a.kind) {
        case "reportNav":
          await vault.reportNav.estimateGas(a.assets);
          tx = await vault.reportNav(a.assets);
          break;
        case "markPositionsClosed":
          await vault.markPositionsClosed.estimateGas(a.investor);
          tx = await vault.markPositionsClosed(a.investor);
          break;
        case "settleWithdrawal":
          await vault.settleWithdrawal.estimateGas(a.investor, a.netAssets);
          tx = await vault.settleWithdrawal(a.investor, a.netAssets);
          break;
        case "allocateToVenue":
          await vault.allocateToVenue.estimateGas(a.amount);
          tx = await vault.allocateToVenue(a.amount);
          break;
        case "fundVault": {
          const usdg = await asset();
          tx = await usdg.transfer(cfg.vault, a.amount); // destination is always the vault itself
          break;
        }
      }
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error(`transaction ${tx.hash} failed`);
      return { hash: tx.hash as string };
    } catch (err) {
      throw new Error(decodeRevert(err));
    }
  }

  /** Returns a problem description if wallet B is not the vault operator. */
  async function checkRole(): Promise<string | null> {
    if (!opAddr) return "no operator address configured (OPERATOR_PRIVATE_KEY or OPERATOR_ADDRESS)";
    const onChain = ((await vault.operator()) as string).toLowerCase();
    return onChain === opAddr.toLowerCase() ? null : `wallet ${opAddr} is not the vault operator (${onChain})`;
  }

  return { snapshot, send, address: opAddr, checkRole };
}
