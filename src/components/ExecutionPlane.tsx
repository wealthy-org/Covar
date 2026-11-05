"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cx, timeAgo, usd } from "@/lib/format";
import { ProvenanceBadge } from "@/components/ui";

/* ------------------------------------------------------------------ types */

interface OrderRecord {
  clientOrderId: string;
  intentId: string;
  market: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  reduceOnly: boolean;
  status: "queued" | "risk_rejected" | "signed" | "submitting" | "submitted" | "filled" | "failed";
  filledQty: number;
  avgFillPrice: number;
  attempts: number;
  lastError?: string;
  venueOrderId?: string;
  updatedAt: string;
}

interface RecoveryReport {
  at: string;
  scanned: number;
  adopted: string[];
  resubmitted: string[];
  duplicatePrevented: number;
  note: string;
}

interface ExecState {
  orders: OrderRecord[];
  positions: { market: string; qty: number; avgPrice: number; realizedPnl: number }[];
  queueDepth: number;
  newRiskPaused: boolean;
  venueCalls: number;
  lastRecovery: RecoveryReport | null;
  counts: { total: number; queued: number; submitting: number; submitted: number; filled: number; rejected: number; failed: number };
}

interface RiskState {
  equity: number;
  dayStartEquity: number;
  peakEquity: number;
  realizedPnlToday: number;
  mode: "normal" | "close_only" | "halted";
  modeReason?: string;
  openPositions: Record<string, number>;
  updatedAt: string;
}

interface JournalEntry {
  seq: number;
  at: string;
  service: string;
  type: string;
  payload: Record<string, unknown>;
}

interface Payload {
  ok: boolean;
  error?: string;
  at?: string;
  state?: { execution: ExecState; risk: RiskState | null; venuePositions: { market: string; qty: number }[]; signer: Record<string, unknown> | null };
  journal?: JournalEntry[];
}

/* ------------------------------------------------------------------ flow */

const FLOW: { key: string; label: string; hint: string }[] = [
  { key: "queued", label: "queued", hint: "durable in the journal, not yet checked" },
  { key: "signed", label: "signed", hint: "signer approved — market allowlisted, no destination field" },
  { key: "submitting", label: "submitting", hint: "journaled before the venue call — this is the crash window" },
  { key: "submitted", label: "submitted", hint: "venue ack recorded, waiting for the fill" },
  { key: "filled", label: "filled", hint: "fill applied once, idempotent by fillId" },
];

const STATUS_TONE: Record<OrderRecord["status"], string> = {
  queued: "badge-outline",
  signed: "badge-blue",
  submitting: "badge-amber",
  submitted: "badge-blue",
  filled: "badge-green",
  risk_rejected: "badge-red",
  failed: "badge-red",
};

function summarise(payload: Record<string, unknown>) {
  const keys = ["clientOrderId", "status", "market", "qty", "price", "reason", "adopted", "resubmitted", "scanned", "newRiskPaused", "lastError"];
  const parts = keys.filter((k) => payload?.[k] !== undefined).map((k) => {
    const v = payload[k];
    return `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`;
  });
  return parts.join("  ") || Object.keys(payload ?? {}).slice(0, 3).join(", ");
}

