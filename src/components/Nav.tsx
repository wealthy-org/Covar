"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { shortAddr } from "@/lib/format";
import { actions, useCovar } from "@/lib/store";
import { WalletDialog } from "./WalletDialog";
import { X_HANDLE, X_URL, XIcon } from "./Social";
import { CHAINS, EXPECTED_CHAIN_ID, IS_MAINNET, VAULT_ADDRESS, explorerAddress } from "@/lib/chain";

/**
 * Contract strip on top, then one full-width
 * row — brand, DISCOVER / MY AGENTS / MY MONEY / MORE ▾ — and the actions on the
 * right: "+ NEW AGENT" + "CONNECT WALLET" in the app, a single "LAUNCH APP" on
 * marketing pages. Our extra: a notifications button (the inbox is a brief
 * feature, and it must stay one click away).
 */
const PRIMARY = [
  { href: "/explore", label: "Discover", match: ["/explore", "/agents", "/creators"] },
  { href: "/studio", label: "My agents", match: ["/studio"] },
  { href: "/portfolio", label: "My money", match: ["/portfolio"] },
  { href: "/trade", label: "Trade", match: ["/trade"] },
];

type MoreItem = { href: string; label: string } | { sep: true };
const MORE: MoreItem[] = [
  { href: "/economics", label: "Economics" },
  { href: "/treasury", label: "Treasury" },
  { href: "/docs", label: "Docs" },
  { sep: true },
  // the execution plane is an operator view of the paper venue — not shown on mainnet
  ...(IS_MAINNET ? [] : [{ href: "/execution", label: "Execution plane" }]),
  { href: "/chain", label: "Contract & network" },
  { href: "/notifications", label: "Notifications" },
];

const MARKETING = new Set(["/", "/economics", "/treasury"]);

const isActive = (pathname: string | null, prefixes: readonly string[]) =>
  !!pathname && prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));

function Caret() {
  return (
    <svg className="nav-caret" viewBox="0 0 10 10" aria-hidden>
      <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Bell() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9a6 6 0 1112 0c0 5 2 6.5 2 6.5H4S6 14 6 9z" />
      <path d="M10 19a2 2 0 004 0" />
    </svg>
  );
}

