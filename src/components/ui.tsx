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
