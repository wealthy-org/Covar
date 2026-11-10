"use client";

/**
 * Investor panel for the DEPLOYED CovarVault (package 3.5): deposit, request a
 * withdrawal, claim — signed in the investor's own wallet, on a normal page.
 *
 * Every number comes from the contract or the wallet. Every write is simulated
 * first (vaultTx.sendTx), so a revert is explained before a wallet prompt. Rows
 * are written to the ledger only after a receipt with status 1.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CHAINS, EXPECTED_CHAIN_ID, VAULT_ADDRESS, readVault, type VaultState } from "@/lib/chain";
import {
  SEL,
  calldata,
  connectWallet,
  encAddress,
  encUint,
  explainError,
  formatUnits,
  injected,
  parseUnits,
  readAccount,
  readV2,
  sendTx,
  switchChain,
  waitForReceipt,
  type ConsoleSnapshot,
  type VaultV2,
} from "@/lib/vaultTx";
import { actions } from "@/lib/store";
import { useAuth } from "@/lib/session";

const STEP_LABEL: Record<string, string> = {
  ClosingPositions: "Requested · Closing positions",
  Settling: "Positions closed · Settling",
  Claimable: "Settled · Ready to claim",
  Claimed: "Claimed",
};

/** The four on-chain stages of a withdrawal, named after the events the vault emits. */
const WD_STEPS = [
  { key: "requested", label: "Withdrawal requested", event: "WithdrawalRequested" },
  { key: "closed", label: "Positions closed", event: "PositionsClosed" },
  { key: "settled", label: "Settled", event: "WithdrawalSettled" },
  { key: "claimed", label: "Claimed to wallet", event: "WithdrawalClaimed" },
] as const;
/** index of the step currently in progress (steps before it are done) */
const WD_CURRENT: Record<string, number> = { ClosingPositions: 1, Settling: 2, Claimable: 3, Claimed: 4 };

interface Receipt {
  label: string;
  hash: string;
  block: number;
  shares: [bigint, bigint];
  usdg: [bigint, bigint];
}