function Burger({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  const { portfolio, walletConnected, notifications } = useCovar();
  const [panelOpen, setPanelOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const landing = pathname === "/";
  const marketing = MARKETING.has(pathname ?? "");
  const unread = notifications.filter((n) => !n.read).length;
  const chain = CHAINS[EXPECTED_CHAIN_ID];
  const addr = VAULT_ADDRESS;
  const moreActive = MORE.some((m) => "href" in m && isActive(pathname, [m.href.split("#")[0]]));

  // close menus on navigation
  useEffect(() => {
    setMoreOpen(false);
    setPanelOpen(false);
  }, [pathname]);

  // outside click + Escape close the More menu
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // hairline under the sticky nav once content scrolls beneath it
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 52);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  const connect = () => {
    void actions.connectWallet().then((r) => {
      if (!r.ok && r.error) setConnectError(r.error);
    });
  };

  const walletButton = (extra = "") =>
    walletConnected ? (
      <button className={`btn btn-primary nav-btn ${extra}`} onClick={() => setWalletOpen(true)} title="Your wallet — click for details">
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.04em" }}>
          {shortAddr(portfolio.wallet, 4)}
        </span>
      </button>
    ) : (
      <button className={`nav-btn nav-btn-wallet ${extra}`} onClick={connect}>
        Connect wallet
      </button>
    );

  return (
    <>
      {/* ------------------------------ contract strip ------------------------------ */}
      <div className="announce">
        <div className="announce-inner">
          <span className="announce-label">
            <span className="lbl-long">Covar vault </span>address
          </span>
          {addr ? (
            <span className="announce-addr">{addr}</span>
          ) : (
            <span className="announce-addr" data-empty>
              coming soon
            </span>
          )}
          <span className="spacer" />
          <span className="announce-net" title="Network">
            <span className="dot" style={{ background: chain.isMainnet ? "#12B76A" : "#B4540B" }} />
            {chain.name} · {EXPECTED_CHAIN_ID}
          </span>
          <button className="announce-btn" onClick={copy} disabled={!addr} aria-label="Copy contract address">
            <CopyIcon />
            {copied ? "Copied" : "Copy"}
          </button>
          {addr && (
            <a className="announce-btn" href={explorerAddress(addr)} target="_blank" rel="noreferrer noopener">
              ↗ <span className="lbl-long">View on </span>explorer
            </a>
          )}
        </div>
      </div>

      {/* ----------------------------------- nav ----------------------------------- */}
      <header className={landing ? "nav nav-landing" : "nav"} data-scrolled={(!landing && scrolled) || undefined}>
        <div className="nav-inner">
          <Link href="/" className="brand" aria-label="Covar home">
            <Image src="/logo.png" alt="" width={20} height={22} className="brand-logo" priority />
            <span>Covar</span>
          </Link>

          <nav className="nav-links" aria-label="Primary">
            {PRIMARY.map((l) => (
              <Link key={l.href} href={l.href} className="nav-link" data-active={isActive(pathname, l.match)}>
                {l.label}
              </Link>
            ))}
            <div ref={moreRef} style={{ position: "relative" }}>
              <button
                className="nav-link"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                data-active={moreActive}
                onClick={() => setMoreOpen((v) => !v)}
              >
                More <Caret />
                {unread > 0 && <span className="nav-dot" aria-label={`${unread} unread notifications`} />}
              </button>
              {moreOpen && (
                <div role="menu" className="nav-menu">
                  {MORE.map((m, i) =>
                    "sep" in m ? (
                      <div key={`sep-${i}`} className="nav-menu-sep" />
                    ) : (
                      <Link
                        key={m.href}
                        href={m.href}
                        role="menuitem"
                        data-active={isActive(pathname, [m.href.split("#")[0]]) && !m.href.includes("#")}
                        onClick={() => setMoreOpen(false)}
                      >
                        {m.label}
                        {m.href === "/notifications" && unread > 0 && <span className="pill pill-accent">{unread} new</span>}
                      </Link>
                    )
                  )}
                </div>
              )}
            </div>
          </nav>

          <div className="nav-actions">
            <a
              href={X_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="nav-btn nav-btn-icon"
              aria-label={`Covar on X (${X_HANDLE})`}
              title={`Follow ${X_HANDLE} on X`}
            >
              <XIcon size={13} />
            </a>
            {marketing ? (
              <Link href="/explore" className="nav-btn nav-btn-ink">
                Launch app
              </Link>
            ) : (
              <>
                <Link
                  href="/notifications"
                  className="nav-btn nav-btn-icon nav-hide-sm"
                  aria-label={`Notifications, ${unread} unread`}
                  title="Notifications"
                  data-active={pathname === "/notifications"}
                >
                  <Bell />
                  {unread > 0 && <span className="nav-badge">{unread > 99 ? "99+" : unread}</span>}
                </Link>
                <Link href="/studio?new=1" className="nav-btn nav-hide-md">
                  + New agent
                </Link>
                {walletButton("nav-hide-md")}
              </>
            )}
            <button
              className="nav-btn nav-btn-icon nav-burger"
              aria-label={panelOpen ? "Close menu" : "Open menu"}
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((v) => !v)}
            >
              <Burger open={panelOpen} />
            </button>
          </div>
        </div>

        {panelOpen && (
          <div className="nav-panel">
            {PRIMARY.map((l) => (
              <Link key={l.href} href={l.href} data-active={isActive(pathname, l.match)}>
                {l.label} <span aria-hidden>→</span>
              </Link>
            ))}
            {MORE.map((m, i) =>
              "sep" in m ? null : (
                <Link key={`${m.href}-${i}`} href={m.href} data-active={isActive(pathname, [m.href.split("#")[0]]) && !m.href.includes("#")}>
                  {m.label}
                  {m.href === "/notifications" && unread > 0 ? <span className="pill pill-accent">{unread} new</span> : <span aria-hidden>→</span>}
                </Link>
              )
            )}
            <div className="nav-panel-actions">
              <Link href="/studio?new=1" className="nav-btn">
                + New agent
              </Link>
              {walletConnected ? (
                <button className="nav-btn" onClick={() => actions.disconnectWallet()}>
                  Disconnect {shortAddr(portfolio.wallet, 3)}
                </button>
              ) : (
                <button className="nav-btn nav-btn-wallet" onClick={connect}>
                  Connect wallet
                </button>
              )}
            </div>
          </div>
        )}

        {connectError && (
          <div role="alert" className="panel" style={{ position: "fixed", top: 112, right: 16, zIndex: 80, padding: 12, maxWidth: 320, boxShadow: "var(--shadow-md)" }}>
            <div className="stack gap-6">
              <span className="small strong">Couldn&apos;t connect your wallet</span>
              <span className="tiny">{connectError}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setConnectError(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}
      </header>

      <WalletDialog open={walletOpen} onClose={() => setWalletOpen(false)} />
    </>
  );
}
