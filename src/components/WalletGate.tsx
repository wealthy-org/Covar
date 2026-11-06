"use client";

import Link from "next/link";
import { useState } from "react";
import { actions, useCovar } from "@/lib/store";
import { PROVIDER_CHOICES, getWalletProvider } from "@/lib/wallet";

/**
 * The reference gates the working screens behind a connected wallet and shows a
 * single centred card. Same pattern here — with one honest difference: this build
 * has no Privy and no keys, so the "wallet" is a session stand-in and the card says so.
 */
export function WalletGate({
  title = "Welcome to Covar",
  blurb = "Build a strategy in plain English, test it on real history, then let it prove itself in practice.",
  bullets = [
    "Connect your wallet (Robinhood Chain)",
    "Deposits and withdrawals stay in your wallet",
    "You only pay for AI when you use it",
  ],
  children,
}: {
  title?: string;
  blurb?: string;
  bullets?: string[];
  children: React.ReactNode;
}) {
  const { walletConnected } = useCovar();
  const [err, setErr] = useState<string | null>(null);
  const provider = getWalletProvider();
  if (walletConnected) return <>{children}</>;

  return (
    <div className="wrap-md page-pad">
      <div className="card gate-card stack gap-16">
        <div className="stack gap-8">
          <h1 className="h3">{title}</h1>
          <p className="small mono" style={{ lineHeight: 1.6 }}>
            {blurb}
          </p>
        </div>

        <div className="gate-list">
          {bullets.map((b) => (
            <div key={b} className="row gap-8">
              <span className="tiny" style={{ color: "var(--primary)" }}>
                ✓
              </span>
              <span className="small" style={{ color: "var(--foreground)" }}>
                {b}
              </span>
            </div>
          ))}
        </div>

        <button
          className="btn btn-primary btn-block"
          onClick={() => {
            setErr(null);
            void actions.connectWallet().then((r) => {
              if (!r.ok) setErr(r.error ?? "Connection failed");
            });
          }}
        >
          Connect wallet
        </button>

        {err && (
          <div className="notice notice-warn">
            <div>
              <strong>Connection failed</strong>
              <div style={{ marginTop: 2 }}>{err}</div>
            </div>
          </div>
        )}

        <div className="stack gap-6">
          <span className="tiny">
            Provider: <span className="mono">{provider.id}</span> ({provider.label})
          </span>
          {PROVIDER_CHOICES.filter((c) => c.id !== provider.id).map((c) => (
            <span key={c.id} className="tiny faint">
              Available as alternative: {c.label} — set NEXT_PUBLIC_WALLET_PROVIDER={c.id}
            </span>
          ))}
        </div>

        <p className="tiny mono" style={{ lineHeight: 1.6 }}>
          No keys are held by this build: connecting starts a <strong>session wallet</strong> (simulated, stored locally)
          so the screens can be reviewed. Real signing is the execution plane&apos;s job — see{" "}
          <Link href="/execution" style={{ textDecoration: "underline" }}>
            /execution
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
