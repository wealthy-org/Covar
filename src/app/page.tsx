"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { AgentCard } from "@/components/AgentCard";
import { useCovar } from "@/lib/store";
import { pctSigned, usd } from "@/lib/format";

/**
 * Landing built to the reference's information architecture:
 * hero + assistant card → built-on strip → how it works (build / follow) →
 * why (rules → copilot → risk chain, four proof cards, market strip) →
 * infra section → FAQ (two columns) → closing CTA.
 *
 * Content is ours, and every number is labelled with its provenance.
 */

const FAQ = [
  {
    q: "Is it live?",
    a: "The Studio is in beta: you can build, test and practice an agent today. Nothing on this build moves real money — contracts are compiled and tested but not deployed, and the execution plane runs against a paper venue. Every screen says which kind of money it is showing.",
  },
  {
    q: "What does it cost?",
    a: "Browsing and backtests are free. AI creation and chat edits spend Copilot credits, and the creation screen shows your balance before you start. Fees on funded vaults are the reference's: 1% + 0.10 USDG on deposits and withdrawals, and up to 20% of the profit on winning trades, split 80/20 creator:platform.",
  },
  {
    q: "Who holds the keys?",
    a: "Only the signer service. A vault's key can trade, and it refuses any request that carries a withdrawal destination — payouts go back to the investor. The creator never holds a trading key, and the Copilot cannot sign anything.",
  },
  {
    q: "Can it lose money?",
    a: "Yes. Perps are risky and a backtested strategy can still lose. Hard limits cap how much and how fast — 5× leverage, a 40% equity notional cap, a 10% daily-loss pause and an emergency stop at −25% drawdown — but they are triggers, not a promise about maximum loss during a gap.",
  },
  {
    q: "What is actually different from the reference?",
    a: "Name and colour, and what we refuse to fake: losers stay public on creator pages, backtests never rank as live returns, and unimplemented features (token, staking, live venue) are labelled instead of mocked up. The parity register lists every intentional deviation.",
  },
];

const STEPS = [
  ["Describe", "Plain words, no code", "01"],
  ["Test", "Real history, real costs", "02"],
  ["Practice", "Simulated ticks, pretend money", "03"],
];

const PROOF = [
  ["The AI has to prove it helps", "Every practice and live agent runs a rules-only twin side by side, so you can see whether the AI actually adds return."],
  ["It reads the market like you do", "Before a trade, the Copilot can check the context your rules allow, then take it, skip it or size it down."],
  ["Backtests that match reality", "Spread, slippage and funding are charged per fill and shown with every run. Same strategy, same seed, same result."],
  ["Nobody can run off with the keys", "Trading keys live in the signer service, not with the model, the creator or the browser — and it cannot withdraw."],
];

const MARKETS = ["BTC", "ETH", "SOL", "HYPE", "USDG"];