export function InvestPanel({ agentId, compact = false }: { agentId?: string; compact?: boolean }) {
  const chain = EXPECTED_CHAIN_ID;
  const [vault, setVault] = useState<VaultState | null>(null);
  const [v2, setV2] = useState<VaultV2 | null>(null);
  const [acct, setAcct] = useState<ConsoleSnapshot | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "info"; text: string; hash?: string } | null>(null);
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [shares, setShares] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const auth = useAuth();

  /** true = everything read; false = something failed (caller retries sooner) */
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!VAULT_ADDRESS) return true;
    try {
      const [v, x] = await Promise.all([readVault(VAULT_ADDRESS), readV2(VAULT_ADDRESS, chain)]);
      setVault(v);
      setV2(x);
      setReadErr(null);
      if (account) setAcct(await readAccount(VAULT_ADDRESS, v.asset, account, chain));
      return true;
    } catch (e) {
      setReadErr(explainError(e));
      return false;
    }
  }, [account, chain]);

  // Fill the ledger from the chain (indexer): confirmed vault txs of the signed-in
  // wallet that this device never recorded — another tab, another device, a lost sync.
  // Only for the signed-in account, so another wallet's history never lands here.
  const signedAs = auth.status === "signed-in" ? auth.user?.address.toLowerCase() : undefined;
  const assetDecimals = vault?.assetDecimals;
  const syncActivity = useCallback(async () => {
    if (!VAULT_ADDRESS || !account || !signedAs || account.toLowerCase() !== signedAs) return;
    try {
      const r = await fetch(`/api/vault/activity?address=${account}`, { cache: "no-store" }).then((x) => x.json());
      if (r?.ok && Array.isArray(r.events)) actions.syncChainActivity(r.events, { decimals: assetDecimals ?? 6, agentId });
    } catch {
      /* indexer down: the ledger keeps what this device recorded */
    }
  }, [account, signedAs, assetDecimals, agentId]);
  useEffect(() => {
    void syncActivity();
    const t = setInterval(() => void syncActivity(), 30_000);
    return () => clearInterval(t);
  }, [syncActivity]);

  // Poll every 20 s; after a failed read retry in 3 s, so one slow RPC or wallet
  // answer right after a reload doesn't leave the panel on "…" for a whole cycle.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      const ok = await refresh();
      if (!stop) timer = setTimeout(() => void loop(), ok ? 20_000 : 3_000);
    };
    void loop();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  // Pick up an already-authorised wallet silently, and follow account/chain switches.
  // After a reload the wallet may answer late (extension injecting after hydration,
  // a slow first request), so a single eth_accounts call is not enough: retry for
  // ~30 s until it answers, and also react to MetaMask's `ethereum#initialized`.
  useEffect(() => {
    let cancelled = false;
    let found = false;
    let attached: ReturnType<typeof injected> = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAcc = (a: string[]) => setAccount(a?.[0] ?? null);
    const onChain = (c: string) => setWalletChain(Number(BigInt(c)));
    const probe = async (attempt: number) => {
      const eth = injected();
      if (eth && !attached) {
        attached = eth;
        eth.on?.("accountsChanged", onAcc);
        eth.on?.("chainChanged", onChain);
      }
      if (eth) {
        try {
          const c: string = await eth.request({ method: "eth_chainId" });
          if (!cancelled) setWalletChain(Number(BigInt(c)));
        } catch {
          /* retried below */
        }
        try {
          const a: string[] = await eth.request({ method: "eth_accounts" });
          if (!cancelled && a?.[0]) {
            found = true;
            setAccount(a[0]);
          }
        } catch {
          /* retried below */
        }
      }
      if (!cancelled && !found && attempt < 20) timer = setTimeout(() => void probe(attempt + 1), 1500);
    };
    const onInit = () => void probe(0);
    void probe(0);
    window.addEventListener("ethereum#initialized", onInit, { once: true });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("ethereum#initialized", onInit);
      attached?.removeListener?.("accountsChanged", onAcc);
      attached?.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const dec = vault?.assetDecimals ?? 6;
  const sym = vault?.assetSymbol ?? "USDG";
  const fmt = (v: bigint, f = 2) => formatUnits(v, dec, f);

  /* ---------------------------------------------------------------- deposit maths */
  const dep = useMemo(() => {
    if (!vault || !amount) return null;
    let gross: bigint;
    try {
      gross = parseUnits(amount, dec);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
    const fee = (gross * BigInt(vault.depositFeeBps)) / 10_000n + vault.raw.depositFeeFlat;
    const net = gross > fee ? gross - fee : 0n;
    const sharesOut = vault.raw.totalShares === 0n ? net : (net * 10n ** 18n) / vault.navPerShareWad;
    let error: string | null = null;
    const min = acct?.minDeposit ?? 10n * 10n ** BigInt(dec);
    if (vault.depositsPaused) error = "Deposits are paused for now. Withdrawals and claims still work.";
    else if (vault.closeOnly) error = "New deposits are closed while the vault winds down positions. Withdrawals and claims still work.";
    else if (vault.navIsStale) error = "Deposits are paused for a moment: the vault's share price hasn't been updated in the last 6 hours. It refreshes automatically — please try again shortly.";
    else if (gross < min) error = `Minimum deposit is ${fmt(min)} ${sym}.`;
    else if (v2 && gross > v2.maxDepositPerTx) error = `Per-deposit limit is ${fmt(v2.maxDepositPerTx)} ${sym}.`;
    else if (v2 && vault.raw.reportedAssets + net > v2.maxTotalAssets) error = `Only ${fmt(v2.maxTotalAssets > vault.raw.reportedAssets ? v2.maxTotalAssets - vault.raw.reportedAssets : 0n)} ${sym} of capacity left under the vault cap.`;
    else if (acct && gross > acct.usdgBalance) error = acct.usdgBalance === 0n ? `This wallet has no ${sym} yet. Add ${sym} to it first.` : `Your wallet only has ${fmt(acct.usdgBalance)} ${sym}. Enter that amount or less.`;
    return { ok: true as const, gross, fee, net, sharesOut, error };
  }, [amount, vault, v2, acct, dec, sym]); // eslint-disable-line react-hooks/exhaustive-deps

  const wd = useMemo(() => {
    if (!vault || !shares || !acct) return null;
    let s: bigint;
    try {
      s = parseUnits(shares, dec);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
    const gross = (s * vault.navPerShareWad) / 10n ** 18n;
    const feeBps = BigInt(vault.withdrawalFeeBps);
    let fee = (gross * feeBps) / 10_000n + vault.raw.withdrawalFeeFlat;
    if (fee >= gross) fee = 0n;
    let error: string | null = null;
    if (s === 0n) error = "Enter a number of shares.";
    else if (s > acct.shares) error = `You hold ${fmt(acct.shares, 4)} shares.`;
    else if (acct.request.state === "ClosingPositions" || acct.request.state === "Settling") error = "You already have a withdrawal in progress.";
    return { ok: true as const, s, gross, fee, net: gross - fee, error };
  }, [shares, vault, acct, dec]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------------- tx runner */
  /** Sends one transaction; resolves true once it is confirmed with status 1. */
  async function run(label: string, to: string, data: string, after?: (hash: string) => void, opts: { receipt?: boolean } = {}): Promise<boolean> {
    if (!account) return false;
    setBusy(label);
    setMsg({ tone: "info", text: `${label}: confirm in your wallet…` });
    const before = acct;
    try {
      const hash = await sendTx({ from: account, to, data, chain });
      setMsg({ tone: "info", text: `${label}: sent, waiting for confirmation…`, hash });
      const r = await waitForReceipt(hash);
      if (!r.ok) throw new Error("The transaction failed on the network. Nothing moved except a small network fee.");
      setMsg({ tone: "ok", text: `${label}: confirmed in block ${r.blockNumber}.`, hash });
      after?.(hash);
      if (opts.receipt && before && vault && VAULT_ADDRESS) {
        // read the wallet again so the receipt shows real before → after balances
        try {
          const now = await readAccount(VAULT_ADDRESS, vault.asset, account, chain);
          setReceipt({ label, hash, block: Number(r.blockNumber), shares: [before.shares, now.shares], usdg: [before.usdgBalance, now.usdgBalance] });
        } catch {
          /* the balances refresh below anyway */
        }
      }
      await refresh();
      setTimeout(() => void syncActivity(), 6_000); // once the indexer has the block
      return true;
    } catch (e) {
      setMsg({ tone: "err", text: explainError(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function depositFlow() {
    if (!dep || !dep.ok || dep.error || !vault || !VAULT_ADDRESS || !acct) return;
    const { gross, fee } = dep;
    if (acct.allowance < gross) {
      const ok = await run(`Step 1 of 2 · Approve ${fmt(gross)} ${sym}`, vault.asset, calldata(SEL.approve, encAddress(VAULT_ADDRESS), encUint(gross)));
      if (!ok) return;
    }
    await run(
      `Deposit ${fmt(gross)} ${sym}`,
      VAULT_ADDRESS,
      calldata(SEL.deposit, encUint(gross)),
      (hash) => {
        actions.recordChainTx({ kind: "deposit", label: `Deposited ${fmt(gross)} ${sym}`, amountUsd: Number(formatUnits(gross, dec, 6).replace(/,/g, "")), txHash: hash, agentId, note: `fee ${fmt(fee)}` });
        setAmount("");
      },
      { receipt: true },
    );
  }

  const connect = async () => {
    try {
      const c = await connectWallet();
      setAccount(c.account);
      setWalletChain(c.chainId);
    } catch (e) {
      setMsg({ tone: "err", text: explainError(e) });
    }
  };

  /* ---------------------------------------------------------------- render */
  if (!VAULT_ADDRESS) {
    return (
      <div className="panel stack gap-8" style={{ padding: 14 }} data-testid="invest-panel">
        <span className="small strong">Invest</span>
        <span className="tiny">No vault is deployed for this environment yet, so there is nothing real to deposit into.</span>
      </div>
    );
  }

  const explorer = CHAINS[chain].explorer;
  const req = acct?.request;
  const needApprove = !!(dep && !(dep.error) && dep.ok && acct && acct.allowance < dep.gross);
  const wrongChain = account && walletChain !== null && walletChain !== chain;
  const valueOfShares = acct && vault ? (acct.shares * vault.navPerShareWad) / 10n ** 18n : 0n;

  return (
    <div className={compact ? "stack gap-12" : "rcard rcard-pad stack gap-14"} data-testid="invest-panel">
      <div className="row between gap-8">
        <span className="stat-label">Invest · on-chain</span>
        <span className={`pill ${CHAINS[chain].isMainnet ? "pill-green" : "pill-amber"}`}>{CHAINS[chain].isMainnet ? "Mainnet" : chain === 31337 ? "Local chain" : "Testnet"}</span>
      </div>

      {readErr && (
        <div className="notice notice-warn" role="alert">
          <div>Couldn&apos;t load the vault right now. {readErr}</div>
        </div>
      )}

      {vault && (
        <div>
          <div className="kv">
            <span className="kv-k">NAV per share</span>
            <span className="kv-v">{vault.navPerShare.toFixed(4)} {sym}</span>
          </div>
          <div className="kv">
            <span className="kv-k">Vault assets</span>
            <span className="kv-v">{fmt(vault.raw.reportedAssets)} {sym}{v2 ? ` / cap ${fmt(v2.maxTotalAssets, 0)}` : ""}</span>
          </div>
          <div className="kv">
            <span className="kv-k">NAV updated</span>
            <span className="kv-v" style={vault.navIsStale ? { color: "var(--negative)" } : undefined}>
              {vault.lastNavUpdate === 0 ? "not yet" : vault.navIsStale ? "overdue — deposits paused" : `${Math.max(1, Math.round(vault.navAgeSeconds / 60))} min ago`}
            </span>
          </div>
        </div>
      )}

      {!injected() ? (
        <span className="small">Install MetaMask or Rabby to invest. Your funds stay in your own wallet until you sign.</span>
      ) : !account ? (
        <button className="btn-ink" style={{ height: 40 }} onClick={() => void connect()}>
          Connect wallet to invest →
        </button>
      ) : wrongChain ? (
        <button className="btn-ink" style={{ height: 40 }} onClick={() => void switchChain(chain).catch((e) => setMsg({ tone: "err", text: explainError(e) }))}>
          Switch wallet to {CHAINS[chain].name}
        </button>
      ) : (
        <>
          <div>
            <div className="kv">
              <span className="kv-k">Your wallet</span>
              <span className="kv-v mono">{account.slice(0, 6)}…{account.slice(-4)}</span>
            </div>
            <div className="kv">
              <span className="kv-k">{sym} balance</span>
              <span className="kv-v">{acct ? fmt(acct.usdgBalance) : "…"}</span>
            </div>
            <div className="kv">
              <span className="kv-k">Your shares</span>
              <span className="kv-v">{acct ? `${fmt(acct.shares, 4)} ≈ ${fmt(valueOfShares)} ${sym}` : "…"}</span>
            </div>
          </div>

          {req && req.state !== "None" && req.state !== "Claimed" && (
            <div className="soft stack gap-10" style={{ padding: 12, borderRadius: 6 }} data-testid="invest-request">
              <div className="row between gap-8">
                <span className="small strong">Withdrawal · {fmt(req.shares, 4)} shares</span>
                <span className={req.state === "Claimable" ? "pill pill-green" : "pill pill-accent"} data-testid="request-state">
                  {STEP_LABEL[req.state] ?? req.state}
                </span>
              </div>
              <ol className="wd-steps" aria-label="Withdrawal progress">
                {WD_STEPS.map((st, i) => {
                  const cur = WD_CURRENT[req.state] ?? 0;
                  const status = i < cur ? "done" : i === cur ? "current" : "todo";
                  const when =
                    st.key === "requested" && req.requestedAt
                      ? new Date(req.requestedAt * 1000).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                      : st.key === "settled" && req.settledAt
                        ? `${fmt(req.settledAssets)} ${sym}`
                        : null;
                  return (
                    <li key={st.key} data-status={status}>
                      <span className="wd-dot">{status === "done" ? "✓" : i + 1}</span>
                      <span className="stack" style={{ gap: 1 }}>
                        <span className="small">{st.label}</span>
                        <span className="tiny mono">
                          {st.event}
                          {when ? ` · ${when}` : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              {req.state === "Claimable" ? (
                <button
                  className="btn-ink"
                  style={{ height: 40 }}
                  disabled={!!busy}
                  data-testid="claim-btn"
                  onClick={() =>
                    void run(
                      "Claim",
                      VAULT_ADDRESS!,
                      SEL.claim,
                      (hash) =>
                        actions.recordChainTx({ kind: "withdrawal_claim", label: `Claimed ${fmt(req.settledAssets)} ${sym}`, amountUsd: Number(formatUnits(req.settledAssets, dec, 6).replace(/,/g, "")), txHash: hash, agentId }),
                      { receipt: true },
                    )
                  }
                >
                  Claim {fmt(req.settledAssets)} {sym}
                </button>
              ) : (
                <span className="tiny">
                  Not instant on purpose: the operator first closes your share of open trading positions so other investors aren&apos;t
                  affected, then settles at a fresh NAV. This usually takes a few operator cycles. Claiming always pays this wallet —
                  nobody can redirect it.
                </span>
              )}
            </div>
          )}

          <div className="row gap-8" role="tablist">
            <button className={tab === "deposit" ? "btn-ink" : "btn-out"} style={{ height: 34, flex: 1, justifyContent: "center" }} onClick={() => setTab("deposit")} role="tab" aria-selected={tab === "deposit"}>
              Deposit
            </button>
            <button className={tab === "withdraw" ? "btn-ink" : "btn-out"} style={{ height: 34, flex: 1, justifyContent: "center" }} onClick={() => setTab("withdraw")} role="tab" aria-selected={tab === "withdraw"}>
              Withdraw
            </button>
          </div>

          {tab === "deposit" ? (
            <div className="stack gap-8">
              <input className="input num" inputMode="decimal" placeholder={`Amount in ${sym}`} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Deposit amount" />
              {dep && dep.ok && vault && (
                <div className="fee-break" data-testid="fee-breakdown">
                  <div className="kv">
                    <span className="kv-k">You deposit</span>
                    <span className="kv-v">{fmt(dep.gross)} {sym}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-k">Fee · {(vault.depositFeeBps / 100).toFixed(vault.depositFeeBps % 100 ? 2 : 0)}%</span>
                    <span className="kv-v">−{fmt((dep.gross * BigInt(vault.depositFeeBps)) / 10_000n, 4)}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-k">Fee · flat</span>
                    <span className="kv-v">−{fmt(vault.raw.depositFeeFlat)}</span>
                  </div>
                  <div className="kv fee-total">
                    <span className="kv-k">Invested in the vault</span>
                    <span className="kv-v">{fmt(dep.net)} {sym}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-k">Shares at NAV {vault.navPerShare.toFixed(4)}</span>
                    <span className="kv-v">≈ {fmt(dep.sharesOut, 4)}</span>
                  </div>
                  <span className="tiny">
                    Fee {fmt(dep.fee)} · invested {fmt(dep.net)}. The fee goes to the Covar treasury; nothing else is taken on deposit.
                  </span>
                </div>
              )}
              {dep?.error && (
                <span className="tiny" role="alert" style={{ color: "var(--negative)" }}>
                  {dep.error}
                </span>
              )}
              <button
                className="btn-ink"
                style={{ height: 40 }}
                data-testid="deposit-btn"
                disabled={!!busy || !dep || !!dep.error}
                onClick={() => void depositFlow()}
              >
                {needApprove ? "Approve & deposit" : "Deposit"}
              </button>
              {needApprove && !busy && (
                <span className="tiny">Two wallet confirmations: first allow the vault to take exactly this amount of {sym}, then the deposit itself.</span>
              )}
            </div>
          ) : (
            <div className="stack gap-8">
              <div className="row gap-8">
                <input className="input num grow" inputMode="decimal" placeholder="Shares" value={shares} onChange={(e) => setShares(e.target.value)} aria-label="Shares to withdraw" />
                <button className="btn-out" style={{ height: 38 }} disabled={!acct || acct.shares === 0n} onClick={() => acct && setShares(formatUnits(acct.shares, dec, 6).replace(/,/g, ""))}>
                  Max
                </button>
              </div>
              {wd && wd.ok && !wd.error && (
                <span className="tiny">
                  ≈ {fmt(wd.gross)} at today&apos;s NAV, {fmt(wd.net)} after the withdrawal fee. The final amount uses the NAV at settlement.
                </span>
              )}
              {wd?.error && (
                <span className="tiny" role="alert" style={{ color: "var(--negative)" }}>
                  {wd.error}
                </span>
              )}
              <button
                className="btn-ink"
                style={{ height: 40 }}
                disabled={!!busy || !wd || !!wd.error}
                onClick={() =>
                  wd &&
                  wd.ok &&
                  void run(`Request withdrawal of ${fmt(wd.s, 4)} shares`, VAULT_ADDRESS!, calldata(SEL.requestWithdrawal, encUint(wd.s)), (hash) => {
                    actions.recordChainTx({ kind: "withdrawal_request", label: `Withdrawal requested · ${fmt(wd.s, 4)} shares`, amountUsd: Number(formatUnits(wd.net, dec, 6).replace(/,/g, "")), txHash: hash, agentId, note: "estimate at request; final at settlement" });
                    setShares("");
                  }, { receipt: true })
                }
              >
                Request withdrawal
              </button>
            </div>
          )}

          {auth.status !== "signed-in" && (
            <span className="tiny">Sign in with your wallet (top-right wallet menu) to keep this history across devices.</span>
          )}
        </>
      )}

      {receipt && (
        <div className="tx-receipt" data-testid="tx-receipt">
          <div className="row between gap-8">
            <span className="small strong">✓ {receipt.label} · confirmed</span>
            <button className="btn-out" style={{ height: 24, padding: "0 8px" }} onClick={() => setReceipt(null)} aria-label="Dismiss receipt">
              ×
            </button>
          </div>
          <div className="kv">
            <span className="kv-k">Your shares</span>
            <span className="kv-v">
              {fmt(receipt.shares[0], 4)} → {fmt(receipt.shares[1], 4)}{" "}
              <Delta v={receipt.shares[1] - receipt.shares[0]} f={(x) => fmt(x, 4)} />
            </span>
          </div>
          <div className="kv">
            <span className="kv-k">Wallet {sym}</span>
            <span className="kv-v">
              {fmt(receipt.usdg[0])} → {fmt(receipt.usdg[1])} <Delta v={receipt.usdg[1] - receipt.usdg[0]} f={(x) => fmt(x)} />
            </span>
          </div>
          <div className="kv">
            <span className="kv-k">Transaction</span>
            <a className="kv-v link-primary mono" href={`${explorer}/tx/${receipt.hash}`} target="_blank" rel="noreferrer" data-testid="receipt-hash">
              {receipt.hash.slice(0, 10)}…{receipt.hash.slice(-6)} ↗
            </a>
          </div>
          <span className="tiny">Block {receipt.block} · recorded in your ledger below.</span>
        </div>
      )}

      {msg && (
        <div className={msg.tone === "err" ? "notice notice-warn" : "notice notice-neutral"} role={msg.tone === "err" ? "alert" : "status"} data-testid="invest-msg">
          <div>
            {msg.text}
            {msg.hash && (
              <>
                {" "}
                <a className="link-primary" href={`${explorer}/tx/${msg.hash}`} target="_blank" rel="noreferrer">
                  View transaction
                </a>
              </>
            )}
          </div>
        </div>
      )}

      <span className="tiny mono" style={{ wordBreak: "break-all" }}>
        Vault {VAULT_ADDRESS} ·{" "}
        <a className="link-primary" href={`${explorer}/address/${VAULT_ADDRESS}`} target="_blank" rel="noreferrer">
          explorer
        </a>
      </span>
    </div>
  );
}

function Delta({ v, f }: { v: bigint; f: (x: bigint) => string }) {
  if (v === 0n) return <span className="tiny muted">(no change)</span>;
  const up = v > 0n;
  return (
    <span className="tiny" style={{ color: up ? "var(--positive)" : "var(--negative)" }}>
      ({up ? "+" : "−"}
      {f(up ? v : -v)})
    </span>
  );
}