export function ExecutionPlane() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/execution", { cache: "no-store" });
      setData((await res.json()) as Payload);
    } catch {
      setData({ ok: false, error: "the web app could not reach its own API route" });
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  const act = useCallback(
    async (action: string, paused?: boolean) => {
      setBusy(action);
      try {
        await fetch("/api/execution", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, paused }),
        });
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const exec = data?.state?.execution;
  const risk = data?.state?.risk;
  const journal = useMemo(() => [...(data?.journal ?? [])].reverse(), [data?.journal]);
  const visible = showAll ? journal : journal.slice(0, 18);

  if (!loaded) {
    return (
      <div className="panel" style={{ padding: 20 }}>
        <span className="small">Reading the execution journal…</span>
      </div>
    );
  }

  if (!data?.ok || !exec) {
    return (
      <div className="panel stack gap-12" style={{ padding: 20 }}>
        <div className="row between wrap gap-8">
          <span className="strong">Execution plane is not running</span>
          <span className="badge badge-amber">
            <span className="dot" /> offline
          </span>
        </div>
        <p className="body" style={{ margin: 0 }}>
          Nothing is faked here. This page reads the live journals of the risk, signer, venue and execution services; when
          those processes are down there is no order state to show.
        </p>
        <div className="panel mono small" style={{ padding: 12, background: "#FBFCFE" }}>
          npm run services
        </div>
        <span className="tiny">
          Services bind to 4010–4013 inside the deployment. {data?.error ? `Last error: ${data.error}` : ""}
        </span>
      </div>
    );
  }

  const openNotional = exec.positions.reduce((s, p) => s + Math.abs(p.qty * p.avgPrice), 0);
  const modeTone = risk?.mode === "normal" ? "badge-green" : risk?.mode === "close_only" ? "badge-amber" : "badge-red";

  return (
    <div className="stack gap-20">
      {/* ---------------------------------------------------------- status */}
      <div className="grid-4">
        <div className="panel stack gap-6" style={{ padding: 16 }}>
          <span className="tiny">Risk mode</span>
          <span className={cx("badge", modeTone)} style={{ alignSelf: "flex-start" }}>
            <span className="dot" />
            {risk?.mode ?? "unknown"}
          </span>
          <span className="tiny">{risk?.modeReason ?? "all seven checks passing"}</span>
        </div>
        <div className="panel stack gap-6" style={{ padding: 16 }}>
          <span className="tiny">Risk equity (paper)</span>
          <span className="h4 num">{risk ? usd(risk.equity) : "—"}</span>
          <span className={cx("tiny num", (risk?.realizedPnlToday ?? 0) >= 0 ? "pos" : "neg")}>
            {risk ? `${(risk.realizedPnlToday >= 0 ? "+" : "") + usd(risk.realizedPnlToday)} today` : ""}
          </span>
        </div>
        <div className="panel stack gap-6" style={{ padding: 16 }}>
          <span className="tiny">Orders in flight</span>
          <span className="h4 num">{exec.queueDepth}</span>
          <span className="tiny num">
            {exec.counts.filled} filled · {exec.counts.rejected} rejected of {exec.counts.total}
          </span>
        </div>
        <div className="panel stack gap-6" style={{ padding: 16 }}>
          <span className="tiny">Entries</span>
          <span className={cx("badge", exec.newRiskPaused ? "badge-amber" : "badge-green")} style={{ alignSelf: "flex-start" }}>
            <span className="dot" />
            {exec.newRiskPaused ? "paused by operator" : "accepting"}
          </span>
          <span className="tiny">exits still fill while paused</span>
        </div>
      </div>

      {/* ------------------------------------------------------- state path */}
      <div className="panel" style={{ padding: 18 }}>
        <div className="row between wrap gap-8" style={{ marginBottom: 12 }}>
          <span className="strong">Order state machine</span>
          <span className="tiny">
            every transition is an append-only journal line · {exec.venueCalls} venue calls since boot
          </span>
        </div>
        <div className="flow">
          {FLOW.map((step, i) => {
            const count =
              step.key === "queued"
                ? exec.counts.queued
                : step.key === "signed"
                ? exec.orders.filter((o) => o.status === "signed").length
                : step.key === "submitting"
                ? exec.counts.submitting
                : step.key === "submitted"
                ? exec.counts.submitted
                : exec.counts.filled;
            const isCrash = step.key === "submitting";
            return (
              <div key={step.key} className="flow-step" data-crash={isCrash || undefined}>
                <span className="flow-idx">{i + 1}</span>
                <span className="small strong mono">{step.label}</span>
                <span className="h4 num">{count}</span>
                <span className="tiny" style={{ maxWidth: 170 }}>
                  {step.hint}
                </span>
              </div>
            );
          })}
          <div className="flow-step" data-branch="true">
            <span className="flow-idx">✕</span>
            <span className="small strong mono">terminal</span>
            <span className="h4 num">
              {exec.counts.rejected + exec.counts.failed}
            </span>
            <span className="tiny" style={{ maxWidth: 170 }}>
              risk_rejected / failed — never retried automatically
            </span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------- reconciliation */}
      <div className="grid-2">
        <div className="panel stack gap-12" style={{ padding: 18 }}>
          <div className="row between wrap gap-8">
            <span className="strong">Restart reconciliation</span>
            <span className="badge badge-blue">
              <span className="dot" /> runs on boot
            </span>
          </div>
          {exec.lastRecovery ? (
            <div className="stack gap-8">
              <div className="row between">
                <span className="small">Scanned (in-flight at boot)</span>
                <span className="small num strong">{exec.lastRecovery.scanned}</span>
              </div>
              <div className="row between">
                <span className="small">Adopted from the venue</span>
                <span className="small num strong">{exec.lastRecovery.adopted.length}</span>
              </div>
              <div className="row between">
                <span className="small">Resubmitted with the same key</span>
                <span className="small num strong">{exec.lastRecovery.resubmitted.length}</span>
              </div>
              <div className="row between">
                <span className="small">Duplicate orders prevented</span>
                <span className="small num strong">{exec.lastRecovery.duplicatePrevented}</span>
              </div>
              <span className="tiny">{exec.lastRecovery.note}</span>
              <span className="tiny">last run {timeAgo(exec.lastRecovery.at)}</span>
            </div>
          ) : (
            <span className="small">No reconciliation has run in this process yet.</span>
          )}
          <div className="row gap-8 wrap">
            <button className="btn btn-secondary btn-sm" onClick={() => act("recover")} disabled={busy !== null}>
              {busy === "recover" ? "Reconciling…" : "Run reconciliation now"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => act("pause", !exec.newRiskPaused)}
              disabled={busy !== null}
            >
              {exec.newRiskPaused ? "Resume new risk" : "Pause new risk"}
            </button>
          </div>
          <span className="tiny">
            Reconciliation never mints a new clientOrderId. A key the venue already knows is adopted, so a crash cannot
            become a second position.
          </span>
        </div>

        <div className="panel stack gap-12" style={{ padding: 18 }}>
          <div className="row between wrap gap-8">
            <span className="strong">Positions</span>
            <span className="tiny num">
              {usd(openNotional)} open notional · equity {risk ? usd(risk.equity) : "—"}
            </span>
          </div>
          {exec.positions.length === 0 ? (
            <span className="small">Flat. No fills have been applied in this process.</span>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th className="right">Qty</th>
                    <th className="right">Avg price</th>
                    <th className="right">Realized</th>
                  </tr>
                </thead>
                <tbody>
                  {exec.positions.map((p) => (
                    <tr key={p.market}>
                      <td className="mono">{p.market}</td>
                      <td className="right num">{p.qty}</td>
                      <td className="right num">{usd(p.avgPrice)}</td>
                      <td className={cx("right num", p.realizedPnl >= 0 ? "pos" : "neg")}>
                        {(p.realizedPnl >= 0 ? "+" : "") + usd(p.realizedPnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <hr className="divider" />
          <div className="stack gap-6">
            <span className="tiny">Platform ceilings applied by the risk service</span>
            <div className="row wrap gap-6">
              <span className="badge badge-outline">5x max leverage</span>
              <span className="badge badge-outline">40% equity cap</span>
              <span className="badge badge-outline">10% daily loss → close-only</span>
              <span className="badge badge-outline">25% drawdown → halted</span>
            </div>
            <span className="tiny">A Copilot approval cannot raise any of these.</span>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ orders */}
      <div className="panel" style={{ padding: 18 }}>
        <div className="row between wrap gap-8" style={{ marginBottom: 10 }}>
          <span className="strong">Orders</span>
          <span className="tiny">rebuilt from the journal at boot — not from memory</span>
        </div>
        {exec.orders.length === 0 ? (
          <span className="small">
            No intents yet. Submit one with{" "}
            <span className="mono">POST /intents</span> to the execution service.
          </span>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Client order id</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th className="right">Qty</th>
                  <th className="right">Filled</th>
                  <th>Status</th>
                  <th>Note</th>
                  <th>Venue id</th>
                  <th className="right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {exec.orders.map((o) => (
                  <tr key={o.clientOrderId}>
                    <td className="mono">{o.clientOrderId}</td>
                    <td className="mono">{o.market}</td>
                    <td>
                      <span className={cx("badge", o.side === "buy" ? "badge-blue" : "badge-outline")}>{o.side}</span>
                    </td>
                    <td className="right num">{o.qty}</td>
                    <td className="right num">{o.filledQty}</td>
                    <td>
                      <span className={cx("badge", STATUS_TONE[o.status])} title={o.lastError ?? undefined}>
                        <span className="dot" />
                        {o.status}
                      </span>
                    </td>
                    <td className="tiny" style={{ maxWidth: 220 }} title={o.lastError ?? undefined}>
                      {o.lastError ? <span className={o.status === "risk_rejected" ? "neg" : "muted"}>{o.lastError}</span> : "—"}
                    </td>
                    <td className="mono tiny">{o.venueOrderId ?? "—"}</td>
                    <td className="right tiny">{timeAgo(o.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------- journal */}
      <div className="panel" style={{ padding: 18 }}>
        <div className="row between wrap gap-8" style={{ marginBottom: 10 }}>
          <span className="strong">Journal</span>
          <div className="row gap-8">
            <span className="tiny">{journal.length} entries · fsync per line</span>
            {journal.length > 18 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show latest 18" : "Show all"}
              </button>
            )}
          </div>
        </div>
        {journal.length === 0 ? (
          <span className="small">The journal file is empty.</span>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="right">seq</th>
                  <th>At</th>
                  <th>Service</th>
                  <th>Event</th>
                  <th>Payload</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={`${e.service}-${e.seq}`}>
                    <td className="right num tiny">{e.seq}</td>
                    <td className="tiny nowrap">{new Date(e.at).toLocaleTimeString()}</td>
                    <td className="mono tiny">{e.service}</td>
                    <td>
                      <span className={cx("badge", e.type.startsWith("recover") || e.type === "crashed_after_venue_ack" ? "badge-amber" : e.type === "fill_applied" ? "badge-green" : "badge-outline")}>
                        {e.type}
                      </span>
                    </td>
                    <td className="mono tiny truncate" style={{ maxWidth: 460 }} title={JSON.stringify(e.payload)}>
                      {summarise(e.payload)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel soft" style={{ padding: 16 }}>
        <div className="row between wrap gap-10">
          <div className="stack gap-4">
            <div className="row gap-8">
              <span className="small strong">Simulated execution plane</span>
              <ProvenanceBadge kind="practice" />
            </div>
            <span className="tiny" style={{ maxWidth: 720 }}>
              Venue, signer, risk and the vault indexer are separate processes. The venue adapter is selected behind the
              seam — currently: <span className="mono">{(data?.state as { venueAdapter?: string } | undefined)?.venueAdapter ?? "paper venue (default)"}</span>.
              Selecting a live adapter refuses to boot until one is reviewed in. Nothing on this page is a testnet or
              mainnet fill, and no funds are custodied. Testnet wiring is gated on a funded deployer key and a confirmed
              testnet USDG.
            </span>
          </div>
          <Link href="/docs#execution" className="btn btn-secondary btn-sm">
            How the plane works
          </Link>
        </div>
      </div>

      <style jsx>{`
        .flow {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 10px;
        }
        .flow :global(.flow-step) {
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: var(--surface);
        }
        .flow :global(.flow-step[data-crash]) {
          border-color: #f0d9a8;
          background: #fffdf6;
        }
        .flow :global(.flow-step[data-branch]) {
          border-style: dashed;
        }
        .flow :global(.flow-idx) {
          font-size: 11px;
          color: var(--muted-2);
          font-variant-numeric: tabular-nums;
        }
        @media (max-width: 1080px) {
          .flow {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 660px) {
          .flow {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .flow :global(.flow-step) {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