export default function LandingPage() {
  const { agents } = useCovar();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const sample = agents.find((a) => a.id === "ag-01") ?? agents[0];
  const featured = agents.slice(0, 3);

  return (
    <div>
      {/* ---------------------------------- hero ---------------------------------- */}
      <section className="hero">
        <div className="container hero-grid">
          <div className="stack gap-20">
            <span className="eyebrow">Strategy agents · Robinhood Chain</span>

            <h1 className="h1">
              Trading agents.
              <br />
              <span className="primary-text">Rules you can read.</span>
            </h1>

            <p className="lead" style={{ maxWidth: 480 }}>
              Type your idea. Covar turns it into a typed rule set, backtests it with real costs, runs it in practice, and
              publishes the record — rules, decisions and versions all in public.
            </p>

            <div className="hero-cta-row">
              <Link href="/explore" className="btn btn-primary btn-lg">
                Open the app →
              </Link>
              <Link href="/studio?new=1" className="btn btn-secondary btn-lg">
                Start building
              </Link>
            </div>

            <div className="row gap-16 wrap" style={{ marginTop: 4 }}>
              {[
                ["Rules published", "every entry, exit and cap"],
                ["Versions recorded", "with activation time"],
                ["Vaults on-chain", "our own contracts, testnet first"],
              ].map(([k, v]) => (
                <div key={k} className="stack" style={{ gap: 0 }}>
                  <span className="tiny strong" style={{ color: "var(--foreground)" }}>
                    {k}
                  </span>
                  <span className="tiny">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* assistant card — the reference's hero element */}
          <div className="chat-card">
            <div className="chat-head">
              <span>Assistant</span>
              <span>Example</span>
            </div>
            <div className="chat-body">
              <div className="bubble-user">Long SOL breakouts on the 1h. Stop 1.5× ATR, only take 2R or better</div>

              <div className="row gap-8">
                <span className="icon-dot" style={{ width: 22, height: 22, fontSize: 10 }}>
                  C
                </span>
                <span className="small strong">Built it. Here&apos;s the setup:</span>
              </div>

              <div className="stack gap-8">
                {[
                  ["Entry", "1h close above the 20-bar high"],
                  ["Stop", "1.5× ATR(14) below entry"],
                  ["Target", "2R · reward:risk ≥ 2:1"],
                  ["Risk", "1% a trade · leverage ≤ 3×"],
                ].map(([k, v]) => (
                  <div key={k} className="chat-row">
                    <span className="chat-key">{k}</span>
                    <span className="chat-val">{v}</span>
                  </div>
                ))}
              </div>

              <div className="row between wrap gap-8" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <span className="tiny mono">Replayed a year of SOL · 4.5 bps taker, 3 bps slippage, funding</span>
                <Link href="/studio?new=1" className="btn btn-primary btn-sm">
                  Run it →
                </Link>
              </div>
            </div>
            <div className="chat-input">
              <span>Describe a change…</span>
              <span className="chat-send">↑</span>
            </div>
          </div>
        </div>
      </section>

      <div className="container">
        <div className="built-strip">
          <span>Built on</span>
          <span className="badge badge-outline">Robinhood Chain</span>
          <span className="badge badge-outline">Lighter perps</span>
          <span className="spacer" />
          <span>Testnet 46630 · no real value at risk</span>
        </div>
      </div>

      {/* ------------------------------- how it works ------------------------------ */}
      <section className="band section">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2 className="h2" style={{ maxWidth: 720 }}>
              Build your own agent, <span className="primary-text">or fund a proven one.</span>
            </h2>
          </div>

          <div className="grid-2">
            <div className="card card-pad stack gap-16">
              <div className="row between">
                <h3 className="h3">Build</h3>
                <span className="badge badge-blue">Beta</span>
              </div>
              <p className="body" style={{ marginTop: -8 }}>
                For traders with an idea.
              </p>

              <div className="grid-3" style={{ gap: 12 }}>
                {STEPS.map(([title, sub, n]) => (
                  <div key={title} className="step-card">
                    <div className="step-art">{n}</div>
                    <span className="small strong" style={{ color: "var(--foreground)", marginTop: 6 }}>
                      {title}
                    </span>
                    <span className="tiny">{sub}</span>
                  </div>
                ))}
              </div>

              <Link href="/studio?new=1" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
                Start building →
              </Link>
            </div>

            <div className="card card-pad stack gap-16">
              <div className="row between">
                <h3 className="h3">Follow</h3>
                <span className="badge badge-outline">Testnet</span>
              </div>
              <p className="body" style={{ marginTop: -8 }}>
                For everyone else. Deposit USDG into an agent&apos;s vault.
              </p>

              <div className="stack gap-10">
                {[
                  "Each agent gets its own on-chain vault, not a shared pool",
                  "The creator never holds the trading key",
                  "Withdraw anytime: your share of the positions is closed and the money follows",
                ].map((t) => (
                  <div key={t} className="row gap-10" style={{ alignItems: "flex-start" }}>
                    <span className="icon-dot" style={{ width: 22, height: 22, fontSize: 10 }}>
                      ✓
                    </span>
                    <span className="small" style={{ color: "var(--foreground)" }}>
                      {t}
                    </span>
                  </div>
                ))}
              </div>

              <p className="tiny" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                The creator earns a share of each winning trade; Covar takes 1% and a flat 0.10 USDG on deposits and
                withdrawals.
              </p>

              <Link href="/explore" className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
                Browse agents →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------- why ---------------------------------- */}
      <section className="section">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Why Covar</span>
            <h2 className="h2" style={{ maxWidth: 780 }}>
              Other bots show you a backtest. <span className="primary-text">Covar shows you the proof.</span>
            </h2>
          </div>

          <div className="chain-diagram">
            {[
              ["Rules", "find the setup", "◎"],
              ["Copilot", "handles the trade", "◈"],
              ["Risk engine", "has the last word", "⬡"],
            ].map(([title, sub, icon], i) => (
              <Fragment key={title}>
                <div className="panel chain-node" data-last={i === 2 || undefined}>
                  <span className="icon-dot">{icon}</span>
                  <div className="stack" style={{ gap: 2 }}>
                    <span className="small strong" style={{ color: "var(--foreground)" }}>
                      {title}
                    </span>
                    <span className="tiny">{sub}</span>
                  </div>
                </div>
                {i < 2 && (
                  <div className="chain-arrow" aria-hidden>
                    →
                  </div>
                )}
              </Fragment>
            ))}
          </div>

          <p className="tiny mono" style={{ marginTop: 12, maxWidth: 620, lineHeight: 1.7 }}>
            The AI picks only from options your strategy defines. If it errors, the agent trades its plain rules. Limits
            sit outside both.
          </p>

          <div className="grid-4" style={{ marginTop: 22 }}>
            {PROOF.map(([title, body]) => (
              <div key={title} className="card card-pad stack gap-8">
                <span className="icon-dot" style={{ width: 26, height: 26, fontSize: 11 }}>
                  ◆
                </span>
                <span className="small strong" style={{ color: "var(--foreground)", marginTop: 4 }}>
                  {title}
                </span>
                <span className="tiny" style={{ lineHeight: 1.65 }}>
                  {body}
                </span>
              </div>
            ))}
          </div>

          <div className="row gap-8 wrap" style={{ marginTop: 20 }}>
            <span className="upper" style={{ color: "var(--muted-2)" }}>
              Markets planned for the first testnet release
            </span>
            {MARKETS.map((m) => (
              <span key={m} className="market-chip">
                {m}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------- infrastructure ------------------------------ */}
      <section className="band-raised section">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">Built on Robinhood Chain</span>
            <h2 className="h2" style={{ maxWidth: 760 }}>
              The rules and the money stay separate. <span className="primary-text">Always.</span>
            </h2>
          </div>

          <div className="grid-3">
            {[
              ["Vaults are contracts, not promises", "One vault per agent, NAV-guarded share minting, and a four-step withdrawal: request → close positions → settle → claim."],
              ["The signer cannot withdraw", "Order intents cross four processes — execution, risk, signer, venue — and each keeps its own append-only journal."],
              ["Every record says where it came from", "Backtest, practice, test exchange, real money and vault price are separate ledgers with separate labels. They never merge."],
            ].map(([title, body]) => (
              <div key={title} className="card card-pad stack gap-8">
                <span className="small strong" style={{ color: "var(--foreground)" }}>
                  {title}
                </span>
                <span className="tiny" style={{ lineHeight: 1.65 }}>
                  {body}
                </span>
              </div>
            ))}
          </div>

          <div className="row gap-10 wrap" style={{ marginTop: 18 }}>
            <Link href="/execution" className="btn btn-secondary">
              See the order path
            </Link>
            <Link href="/docs#execution" className="btn btn-ghost">
              How execution works →
            </Link>
          </div>
        </div>
      </section>

      {/* -------------------------------- featured -------------------------------- */}
      <section className="section">
        <div className="container">
          <div className="row between wrap gap-12" style={{ marginBottom: 18 }}>
            <div className="section-head" style={{ marginBottom: 0 }}>
              <span className="eyebrow">Discover</span>
              <h2 className="h2">Agents with a public record</h2>
            </div>
            <Link href="/explore" className="btn btn-secondary">
              All agents →
            </Link>
          </div>

          <div className="grid-3">
            {featured.map((a) => (
              <AgentCard key={a.id} agent={a} />
            ))}
          </div>

          {sample && (
            <p className="tiny mono" style={{ marginTop: 14 }}>
              Demo index data · vault TVL {usd(sample.vault?.tvlUsd ?? 0)} · net return{" "}
              {pctSigned(sample.returnPct)} over {sample.liveAgeDays} live days. Seeded sample, not a track record.
            </p>
          )}
        </div>
      </section>

      {/* ----------------------------------- faq ---------------------------------- */}
      <section className="band section">
        <div className="container">
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.8fr) minmax(0, 1.2fr)", gap: 40, alignItems: "start" }}>
            <div className="section-head" style={{ marginBottom: 0 }}>
              <span className="eyebrow">FAQ</span>
              <h2 className="h2">Quick answers</h2>
            </div>

            <div className="stack gap-8">
              {FAQ.map((f, i) => (
                <div key={f.q} className="faq-item">
                  <button className="faq-q" aria-expanded={openFaq === i} onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                    {f.q}
                    <span style={{ color: "var(--muted-2)" }}>{openFaq === i ? "−" : "+"}</span>
                  </button>
                  {openFaq === i && <div className="faq-a">{f.a}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------- cta ---------------------------------- */}
      <section className="cta-band section">
        <div className="container">
          <div className="row between wrap gap-24">
            <div className="stack gap-10" style={{ maxWidth: 560 }}>
              <h2 className="h2">Your first agent starts with one sentence.</h2>
              <p className="lead">Build and test. No code needed. Nothing is investable until a version is published.</p>
            </div>
            <div className="row gap-10 wrap">
              <Link href="/explore" className="btn btn-primary btn-lg">
                Open the app →
              </Link>
              <Link href="/docs" className="btn btn-lg" style={{ border: "1px solid rgba(255,255,255,0.24)", color: "#fff" }}>
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
