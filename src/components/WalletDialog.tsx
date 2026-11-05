"use client";

import { useState } from "react";
import { useCovar } from "@/lib/store";
import { getWalletProvider } from "@/lib/wallet";
import { Modal } from "./ui";
import { shortAddr, usd } from "@/lib/format";

export function WalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { portfolio, walletProviderId, walletGuarantee } = useCovar();
  const [copied, setCopied] = useState(false);

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
            <div className="strong num">{usd(portfolio.creditUsd)}</div>
          </div>
        </div>

        <p className="small">
          Deposits, withdrawals and vault shares in this build are simulated against our own vault specification so the
          full investor path can be reviewed before any contract is deployed. Nothing here moves real value.
        </p>
      </div>
    </Modal>
  );
}
