"use client";

import { useState } from "react";
import { useCovar } from "@/lib/store";
import { getWalletProvider } from "@/lib/wallet";
import { Modal } from "./ui";
import { shortAddr, usd } from "@/lib/format";
import { signInWithEthereum, signOut, useAuth } from "@/lib/session";
import { injected } from "@/lib/vaultTx";
import { useCredits } from "@/lib/creditsClient";

export function WalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { portfolio, walletProviderId, walletGuarantee } = useCovar();
  const [copied, setCopied] = useState(false);
  const auth = useAuth();
  const credits = useCredits();
  const [authErr, setAuthErr] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(portfolio.wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Connected wallet" subtitle="Development session wallet">
      <div className="stack gap-16">
        <div className="notice notice-warn">
          <div>
            <strong>No private keys are held by this build.</strong>
            <div style={{ marginTop: 2 }}>
              Provider: <span className="mono">{walletProviderId ?? getWalletProvider().id}</span> —{" "}
              {walletGuarantee ?? "connect to see exactly what the connection proves."} Wallet signing, contract calls and
              gas flows run against Robinhood Chain testnet (46630) once contracts are deployed.
            </div>
          </div>
        </div>

        <div className="panel stack gap-8" style={{ padding: 14 }} data-testid="siwe-panel">
          <div className="row between gap-8">
            <span className="tiny">Account</span>
            <span className={auth.status === "signed-in" ? "badge badge-green" : "badge badge-outline"}>
              {auth.status === "signed-in" ? "Signed in" : auth.status === "signing" ? "Waiting for signature…" : "Not signed in"}
            </span>
          </div>
          {auth.status === "signed-in" && auth.user ? (
            <>
              <span className="small">
                <span className="mono">{shortAddr(auth.user.address, 8)}</span> · proven by a Sign-In with Ethereum signature. Your
                strategies, practice runs and history sync to this account on any device.
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <span className="small">
                Sign a free message (no gas, no transaction) to prove you own your wallet and keep your data across devices.
              </span>
              <button
                className="btn btn-primary btn-sm"
                disabled={auth.status === "signing" || !injected()}
                onClick={() => {
                  setAuthErr(null);
                  void signInWithEthereum().then((r) => !r.ok && setAuthErr(r.error ?? "Sign-in failed"));
                }}
              >
                {injected() ? "Sign in with Ethereum" : "Install MetaMask or Rabby to sign in"}
              </button>
              {(authErr ?? auth.error) && (
                <span className="tiny" role="alert" style={{ color: "var(--negative)" }}>
                  {authErr ?? auth.error}
                </span>
              )}
            </>
          )}
        </div>

        <div className="panel" style={{ padding: 14 }}>
          <span className="tiny">Provider selection</span>
          <p className="tiny" style={{ margin: "4px 0 0" }}>
            Set <span className="mono">NEXT_PUBLIC_WALLET_PROVIDER</span> to <span className="mono">session</span>{" "}
            (default, proves nothing), <span className="mono">evm</span> (injected wallet, account access only — no
            signature) or <span className="mono">privy</span> (the reference&rsquo;s provider; not shipped in this build).
          </p>
        </div>

        <div className="panel" style={{ padding: 14 }}>
          <div className="row between gap-12">
            <div className="stack" style={{ gap: 2 }}>
              <span className="tiny">Address</span>
              <span className="mono">{shortAddr(portfolio.wallet, 8)}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <hr className="divider" style={{ margin: "12px 0" }} />
          <div className="row between">
            <div className="stack" style={{ gap: 2 }}>
              <span className="tiny">Network</span>
              <span className="small">{portfolio.chain}</span>
            </div>
            <span className="badge badge-amber">Testnet</span>
          </div>
        </div>

        <div className="row gap-12">
          <div className="panel grow" style={{ padding: 14 }}>
            <span className="tiny">USDG balance</span>
            <div className="strong num">{usd(portfolio.cashUsd)}</div>
          </div>
          <div className="panel grow" style={{ padding: 14 }}>
            <span className="tiny">Copilot credits</span>
            <div className="strong num">{credits.balanceUsd === null ? "—" : usd(credits.balanceUsd)}</div>
          </div>
        </div>

        <p className="small">
          Balances on this card are the practice session&apos;s. Real deposits go through the <strong>Invest · on-chain</strong>{" "}
          panel (Portfolio, or an agent with a deployed vault) and are signed in your own wallet.
        </p>
      </div>
    </Modal>
  );
}
