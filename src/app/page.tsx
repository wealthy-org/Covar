"use client";

import Image from "next/image";
import Link from "next/link";
import { Fragment, useState } from "react";
import { IS_MAINNET } from "@/lib/chain";
import { Icon, type IconName } from "@/components/Icon";

/**
 * Landing:
 *
 *   announce strip → transparent nav → textured hero with floating candles and
 *   the assistant card → "built for" footnote → How it works (Build / Follow) →
 *   Why (rules → copilot → risk chain, four proof cards, market chips) →
 *   AI layer (three cards) → FAQ (two columns) → centred closing CTA.
 *
 * Palette: Covar cobalt. Every sentence must stay true of the deployed product.
 */

/* ------------------------------------------------------------------ icons */


/* ---------------------------------------------------------------- content */

const SETUP: [string, string][] = [
  ["Entry", "1h close above the 20-bar high"],
  ["Stop", "1.5× ATR(14) below entry"],
  ["Target", "2R · reward:risk ≥ 2:1"],
  ["Risk", "1% a trade · leverage ≤ 3×"],
];

const STEPS = [
  { n: 1, title: "Describe", sub: "Plain words, no code", img: "/landing/step-describe.png", w: 96, h: 95 },
  { n: 2, title: "Test", sub: "Real history, explicit costs", img: "/landing/step-test.png", w: 52, h: 96 },
  { n: 3, title: "Practice", sub: "Pretend money, clearly labelled", img: "/landing/step-practice.png", w: 81, h: 96 },
];

const FOLLOW: [IconName, string][] = [
  ["lock", "Each agent gets its own on-chain vault, not a shared pool"],
  ["key", "The creator never holds the trading key"],
  ["undo", "Withdraw anytime: your share of the positions is closed and the money follows"],
];

const CHAIN: [IconName, string, string][] = [
  ["target", "Rules", "find the setup"],
  ["bot", "Copilot", "handles the trade"],
  ["shield", "Risk engine", "has the last word"],
];

const PROOF: [IconName, string, string][] = [
  ["scale", "The AI has to prove it helps", "Every agent runs a rules-only twin side by side, so you can see whether the AI actually adds return."],
  ["news", "It reads the setup like you do", "Before a trade, the Copilot weighs what your rules found, then takes it, skips it or sizes it down — never past your caps."],
  ["db", "Backtests that show their costs", "Spread, slippage and funding are charged on every fill and printed with every run. Same strategy, same data, same result."],
  ["key", "Nobody can run off with the keys", "Trading keys live only in Covar's signer. Not with the AI, not with the creator, not in the browser."],
];

const MARKETS = ["BTC", "ETH", "SOL", "HYPE", "USDG"];

const AI_LAYER: [IconName, string, string][] = [
  ["coins", "Credits run your agents", "Chat edits and Copilot decisions spend Copilot credits. The creation screen shows your balance before you start."],
  ["layers", "The model proposes, the engine decides", "The AI suggests an interpretation; the rule engine encodes, validates and clamps it. It never writes code or orders."],
  ["fallback", "Out of credits? It trades its plain rules", "No key, a provider error or an empty balance drops the agent to its rules — and every draft says which engine wrote it."],
];

const FAQ = [
  {
    q: "Is it live?",
    a: IS_MAINNET
      ? "Yes. The Covar vault runs on Robinhood Chain with real USDG, starting with small deposit limits while it builds a track record. Building, backtesting and practice are free. Every screen says which kind of money it is showing: real, practice or a backtest."
      : "This site runs on the Robinhood Chain test network: tokens have no value. Build, backtest and practice agents freely; the vault flow works end to end with test USDG.",
  },
  {
    q: "What does it cost?",
    a: "Browsing, backtests and practice are free. AI creation and chat edits spend Copilot credits; the creation screen shows your balance first. Funded vaults charge 1% + 0.10 USDG on deposits and withdrawals, and the creator takes up to 20% of the profit on each winning trade (split 80/20 with Covar).",
  },
  {
    q: "Who holds the keys?",
    a: "Only Covar's signer. A vault's key can trade but can't withdraw anywhere except back to the vault — the signer refuses any request that carries a withdrawal destination.",
  },
  {
    q: "Can it lose money?",
    a: "Yes. Perps are risky and a tested strategy can still lose. Hard limits cap how much and how fast (5× leverage, a daily pause at −10%, an emergency stop at −25%), but they are triggers — nothing promises profit.",
  },
];

/* ------------------------------------------------------------- CA pill */

const CA = "0x47bd55ed17c20b11742e4252f4660a8338b50f09";

