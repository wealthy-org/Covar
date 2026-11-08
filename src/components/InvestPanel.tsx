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
  ClosingPositions: "Closing positions",
  Settling: "Settling",
  Claimable: "Ready to claim",
  Claimed: "Claimed",
};

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
    if (vault.depositsPaused) error = "Deposits are paused by the owner.";
    else if (vault.closeOnly) error = "The vault is in close-only mode.";
    else if (vault.navIsStale) error = "NAV is stale — the operator must report a fresh NAV before deposits reopen.";
    else if (gross < min) error = `Minimum deposit is ${fmt(min)} ${sym}.`;
    else if (v2 && gross > v2.maxDepositPerTx) error = `Per-deposit limit is ${fmt(v2.maxDepositPerTx)} ${sym}.`;
    else if (v2 && vault.raw.reportedAssets + net > v2.maxTotalAssets) error = `Only ${fmt(v2.maxTotalAssets > vault.raw.reportedAssets ? v2.maxTotalAssets - vault.raw.reportedAssets : 0n)} ${sym} of capacity left under the vault cap.`;
    else if (acct && gross > acct.usdgBalance) error = `Your wallet holds ${fmt(acct.usdgBalance)} ${sym}.`;
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
  async function run(label: string, to: string, data: string, after?: (hash: string) => void) {
    if (!account) return;
    setBusy(label);
    setMsg({ tone: "info", text: `${label}: confirm in your wallet…` });
    try {
      const hash = await sendTx({ from: account, to, data, chain });
      setMsg({ tone: "info", text: `${label}: sent, waiting for confirmation…`, hash });
      const r = await waitForReceipt(hash);
      if (!r.ok) throw new Error("The transaction reverted on-chain.");
      setMsg({ tone: "ok", text: `${label}: confirmed in block ${r.blockNumber}.`, hash });
      after?.(hash);
      await refresh();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : explainError(e) });
    } finally {
      setBusy(null);
    }
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
          <div>Could not read the vault: {readErr}</div>
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
              {vault.lastNavUpdate === 0 ? "never" : vault.navIsStale ? "stale" : `${Math.max(1, Math.round(vault.navAgeSeconds / 60))} min ago`}
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
            <div className="soft stack gap-8" style={{ padding: 12, borderRadius: 6 }} data-testid="invest-request">
              <div className="row between gap-8">
                <span className="small strong">Withdrawal · {fmt(req.shares, 4)} shares</span>
                <span className="pill pill-accent">{STEP_LABEL[req.state] ?? req.state}</span>
              </div>
              {req.state === "Claimable" ? (
                <button
                  className="btn-ink"
                  disabled={!!busy}
                  onClick={() =>
                    void run("Claim", VAULT_ADDRESS!, SEL.claim, (hash) =>
                      actions.recordChainTx({ kind: "withdrawal_claim", label: `Claimed ${fmt(req.settledAssets)} ${sym}`, amountUsd: Number(formatUnits(req.settledAssets, dec, 6).replace(/,/g, "")), txHash: hash, agentId }),
                    )
                  }
                >
                  Claim {fmt(req.settledAssets)} {sym}
                </button>
              ) : (
                <span className="tiny">
                  The operator closes your share of open positions, then settles at a fresh NAV. Claiming always pays this wallet — nobody can
                  redirect it.
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
              {dep && dep.ok && (
                <span className="tiny">
                  Fee {fmt(dep.fee)} · invested {fmt(dep.net)} · ≈ {fmt(dep.sharesOut, 4)} shares
                </span>
              )}
              {dep?.error && (
                <span className="tiny" role="alert" style={{ color: "var(--negative)" }}>
                  {dep.error}
                </span>
              )}
              {needApprove ? (
                <button
                  className="btn-ink"
                  style={{ height: 40 }}
                  disabled={!!busy || !dep || !!dep.error}
                  onClick={() => dep && dep.ok && void run(`Approve ${fmt(dep.gross)} ${sym}`, vault!.asset, calldata(SEL.approve, encAddress(VAULT_ADDRESS!), encUint(dep.gross)))}
                >
                  Step 1 of 2 · Approve {dep && dep.ok ? fmt(dep.gross) : ""} {sym}
                </button>
              ) : (
                <button
                  className="btn-ink"
                  style={{ height: 40 }}
                  disabled={!!busy || !dep || !!dep.error}
                  onClick={() =>
                    dep &&
                    dep.ok &&
                    void run(`Deposit ${fmt(dep.gross)} ${sym}`, VAULT_ADDRESS!, calldata(SEL.deposit, encUint(dep.gross)), (hash) => {
                      actions.recordChainTx({ kind: "deposit", label: `Deposited ${fmt(dep.gross)} ${sym}`, amountUsd: Number(formatUnits(dep.gross, dec, 6).replace(/,/g, "")), txHash: hash, agentId, note: `fee ${fmt(dep.fee)}` });
                      setAmount("");
                    })
                  }
                >
                  {acct && dep && dep.ok && acct.allowance >= dep.gross && dep.gross > 0n ? "Step 2 of 2 · Deposit" : "Deposit"}
                </button>
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
                  })
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
