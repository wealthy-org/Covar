"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PLATFORM_LIMITS } from "@/lib/strategy";
import { clamp, usd } from "@/lib/format";
import { VAULT_ADDRESS, readVault } from "@/lib/chain";

const CAP = PLATFORM_LIMITS.feeCapPct;
import { FeeSankey } from "@/components/FeeSankey";


function KV({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v" style={tone ? { color: tone } : undefined}>
        {v}
      </span>
    </div>
  );
}

export default function EconomicsPage() {
  const [deposit, setDeposit] = useState(1000);
  const [winningProfit, setWinningProfit] = useState(250);
  const [withdraw, setWithdraw] = useState<number | null>(null);
  const [feePct, setFeePct] = useState(10);
  const [feeTyped, setFeeTyped] = useState("10");
  const [capped, setCapped] = useState(false);
  const [onchain, setOnchain] = useState<{ depBps: number; depFlat: number; wdBps: number; wdFlat: number } | null>(null);

  // the deployed vault's own fee parameters, when a vault is configured
  useEffect(() => {
    if (!VAULT_ADDRESS) return;
    readVault(VAULT_ADDRESS)
      .then((v) => setOnchain({ depBps: v.depositFeeBps, depFlat: v.depositFeeFlat, wdBps: v.withdrawalFeeBps, wdFlat: v.withdrawalFeeFlat }))
      .catch(() => setOnchain(null));
  }, []);
  const live = onchain !== null;
  const fees = onchain ?? { depBps: PLATFORM_LIMITS.depositFeePct * 100, depFlat: PLATFORM_LIMITS.depositFeeFlat, wdBps: PLATFORM_LIMITS.depositFeePct * 100, wdFlat: PLATFORM_LIMITS.depositFeeFlat };

  const setFee = (n: number, typed?: string) => {
    const v = Number.isFinite(n) ? n : 0;
    const c = clamp(v, 0, CAP);
    setCapped(v > CAP);
    setFeePct(c);
    setFeeTyped(typed !== undefined && v <= CAP ? typed : String(c));
  };

  const fee = (amt: number, bps: number, flat: number) => (amt > 0 ? Math.min(amt, (amt * bps) / 10_000 + flat) : 0);
  const depositFee = fee(deposit, fees.depBps, fees.depFlat);
  const netIn = Math.max(0, deposit - depositFee);
  const creatorFee = winningProfit * (feePct / 100);
  const profitKept = winningProfit - creatorFee;
  const creatorShare = creatorFee * (PLATFORM_LIMITS.creatorSplitPct / 100);
  const platformShare = creatorFee * (PLATFORM_LIMITS.platformSplitPct / 100);
  const wdAmount = withdraw ?? netIn + profitKept;
  const withdrawFee = fee(wdAmount, fees.wdBps, fees.wdFlat);

  return (
    <div className="wrap-sm page-pad stack gap-24">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <span className="label-dot">Economics</span>
        <h1 className="page-title-xl">
          Where every fee <span style={{ color: "var(--primary)" }}>goes.</span>
        </h1>
        <p className="page-sub">
          A deposit and withdrawal fee charged by the vault contract, a creator-selected fee on winning-trade profit, and an
          80/20 creator/platform split. Every fee actually received is listed on the Treasury page.
        </p>
        <Link href="/treasury" className="accent-link" style={{ marginTop: 6 }}>
          See the accounting: Treasury →
        </Link>
      </div>

      <section className="rcard rcard-pad stack gap-16">
        <div className="row between gap-12 wrap">
          <h2 className="rcard-title">Fee flows</h2>
          <span className="tagbox">band width = share of each fee</span>
        </div>
        <FeeSankey />
      </section>

      <div className="joined-stats" data-cols="3">
        <div>
          <span className="stat-label">Deposit / withdrawal fee</span>
          <span className="js-v">1% + 0.10</span>
          <span className="tiny">USDG · on money in and out, not on profit. Charged by the vault contract.</span>
        </div>
        <div>
          <span className="stat-label">Creator fee ceiling</span>
          <span className="js-v">20%</span>
          <span className="tiny">of each winning trade, creator-selected per agent. Losing trades are not netted.</span>
        </div>
        <div>
          <span className="stat-label">Creator / platform split</span>
          <span className="js-v">80 / 20</span>
          <span className="tiny">of the realised creator fee, allocated at settlement and recorded per trade.</span>
        </div>
      </div>

      <div className="econ-grid">
        <section className="rcard rcard-pad stack gap-16" data-testid="fee-calculator">
          <div className="row between gap-8 wrap">
            <h2 className="rcard-title">Fee calculator</h2>
            <span className={live ? "pill pill-green" : "tagbox"} data-testid="fee-source" title={live ? `Read from vault ${VAULT_ADDRESS}` : undefined}>
              {live ? "fees read from the deployed vault" : "simulation · platform defaults"}
            </span>
          </div>

          <div className="grid-3" style={{ gap: 12 }}>
            <label className="field">
              <span className="label">Deposit (USDG)</span>
              <input className="input" type="number" data-testid="calc-deposit" value={deposit} min={0} onChange={(e) => setDeposit(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <label className="field">
              <span className="label">Winning-trade profit</span>
              <input className="input" type="number" data-testid="calc-profit" value={winningProfit} min={0} onChange={(e) => setWinningProfit(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <label className="field">
              <span className="label">Withdraw later (USDG)</span>
              <input
                className="input"
                type="number"
                data-testid="calc-withdraw"
                value={withdraw ?? ""}
                placeholder={(netIn + profitKept).toFixed(2)}
                min={0}
                onChange={(e) => setWithdraw(e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>

          <div className="field">
            <div className="row between">
              <span className="label">Creator fee on winning trades</span>
              <span className="mono-num strong" style={{ color: "var(--ink)" }} data-testid="calc-fee-pct">
                {feePct}%
              </span>
            </div>
            <input
              className="fee-range"
              type="range"
              min={0}
              max={CAP}
              step={0.5}
              value={feePct}
              aria-label="Creator fee percent"
              data-testid="calc-fee-range"
              onChange={(e) => setFee(Number(e.target.value))}
            />
            <div className="row between wrap gap-8">
              <div className="fee-presets">
                {[0, 5, 10, 15, 20].map((f) => (
                  <button key={f} type="button" className="chip" data-active={feePct === f} onClick={() => setFee(f)}>
                    {f}%
                  </button>
                ))}
                <input
                  className="input"
                  style={{ width: 78, height: 30 }}
                  type="number"
                  aria-label="Creator fee percent (type)"
                  data-testid="calc-fee-input"
                  value={feeTyped}
                  onChange={(e) => setFee(Number(e.target.value), e.target.value)}
                />
              </div>
              <span className={`tiny${capped ? " neg" : ""}`} data-testid="calc-cap-msg">
                {capped ? `Capped at ${CAP}% — the platform refuses anything higher` : `max ${CAP}% · enforced when an agent is published`}
              </span>
            </div>
          </div>

          <div>
            <span className="stat-label">Money in</span>
            <KV k={`Deposit fee (${fees.depBps / 100}% + ${fees.depFlat.toFixed(2)})`} v={<span data-testid="calc-deposit-fee">{usd(depositFee)}</span>} />
            <KV k="Net capital into the vault" v={usd(netIn)} />
            <span className="stat-label" style={{ display: "block", marginTop: 12 }}>
              Winning trade
            </span>
            <KV k={`Creator fee (${feePct}% of ${usd(winningProfit)})`} v={<span data-testid="calc-creator-fee">{usd(creatorFee)}</span>} />
            <KV k="Trader keeps" v={usd(profitKept)} tone="var(--positive)" />
            <span className="stat-label" style={{ display: "block", marginTop: 12 }}>
              Money out
            </span>
            <KV k={`Withdrawal fee (${fees.wdBps / 100}% + ${fees.wdFlat.toFixed(2)})`} v={<span data-testid="calc-withdraw-fee">{usd(withdrawFee)}</span>} />
            <KV k={`You receive (on ${usd(wdAmount)})`} v={usd(Math.max(0, wdAmount - withdrawFee))} tone="var(--ink)" />
          </div>

          <div className="stack gap-8" data-testid="calc-split">
            <div className="row between wrap gap-8">
              <span className="stat-label">Creator fee split · {PLATFORM_LIMITS.creatorSplitPct}/{PLATFORM_LIMITS.platformSplitPct}</span>
              <span className="tiny mono-num">{usd(creatorFee)} total</span>
            </div>
            <div className="split-bar" style={{ height: 14 }}>
              <span style={{ width: `${PLATFORM_LIMITS.creatorSplitPct}%`, background: "#3B5BDB" }} />
              <span style={{ width: `${PLATFORM_LIMITS.platformSplitPct}%`, background: "#10141F" }} />
            </div>
            <div className="row between wrap gap-8">
              <span className="small">
                <span className="legend-sq" style={{ background: "#3B5BDB" }} /> Creator {PLATFORM_LIMITS.creatorSplitPct}% ·{" "}
                <b className="mono-num" data-testid="calc-creator-share">{usd(creatorShare)}</b>
              </span>
              <span className="small">
                <span className="legend-sq" style={{ background: "#10141F" }} /> Platform {PLATFORM_LIMITS.platformSplitPct}% ·{" "}
                <b className="mono-num" data-testid="calc-platform-share">{usd(platformShare)}</b>
              </span>
            </div>
          </div>

          <div className="joined-stats" style={{ ["--cols" as string]: 3 }}>
            <div>
              <span className="stat-label">Investor pays</span>
              <span className="js-v" style={{ fontSize: 19 }}>{usd(depositFee + withdrawFee + creatorFee)}</span>
            </div>
            <div>
              <span className="stat-label">Creator earns</span>
              <span className="js-v" style={{ fontSize: 19 }}>{usd(creatorShare)}</span>
            </div>
            <div>
              <span className="stat-label">Platform revenue</span>
              <span className="js-v" style={{ fontSize: 19, color: "var(--primary)" }} data-testid="calc-platform-total">
                {usd(depositFee + withdrawFee + platformShare)}
              </span>
            </div>
          </div>

          <span className="mono-note">
            Deposit and withdrawal fees are charged by the vault contract on the transfer itself and go straight to the fee
            recipient — every one is listed on the Treasury page. Creator-fee figures are an estimate of what a winning trade would pay.
          </span>
        </section>

        <div className="stack gap-16">
          <section className="rcard rcard-pad stack gap-10">
            <h2 className="rcard-title">AI / Copilot costs</h2>
            <p className="small" style={{ margin: 0 }}>
              Copilot usage incurs provider/model cost plus an application fee. Credits are reserved before a call and
              reconciled to actual usage; unused credits stay a liability of the platform, not revenue.
            </p>
            <div className="row between gap-8">
              <span className="tiny">Credits are not a licence to skip risk checks</span>
              <span className="pill pill-green">enforced</span>
            </div>
          </section>

          <section className="rcard rcard-pad stack gap-10">
            <span className="label-dot">What is a liability</span>
            <ul className="stack gap-6" style={{ paddingLeft: 16, margin: 0 }}>
              {["Investor deposits and trading collateral", "Escrowed withdrawal amounts awaiting claim", "Unused Copilot credits"].map((t) => (
                <li key={t} className="small">
                  {t}
                </li>
              ))}
            </ul>
            <div className="rcard-sep" style={{ margin: "6px 0" }} />
            <span className="label-dot">What is revenue</span>
            <ul className="stack gap-6" style={{ paddingLeft: 16, margin: 0 }}>
              {["Deposit/withdrawal fees", "Platform share of creator fees", "Application fee on AI usage"].map((t) => (
                <li key={t} className="small">
                  {t}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <p className="mono-note" style={{ maxWidth: 860 }}>
        The fee flows show the rules, not volumes. Nothing on this page moves money.
      </p>
    </div>
  );
}
