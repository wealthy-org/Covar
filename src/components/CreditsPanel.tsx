"use client";

/**
 * Copilot credits card (3.7). Real balance from the server ledger, top-up by
 * on-chain USDG transfer, and every debit with its token counts.
 */
import { useState } from "react";
import { CHAINS, type ChainId } from "@/lib/chain";
import { pendingTopup, topUp, useCredits, verifyTopup } from "@/lib/creditsClient";
import { signInWithEthereum, useAuth } from "@/lib/session";

const money = (n: number, d = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export default function CreditsPanel() {
  const auth = useAuth();
  const c = useCredits();
  const [amount, setAmount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cfg = c.config;
  const explorer = cfg && cfg.chainId !== 31337 ? CHAINS[cfg.chainId as ChainId]?.explorer : null;
  const pending = typeof window !== "undefined" ? pendingTopup() : null;

  const run = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setMsg({ ok: r.ok, text: r.message });
    setBusy(false);
  };

  return (
    <section className="rcard rcard-pad stack gap-12" data-testid="credits-panel">
      <div className="row between wrap gap-8">
        <h2 className="rcard-title">Copilot credits</h2>
        <span className={`pill ${cfg?.mode === "enforce" ? "pill-green" : "pill-amber"}`} title="enforce: model calls are paid from credits · off: model calls are free on this server">
          {cfg ? (cfg.mode === "enforce" ? "metered" : "free on this server") : "…"}
        </span>
      </div>

      {auth.status !== "signed-in" ? (
        <div className="stack gap-8">
          <span className="small">Credits belong to a wallet. Sign in to see your balance or top up.</span>
          <button className="btn btn-soft btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => void signInWithEthereum()} disabled={auth.status === "signing"}>
            {auth.status === "signing" ? "Check your wallet…" : "Sign in with wallet"}
          </button>
        </div>
      ) : (
        <>
          <div className="row between wrap gap-8" style={{ alignItems: "baseline" }}>
            <span className="mono-num" style={{ fontSize: 28, color: "var(--ink)" }} data-testid="credits-balance">
              {c.balanceUsd === null ? "—" : money(c.balanceUsd, 4)}
            </span>
            <span className="tiny">
              {cfg?.model ? `model: ${cfg.model}` : "no model configured: the free rules parser answers"}
            </span>
          </div>

          {cfg?.topupsEnabled ? (
            <div className="stack gap-8">
              <div className="row gap-8 wrap">
                <input
                  className="input"
                  style={{ width: 120 }}
                  inputMode="decimal"
                  aria-label="Top-up amount (USDG)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                />
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(() => topUp(amount, auth.user!.address, (t) => setMsg({ ok: true, text: t })))}>
                  {busy ? "Working…" : "Top up with USDG"}
                </button>
                {pending && !busy && (
                  <button className="btn btn-soft btn-sm" onClick={() => void run(() => verifyTopup(pending))}>
                    Verify pending top-up
                  </button>
                )}
              </div>
              <span className="tiny">
                Sends USDG from your wallet to the credits treasury {cfg.treasury?.slice(0, 6)}…{cfg.treasury?.slice(-4)} on chain {cfg.chainId}. 1 USDG = $1 of
                credits · {cfg.minTopupUsd}–{cfg.maxTopupUsd} USDG per top-up. Credited only after the server reads the transfer on-chain.
              </span>
            </div>
          ) : (
            <span className="small">Top-ups are not configured on this server yet (no credits treasury address).</span>
          )}
          {msg && (
            <span className="tiny" role="status" data-testid="credits-msg" style={{ color: msg.ok ? "var(--ink-2)" : "var(--negative)" }}>
              {msg.text}
            </span>
          )}

          {c.entries.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Entry</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {c.entries.slice(0, 12).map((e) => (
                    <tr key={e.id} data-testid="credit-entry">
                      <td className="tiny mono" style={{ whiteSpace: "nowrap" }}>
                        {new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="small">
                        {e.kind === "topup" ? (
                          <>
                            Top-up ·{" "}
                            {explorer && e.txHash ? (
                              <a className="link-primary" href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                                {e.txHash.slice(0, 10)}…
                              </a>
                            ) : (
                              <span className="mono tiny">{e.txHash?.slice(0, 10)}…</span>
                            )}
                          </>
                        ) : e.kind === "usage" ? (
                          <>
                            Copilot · {e.model} · {e.tokensIn ?? 0}+{e.tokensOut ?? 0} tokens
                            {e.basis && e.basis !== "price-table" ? <span className="tiny"> · {e.basis}</span> : null}
                          </>
                        ) : (
                          e.kind
                        )}
                      </td>
                      <td className={`right mono-num small ${e.amountUsd < 0 ? "neg" : "pos"}`}>
                        {e.amountUsd < 0 ? "−" : "+"}
                        {money(Math.abs(e.amountUsd), 4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <span className="mono-note">
        Unused credits are a liability (prepaid service), not platform revenue. Each Copilot call is charged at its real token usage
        {cfg?.pricing.inPerMTok != null ? ` ($${cfg.pricing.inPerMTok}/$${cfg.pricing.outPerMTok} per 1M in/out tokens` : " (provider-reported cost"}
        {cfg ? ` + ${cfg.pricing.appFeePct}% application fee)` : ")"}. A failed call costs nothing; stops, exits and the emergency close path never depend on credits.
      </span>
    </section>
  );
}
