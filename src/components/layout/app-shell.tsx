"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, Bot, Compass, Home, LayoutDashboard, Menu, Plus,
  Settings2, Wallet, X
} from "lucide-react";
import { useState } from "react";

const mainNav = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/explore", label: "Discover", icon: Compass },
  { href: "/studio", label: "My Agents", icon: Bot },
  { href: "/portfolio", label: "My Money", icon: Wallet }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = (
    <>
      <div className="sidebar-brand-row">
        <Link href="/" className="brand" onClick={() => setMobileOpen(false)}>
          <span className="brand-mark">c</span>
          <span>covar</span>
        </Link>
        <button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}>
          <X size={18} />
        </button>
      </div>
      <Link href="/studio?new=1" className="create-agent" onClick={() => setMobileOpen(false)}>
        <Plus size={16} /> Create an agent
      </Link>
      <div className="nav-section-label">Workspace</div>
      <nav className="side-nav" aria-label="Main navigation">
        {mainNav.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`nav-link ${active ? "active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {label === "My Agents" && <span className="nav-count">0</span>}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="network-card">
          <span className="network-indicator" />
          <div><strong>Testnet mode</strong><small>Robinhood Chain</small></div>
        </div>
        <button className="nav-link settings-link"><Settings2 size={17} /> Settings <span className="coming-soon">Soon</span></button>
        <div className="profile-row">
          <div className="avatar">C</div>
          <div className="profile-copy"><strong>Guest</strong><small>Connect wallet to continue</small></div>
          <Activity size={15} className="profile-status" />
        </div>
      </div>
    </>
  );

  return (
    <div className="app-frame">
      <aside className="sidebar">{nav}</aside>
      {mobileOpen && <div className="mobile-backdrop" onClick={() => setMobileOpen(false)} />}
      <aside className={`mobile-sidebar ${mobileOpen ? "open" : ""}`}>{nav}</aside>
      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <Menu size={19} />
          </button>
          <div className="breadcrumb"><span>Covar</span><span className="breadcrumb-slash">/</span><strong>{mainNav.find((item) => item.href === pathname)?.label ?? (pathname.startsWith("/explore") ? "Discover" : pathname.startsWith("/studio") ? "My Agents" : pathname.startsWith("/portfolio") ? "My Money" : "Workspace")}</strong></div>
          <div className="topbar-actions">
            <span className="environment-pill"><span /> Testnet</span>
            <button className="connect-button">Connect wallet</button>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
