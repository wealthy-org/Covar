"use client";

import React, { useEffect, useRef } from "react";
import type { Provenance } from "@/lib/types";
import { PROVENANCE_LABEL } from "@/lib/types";
import { cx } from "@/lib/format";

export function ProvenanceBadge({ kind, className }: { kind: Provenance; className?: string }) {
  const map: Record<Provenance, string> = {
    backtest: "badge-amber",
    practice: "badge-blue",
    testnet: "badge-amber",
    live: "badge-green",
    vault: "badge-blue",
  };
  return (
    <span className={cx("badge", map[kind], className)} title={`Data provenance: ${PROVENANCE_LABEL[kind]}`}>
      <span className="dot" />
      {PROVENANCE_LABEL[kind]}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "pos" | "neg" | "neutral";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span
        className={cx(
          "stat-value",
          size === "sm" && "stat-value-sm",
          size === "lg" && "text-[28px]",
          tone === "pos" && "pos",
          tone === "neg" && "neg"
        )}
      >
        {value}
      </span>
      {hint ? <span className="tiny">{hint}</span> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="row between" style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)" }}>
          <div className="stack" style={{ gap: 2 }}>
            <h3 className="h4">{title}</h3>
            {subtitle ? <span className="small">{subtitle}</span> : null}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="modal-pad">{children}</div>
        {footer ? (
          <div className="row between gap-12" style={{ padding: "14px 24px", borderTop: "1px solid var(--border)" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="stack center gap-12" style={{ padding: "48px 24px", textAlign: "center" }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: "var(--primary-soft)",
          display: "grid",
          placeItems: "center",
          color: "var(--primary)",
          fontWeight: 700,
        }}
      >
        ∅
      </div>
      <h4 className="h4">{title}</h4>
      <p className="body" style={{ maxWidth: 380 }}>
        {body}
      </p>
      {action}
    </div>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4200);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--foreground)",
        color: "#fff",
        padding: "11px 16px",
        borderRadius: 10,
        fontSize: 13.5,
        boxShadow: "var(--shadow-md)",
        zIndex: 200,
        maxWidth: 520,
      }}
    >
      {message}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const node = msg ? <Toast message={msg} onDone={() => setMsg(null)} /> : null;
  return { toast: setMsg, node };
}

/* Official token marks (public/tokens/) — agents are identified by the asset they trade. */
const TOKEN_LOGO: Record<string, { src: string; name: string; bg: string; pad: number }> = {
  BTC: { src: "/tokens/btc.svg", name: "Bitcoin", bg: "transparent", pad: 0 },
  ETH: { src: "/tokens/eth.svg", name: "Ethereum", bg: "#ffffff", pad: 0.2 },
  SOL: { src: "/tokens/sol.svg", name: "Solana", bg: "#000000", pad: 0.24 },
  HYPE: { src: "/tokens/hype.png", name: "Hyperliquid", bg: "#072723", pad: 0 },
  USDG: { src: "/tokens/usdg.png", name: "Global Dollar (USDG)", bg: "transparent", pad: 0 },
};

export const tokenOf = (market: string) => market.split(/[-/]/)[0].toUpperCase();

export function TokenLogo({ market, size = 28, ring = false }: { market: string; size?: number; ring?: boolean }) {
  const t = TOKEN_LOGO[tokenOf(market)];
  const pad = t ? Math.round(size * t.pad) : Math.round(size * 0.22);
  return (
    <span
      className="token-logo"
      title={t ? `${t.name} · ${market}` : market}
      style={{
        width: size,
        height: size,
        padding: pad,
        background: t?.bg ?? "#ffffff",
        boxShadow:
          [ring ? "0 0 0 2px #fff" : "", !t || t.bg === "#ffffff" ? "inset 0 0 0 1px var(--border)" : ""].filter(Boolean).join(", ") ||
          undefined,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={t?.src ?? "/logo.png"} alt={t ? t.name : "Covar"} width={size - pad * 2} height={size - pad * 2} />
    </span>
  );
}

/** Creators have no logo of their own — show the official marks of the markets they trade. */
export function TokenStack({ markets, size = 28 }: { markets: string[]; size?: number }) {
  const uniq = Array.from(new Set(markets.map(tokenOf))).slice(0, 3);
  if (uniq.length === 0) return <TokenLogo market="COVAR" size={size} />;
  return (
    <span className="token-stack" style={{ height: size }}>
      {uniq.map((m, i) => (
        <span key={m} style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.32), zIndex: uniq.length - i }}>
          <TokenLogo market={m} size={size} ring />
        </span>
      ))}
    </span>
  );
}

/** Covar's own mark, for assistant messages. */
export function CovarMark({ size = 26 }: { size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: "#fff" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Covar" width={Math.round(size * 0.46)} height={Math.round(size * 0.5)} />
    </span>
  );
}