function CaPill() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CA);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <button type="button" className="lp-ca" onClick={copy} aria-label="Copy contract address">
      <span className="lp-ca-k">CA</span>
      <span className="lp-ca-v">{CA}</span>
      <span className="lp-ca-copy">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/* ------------------------------------------------------------------- page */

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="lp">
      {/* ================================ hero ================================ */}
      <section className="lp-hero">
        <div className="lp-hero-bg" aria-hidden />
        <Image src="/landing/candles.png" alt="" width={240} height={560} className="lp-candles lp-candles-left" priority />
        <Image src="/landing/candles.png" alt="" width={240} height={560} className="lp-candles lp-candles-right" priority />

        <div className="lp-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <h1 className="lp-h1">
              Trading Agents.
              <br />
              <span className="lp-accent">Simplified.</span>
            </h1>
            <p className="lp-lead">
              Type your trade idea. Covar builds the agent, backtests it, and runs it in practice before a cent is at stake.
            </p>
            <Link href="/explore" className="lp-btn">
              Open the app <span aria-hidden>⟶</span>
            </Link>
            <CaPill />
          </div>

          {/* assistant card */}
          <div className="lp-chat" aria-label="Example assistant conversation">
            <div className="lp-chat-head">
              <span className="lp-chat-title">
                <span className="lp-dot" />
                Assistant
              </span>
              <span className="lp-tag">Example</span>
            </div>

            <div className="lp-chat-body">
              <div className="lp-msg lp-user" style={{ animationDelay: "60ms" }}>
                Long SOL breakouts on the 1h. Stop 1.5× ATR, only take 2R or better
              </div>

              <div className="lp-msg lp-bot" style={{ animationDelay: "380ms" }}>
                <span className="lp-avatar"><Image src="/logo.png" alt="" width={11} height={12} /></span>
                <div className="lp-bot-main">
                  <span>Built it. Here&apos;s the setup:</span>
                  <div className="lp-setup">
                    {SETUP.map(([k, v]) => (
                      <div key={k} className="lp-setup-row">
                        <span className="lp-setup-k">{k}</span>
                        <span className="lp-setup-v">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="lp-msg lp-user" style={{ animationDelay: "720ms" }}>
                Test it on a year of SOL
              </div>

              <div className="lp-msg lp-bot" style={{ animationDelay: "1040ms" }}>
                <span className="lp-avatar"><Image src="/logo.png" alt="" width={11} height={12} /></span>
                <div className="lp-bot-main">
                  <span className="lp-replayed">
                    <span className="lp-accent"><Icon name="check" size={13} /></span>
                    Replayed a year of SOL, costs included.
                  </span>
                  <div className="lp-next">
                    <span>
                      <span className="lp-muted">Next ·</span> Practice <span className="lp-muted">· pretend money</span>
                    </span>
                    <Link href="/studio?new=1" className="lp-run">
                      Run it <span aria-hidden>⟶</span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <Link href="/studio?new=1" className="lp-chat-input">
              <span>Describe a change…</span>
              <span className="lp-send"><Icon name="arrow-up" size={12} /></span>
            </Link>
          </div>
        </div>

        <div className="lp-built">
          <span>Built for</span>
          <span className="lp-built-mark">
            <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden>
              <path d="M1 11V1h2.2v8H10v2H1z" fill="currentColor" />
            </svg>
            Robinhood Chain
          </span>
        </div>
      </section>

      {/* ============================ how it works ============================ */}
      <section className="lp-section">
        <div className="lp-wrap">
          <span className="lp-eyebrow">How it works</span>
          <h2 className="lp-h2">
            Build your own agent, <span className="lp-accent">or follow a proven one.</span>
          </h2>

          <div className="lp-how">
            <div className="lp-card lp-card-build">
              <div className="lp-card-top">
                <div>
                  <h3 className="lp-h3">Build</h3>
                  <p className="lp-card-sub">For traders with an idea.</p>
                </div>
                <span className="lp-tag lp-tag-accent">Beta</span>
              </div>

              <ol className="lp-steps">
                {STEPS.map((s) => (
                  <li key={s.n} className="lp-step">
                    <div className="lp-step-art">
                      <Image src={s.img} alt="" width={s.w} height={s.h} />
                    </div>
                    <span className="lp-step-title">
                      <span className="lp-muted-strong">{s.n}.</span> {s.title}
                    </span>
                    <span className="lp-step-sub">{s.sub}</span>
                  </li>
                ))}
              </ol>

              <Link href="/studio?new=1" className="lp-btn lp-btn-sm">
                Start building <span aria-hidden>⟶</span>
              </Link>
            </div>

            <div className="lp-card lp-card-follow">
              <div className="lp-card-top">
                <div>
                  <h3 className="lp-h3">Follow</h3>
                  <p className="lp-card-sub">For everyone else. Deposit USDG into a proven agent&apos;s vault.</p>
                </div>
                <span className="lp-tag">Soon</span>
              </div>

              <div className="lp-follow">
                <Image src="/landing/step-vault.png" alt="" width={76} height={80} className="lp-follow-art" />
                <ul className="lp-follow-list">
                  {FOLLOW.map(([icon, text]) => (
                    <li key={text}>
                      <span className="lp-accent lp-follow-ico"><Icon name={icon} size={15} /></span>
                      {text}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="lp-mono-note">
                The creator earns a share of each winning trade; Covar takes 1% and a flat 0.10 USDG on deposits and
                withdrawals.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ================================= why ================================ */}
      <section className="lp-section">
        <div className="lp-wrap">
          <span className="lp-eyebrow">Why Covar</span>
          <h2 className="lp-h2">
            Other bots show you a backtest. <span className="lp-accent">Covar shows you the proof.</span>
          </h2>

          <div className="lp-chain">
            {CHAIN.map(([icon, title, sub], i) => (
              <Fragment key={title}>
                <div className="lp-chain-node" data-last={i === CHAIN.length - 1 || undefined}>
                  <span className="lp-ico"><Icon name={icon} /></span>
                  <div>
                    <div className="lp-chain-title">{title}</div>
                    <div className="lp-chain-sub">{sub}</div>
                  </div>
                </div>
                {i < CHAIN.length - 1 && <span className="lp-chain-arrow" aria-hidden>→</span>}
              </Fragment>
            ))}
          </div>

          <p className="lp-mono-note lp-chain-note">
            The AI picks only from options your strategy defines. If it errors, the agent trades its plain rules. Limits
            sit outside both.
          </p>

          <div className="lp-grid-4">
            {PROOF.map(([icon, title, body]) => (
              <div key={title} className="lp-card lp-feature">
                <span className="lp-ico"><Icon name={icon} /></span>
                <h4 className="lp-feature-title">{title}</h4>
                <p className="lp-feature-body">{body}</p>
              </div>
            ))}
          </div>

          <div className="lp-markets">
            <span className="lp-markets-label">Risk-engine allowlist · perps</span>
            {MARKETS.map((m) => (
              <span key={m} className="lp-chip">{m}</span>
            ))}
          </div>
        </div>
      </section>

      {/* =============================== AI layer ============================= */}
      <section className="lp-section">
        <div className="lp-wrap">
          <span className="lp-eyebrow">AI layer</span>
          <h2 className="lp-h2">
            The AI powers the brain. <span className="lp-accent">Your money stays with you.</span>
          </h2>
          <p className="lp-section-lead">
            Covar uses a model provider for language only. Trading funds, keys and vault assets never touch it.
          </p>

          <div className="lp-grid-3">
            {AI_LAYER.map(([icon, title, body]) => (
              <div key={title} className="lp-card lp-feature">
                <span className="lp-ico"><Icon name={icon} /></span>
                <h4 className="lp-feature-title">{title}</h4>
                <p className="lp-feature-body">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================================= FAQ ================================ */}
      <section className="lp-section">
        <div className="lp-wrap lp-faq">
          <div>
            <span className="lp-eyebrow">FAQ</span>
            <h2 className="lp-h2">Quick answers</h2>
          </div>

          <div className="lp-faq-list">
            {FAQ.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={f.q} className="lp-faq-item" data-open={open || undefined}>
                  <button
                    className="lp-faq-q"
                    aria-expanded={open}
                    aria-controls={`faq-${i}`}
                    onClick={() => setOpenFaq(open ? null : i)}
                  >
                    {f.q}
                    <span className="lp-faq-plus" aria-hidden>+</span>
                  </button>
                  <div id={`faq-${i}`} className="lp-faq-a" role="region" hidden={!open}>
                    {f.a}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================================= CTA ================================ */}
      <section className="lp-section lp-cta">
        <div className="lp-wrap">
          <Image src="/landing/candles.png" alt="" width={48} height={112} className="lp-cta-art" />
          <h2 className="lp-h2 lp-cta-title">
            Your first agent starts <span className="lp-accent">with one sentence.</span>
          </h2>
          <p className="lp-cta-sub">Build and test. No code needed.</p>
          <Link href="/explore" className="lp-btn">
            Open the app <span aria-hidden>⟶</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
