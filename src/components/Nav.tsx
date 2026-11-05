"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { shortAddr } from "@/lib/format";
import { actions, useCovar } from "@/lib/store";
import { WalletDialog } from "./WalletDialog";
import { CHAINS, EXPECTED_CHAIN_ID, VAULT_ADDRESS, explorerAddress } from "@/lib/chain";

/* Reference nav: contract strip on top, then a single row of small uppercase
   mono links with two buttons on the right. Same shape here, our own content. */
const LINKS = [
  { href: "/explore", label: "Discover" },
  { href: "/studio", label: "My agents" },
  { href: "/portfolio", label: "My money" },
  { href: "/execution", label: "Execution" },
  { href: "/economics", label: "Economics" },
];

const MORE = [
  { href: "/notifications", label: "Notifications" },
  { href: "/treasury", label: "Treasury" },
  { href: "/chain", label: "Chain status" },
  { href: "/docs", label: "Documentation" },
  { href: "/docs#parity", label: "Parity register" },
];

export function Nav() {
  const pathname = usePathname();
  const { portfolio, walletConnected, notifications } = useCovar();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setMoreOpen(false), [pathname]);

  const chain = CHAINS[EXPECTED_CHAIN_ID];
  const addr = VAULT_ADDRESS;

  async function copy() {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <>
      <div className="announce">
        <div className="announce-inner">
          <span className="announce-label">Testnet vault address</span>
          {addr ? (
            <span className="announce-addr mono">{addr}</span>
          ) : (
            <span className="announce-addr mono">not deployed yet — configure NEXT_PUBLIC_COVAR_VAULT_ADDRESS</span>
          )}
          <span className="spacer" />
          <span className="badge badge-outline nav-hide-sm" title="Network this build is configured against">
            <span className="dot" style={{ background: chain.isMainnet ? "#B42318" : "#B4540B" }} />
            {chain.name} · {EXPECTED_CHAIN_ID}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={copy} disabled={!addr} aria-label="Copy contract address">
            {copied ? "Copied" : "Copy"}
          </button>
          {addr && (
            <a
              className="btn btn-secondary btn-sm"
              href={explorerAddress(addr)}
              target="_blank"
              rel="noreferrer noopener"
            >
              View on explorer ↗
            </a>
          )}
        </div>
      </div>

      <header className="nav">
        <div className="container nav-inner">
          <Link href="/" className="brand" aria-label="Covar home">
            <span className="brand-mark">C</span>
            <span>Covar</span>
          </Link>

          <nav className="nav-links" aria-label="Primary">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="nav-link" data-active={pathname === l.href || (pathname?.startsWith(l.href + "/") ?? false)}>
                {l.label}
              </Link>
            ))}

            <div style={{ position: "relative" }}>
              <button
                className="nav-link"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                onClick={() => setMoreOpen((v) => !v)}
              >
                More ▾
              </button>
              {moreOpen && (
                <div
                  role="menu"
                  className="panel"
                  style={{ position: "absolute", top: 32, left: 0, padding: 6, minWidth: 190, boxShadow: "var(--shadow-md)", zIndex: 50 }}
                >
                  {MORE.map((m) => (
                    <Link
                      key={m.href}
                      href={m.href}
                      className="nav-link"
                      role="menuitem"
                      style={{ display: "block" }}
                      onClick={() => setMoreOpen(false)}
                    >
                      {m.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </nav>

          <span className="spacer" />

          <Link
            href="/notifications"
            className="btn btn-secondary"
            aria-label={`Notifications, ${notifications.filter((n) => !n.read).length} unread`}
            title="Notifications"
            style={{ position: "relative" }}
            data-active={pathname === "/notifications"}
          >
            🔔
            {notifications.some((n) => !n.read) && (
              <span
                aria-hidden
                className="mono"
                style={{
                  position: "absolute",
                  top: -6,
                  right: -8,
                  background: "var(--primary)",
                  color: "#fff",
                  borderRadius: 20,
                  fontSize: 9.5,
                  lineHeight: 1,
                  padding: "3px 5px",
                  minWidth: 17,
                }}
              >
                {notifications.filter((n) => !n.read).length}
              </span>
            )}
          </Link>

          <Link href="/studio?new=1" className="btn btn-secondary">
            + New agent
          </Link>

          {connectError && (
            <div
              role="alert"
              className="panel"
              style={{
                position: "fixed",
                top: 84,
                right: 16,
                zIndex: 80,
                padding: 12,
                maxWidth: 320,
                boxShadow: "var(--shadow-md)",
              }}
            >
              <div className="stack gap-6">
                <span className="small strong">Wallet connection failed</span>
                <span className="tiny">{connectError}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setConnectError(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {walletConnected ? (
            <button className="btn btn-primary" onClick={() => setWalletOpen(true)} title="Session wallet (simulated)">
              <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>
                {shortAddr(portfolio.wallet, 4)}
              </span>
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => {
              void actions.connectWallet().then((r) => {
                if (!r.ok && r.error) setConnectError(r.error);
              });
            }}>
              Connect wallet
            </button>
          )}

          <button
            className="btn btn-secondary btn-sm mobile-only"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
        </div>

        {open && (
          <div className="container" style={{ paddingBottom: 12 }}>
            <div className="panel" style={{ padding: 6 }}>
              {[...LINKS, ...MORE].map((l) => (
                <Link key={l.href} href={l.href} className="nav-link" style={{ display: "block" }} onClick={() => setOpen(false)}>
                  {l.label}
                </Link>
              ))}
              {walletConnected ? (
                <button className="nav-link" style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0 }} onClick={() => actions.disconnectWallet()}>
                  Disconnect ({shortAddr(portfolio.wallet, 3)})
                </button>
              ) : (
                <button className="nav-link" style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0 }} onClick={() => {
              void actions.connectWallet().then((r) => {
                if (!r.ok && r.error) setConnectError(r.error);
              });
            }}>
                  Connect wallet
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <WalletDialog open={walletOpen} onClose={() => setWalletOpen(false)} />
    </>
  );
}
