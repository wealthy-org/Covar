"use client";

/**
 * On-chain record of the deployed vault (package 3.6): flows, fees and the event
 * log, all from /api/vault/summary (indexer → chain logs). Each row links to its
 * transaction. When the indexer is unavailable this says so and shows no numbers.
 */
import { useSyncExternalStore } from "react";
import { CHAINS, type ChainId } from "@/lib/chain";
import { chainLabel, usdg, vaultFeed, type VaultSummary } from "@/lib/vaultAgent";

const EVENT_LABEL: Record<string, string> = {
  Deposit: "Deposit",
  WithdrawalRequested: "Withdrawal requested",
  PositionsClosed: "Positions closed",
  WithdrawalSettled: "Withdrawal settled",
  WithdrawalClaimed: "Claimed",
  NavReported: "NAV reported",
  Paused: "Pause flags changed",
  LimitsChanged: "Limits changed",
  TradingAccountChanged: "Trading account changed",
  AllocatedToVenue: "Allocated to venue",
};

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const when = (t: number | null) => (t ? new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export function useVaultFeed() {
  return useSyncExternalStore(vaultFeed.subscribe, vaultFeed.get, vaultFeed.get);
}

function explorerOf(s: VaultSummary) {
  const c = CHAINS[(s.chainId ?? 0) as ChainId];
  return c && s.chainId !== 31337 ? c.explorer : null;
}

/** Fee and flow totals, exact from transfers out of the vault. */
export function VaultTotals({ s, compact = false }: { s: VaultSummary; compact?: boolean }) {
  const t = s.totals;
  const items: [string, string][] = [
    ["Fees to treasury", `${fmt(usdg(t.feesToTreasury), 4)} USDG`],
    ["· deposit fees", `${fmt(usdg(t.depositFees), 4)} USDG`],
    ["· withdrawal fees", `${fmt(usdg(t.withdrawalFees), 4)} USDG`],
    ["Deposited (gross)", `${fmt(usdg(t.depositsGross))} USDG`],
    ["Paid out to investors", `${fmt(usdg(t.claimed))} USDG`],
    ["Allocated to the venue", `${fmt(usdg(t.allocatedToVenue))} USDG`],
  ];
  if (!compact) items.push(["Investors (ever / holding)", `${s.investors.total} / ${s.investors.holding}`], ["NAV reports", String(s.counts.navReports)]);
  return (
    <div className="stack" data-testid="vault-totals">
      {items.map(([k, v]) => (
        <div key={k} className="row between" style={{ padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
          <span className="small">{k}</span>
          <span className="mono-num small">{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function VaultActivity() {
  const feed = useVaultFeed();
  if (feed.status === "off") return null;
  if (feed.status !== "ready" || !feed.summary) {
    return (
      <section className="rcard rcard-pad stack gap-8" data-testid="vault-activity">
        <h2 className="rcard-title">On-chain record</h2>
        <span className="small">
          {feed.status === "loading" ? "Reading the vault's chain logs…" : "The vault's history couldn't be loaded right now. Figures appear as soon as it's back."}
        </span>
      </section>
    );
  }
  const s = feed.summary;
  const explorer = explorerOf(s);
  return (
    <section className="rcard" data-testid="vault-activity">
      <div className="rcard-pad stack gap-12">
        <div className="row between wrap gap-8">
          <h2 className="rcard-title">On-chain record</h2>
          <span className="tiny mono">
            {chainLabel(s.chainId)} · block {s.lastBlock.toLocaleString("en-US")}
            {s.synced === false ? " · catching up" : ""}
          </span>
        </div>
        <div className="detail-two" style={{ gap: 20 }}>
          <VaultTotals s={s} />
          <div className="stack gap-8">
            <span className="stat-label">Contract</span>
            <span className="mono tiny" style={{ wordBreak: "break-all" }}>
              {explorer ? (
                <a className="link-primary" href={`${explorer}/address/${s.vault}`} target="_blank" rel="noreferrer">
                  {s.vault}
                </a>
              ) : (
                s.vault
              )}
            </span>
            <span className="stat-label" style={{ marginTop: 6 }}>Last NAV report</span>
            <span className="small">{s.live.lastNavUpdate ? when(s.live.lastNavUpdate) : "none yet"}</span>
            {s.pendingWithdrawals.length > 0 && (
              <>
                <span className="stat-label" style={{ marginTop: 6 }}>Withdrawals in progress</span>
                {s.pendingWithdrawals.map((p) => (
                  <span key={p.investor} className="tiny mono">
                    {short(p.investor)} · {fmt(usdg(p.shares))} shares · {p.state === "Settling" ? "positions closed, settling" : "closing positions"}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th className="hide-sm">Investor</th>
              <th className="right">Amount</th>
              <th className="right">Tx</th>
            </tr>
          </thead>
          <tbody>
            {s.recent.slice(0, 15).map((e) => (
              <tr key={`${e.txHash}-${e.type}-${e.block}`} data-testid="vault-event">
                <td className="tiny mono" style={{ whiteSpace: "nowrap" }}>{when(e.t)}</td>
                <td className="small">{EVENT_LABEL[e.type] ?? e.type}</td>
                <td className="tiny mono hide-sm">{short(e.investor)}</td>
                <td className="right mono-num small">{e.amount && e.type !== "LimitsChanged" ? `${fmt(usdg(e.amount))}` : e.shares ? `${fmt(usdg(e.shares))} sh` : "—"}</td>
                <td className="right tiny mono">
                  {explorer ? (
                    <a className="link-primary" href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                      {short(e.txHash)}
                    </a>
                  ) : (
                    short(e.txHash)
                  )}
                </td>
              </tr>
            ))}
            {s.recent.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: 24 }}>
                  <span className="small">No vault events yet.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mono-note rcard-pad" style={{ margin: 0 }}>
        Read from the vault&apos;s event logs and its USDG transfers. Amounts in USDG. Nothing on this card is estimated.
      </p>
    </section>
  );
}
