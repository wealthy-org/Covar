"use client";

/**
 * Recorded treasury figures (no model numbers): itemised fee receipts, the
 * liabilities-vs-revenue split and the vault's reserve position, all read from
 * the chain (indexer + direct RPC) and the credits ledger.
 */
import { useEffect, useState } from "react";
import { CHAINS, EXPECTED_CHAIN_ID, VAULT_ADDRESS, readVault } from "@/lib/chain";
import { SEL, calldata, encAddress, ethCall, readV2 } from "@/lib/vaultTx";
import { cx, timeAgo } from "@/lib/format";
import { usdg, type VaultSummary } from "@/lib/vaultAgent";

export interface CreditStats {
  ok: boolean;
  soldUsd: number;
  topups: number;
  buyers: number;
  consumedUsd: number;
  calls: number;
  providerCostUsd: number;
  appFeeUsd: number;
  outstandingUsd: number;
  error?: string;
}

export function useCreditStats() {
  const [s, setS] = useState<CreditStats | null>(null);
  useEffect(() => {
    fetch("/api/credits/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then(setS)
      .catch((e) => setS({ ok: false, error: String(e) } as CreditStats));
  }, []);
  return s;
}

const f4 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const explorer = EXPECTED_CHAIN_ID === 31337 ? null : CHAINS[EXPECTED_CHAIN_ID].explorer;

/* ------------------------------------------------------------------ fee receipts */

type Receipt = { t: number | null; txHash: string; amount: number; kind: "deposit" | "withdrawal" | "fee" };

export function FeeReceipts({ s }: { s: VaultSummary | null }) {
  const [fallback, setFallback] = useState<Receipt[] | null>(null);
  const fromIndexer: Receipt[] | null = s?.feeReceipts ? s.feeReceipts.map((r) => ({ t: r.t, txHash: r.txHash, amount: usdg(r.amount), kind: r.kind })) : null;
  const feeTo = s?.live.feeRecipient?.toLowerCase();

  // an indexer older than the feeReceipts field: list the same transfers from the explorer instead
  useEffect(() => {
    if (fromIndexer || !explorer || !VAULT_ADDRESS || !feeTo) return;
    let off = false;
    fetch(`${explorer}/api/v2/addresses/${VAULT_ADDRESS}/token-transfers?type=ERC-20&filter=from`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        type T = { to?: { hash: string }; total?: { value: string; decimals?: string }; transaction_hash?: string; tx_hash?: string; timestamp?: string; method?: string | null };
        const items = ((d?.items ?? []) as T[]).filter((t) => t.to?.hash.toLowerCase() === feeTo);
        setFallback(
          items.slice(0, 20).map((t) => ({
            t: t.timestamp ? Date.parse(t.timestamp) / 1000 : null,
            txHash: t.transaction_hash ?? t.tx_hash ?? "",
            amount: Number(t.total?.value ?? 0) / 10 ** Number(t.total?.decimals ?? 6),
            kind: t.method === "deposit" ? "deposit" : t.method === "settleWithdrawal" ? "withdrawal" : "fee",
          }))
        );
      })
      .catch(() => !off && setFallback([]));
    return () => {
      off = true;
    };
  }, [fromIndexer, feeTo]);

  const rows = fromIndexer ?? fallback;
  return (
    <div className="stack gap-8" data-testid="fee-receipts">
      <div className="row between wrap gap-8">
        <span className="small strong">Fee receipts · vault → fee recipient</span>
        <span className="tiny">{fromIndexer ? "from the indexer" : fallback ? "from the explorer" : ""}</span>
      </div>
      {!rows ? (
        <span className="tiny">Reading transfers…</span>
      ) : rows.length === 0 ? (
        <span className="tiny">No fee transfers yet. The first deposit creates one.</span>
      ) : (
        <div className="table-wrap panel">
          <table className="table table-min">
            <thead>
              <tr>
                <th>When</th>
                <th>Charged on</th>
                <th className="right">Amount</th>
                <th className="right">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((r) => (
                <tr key={r.txHash + r.amount} data-testid="fee-receipt">
                  <td className="tiny nowrap">{r.t ? timeAgo(new Date(r.t * 1000).toISOString()) : "—"}</td>
                  <td>
                    <span className={cx("badge", r.kind === "deposit" ? "badge-blue" : r.kind === "withdrawal" ? "badge-amber" : "badge-outline")}>
                      {r.kind === "deposit" ? "deposit fee" : r.kind === "withdrawal" ? "withdrawal fee" : "fee"}
                    </span>
                  </td>
                  <td className="right mono-num small pos">+{f4(r.amount)} USDG</td>
                  <td className="right">
                    {explorer ? (
                      <a className="mono tiny link-primary" href={`${explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer noopener">
                        {r.txHash.slice(0, 8)}…{r.txHash.slice(-4)} ↗
                      </a>
                    ) : (
                      <span className="mono tiny">
                        {r.txHash.slice(0, 8)}…{r.txHash.slice(-4)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ reserves (direct RPC) */

interface ReserveRead {
  cash: number;
  reported: number;
  allocated: number | null;
  reserved: number | null;
  free: number | null;
  treasuryBal: number;
  feeRecipient: string;
}

function useReserves(): { r: ReserveRead | null; err: string | null } {
  const [r, setR] = useState<ReserveRead | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!VAULT_ADDRESS) return;
    let off = false;
    const load = async () => {
      try {
        const v = await readVault(VAULT_ADDRESS!);
        const [cashHex, treasHex, v2] = await Promise.all([
          ethCall(v.asset, calldata(SEL.balanceOf, encAddress(VAULT_ADDRESS!)), EXPECTED_CHAIN_ID),
          ethCall(v.asset, calldata(SEL.balanceOf, encAddress(v.feeRecipient)), EXPECTED_CHAIN_ID),
          readV2(VAULT_ADDRESS!, EXPECTED_CHAIN_ID),
        ]);
        const d = 10 ** v.assetDecimals;
        if (!off)
          setR({
            cash: Number(BigInt(cashHex)) / d,
            reported: v.reportedAssets,
            allocated: v2 ? Number(v2.totalAllocated) / d : null,
            reserved: v2 ? Number(v2.reservedForClaims) / d : null,
            free: v2 ? Number(v2.availableLiquidity) / d : null,
            treasuryBal: Number(BigInt(treasHex)) / d,
            feeRecipient: v.feeRecipient,
          });
        if (!off) setErr(null);
      } catch (e) {
        if (!off) setErr((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, []);
  return { r, err };
}

/* ------------------------------------------------------------------ balance sheet + reserves */

export function BalanceSheet({ s, credits }: { s: VaultSummary | null; credits: CreditStats | null }) {
  const { r, err } = useReserves();
  if (!VAULT_ADDRESS) return null;

  const investorAssets = r?.reported ?? (s ? usdg(s.live.reportedAssets ?? s.reportedAssets) : null);
  const owedClaims = r?.reserved ?? null;
  const unusedCredits = credits?.ok ? credits.outstandingUsd : null;
  const liabilities: [string, number | null, string][] = [
    ["Investor money in the vault", investorAssets, "reported assets — owed to share holders"],
    ["Settled withdrawals not yet claimed", owedClaims, "reserved in the vault for claims"],
    ["Unused Copilot credits", unusedCredits, "prepaid by users"],
  ];
  const vaultFees = s ? usdg(s.totals.feesToTreasury) : null;
  const appFee = credits?.ok ? credits.appFeeUsd : null;
  const revenue: [string, number | null, string][] = [
    ["Vault fees received", vaultFees, "deposit + withdrawal fees, on-chain"],
    ["Copilot application fee", appFee, "the only revenue part of credits"],
  ];
  const sum = (xs: [string, number | null, string][]) => xs.reduce((a, [, v]) => a + (v ?? 0), 0);
  const L = sum(liabilities);
  const R = sum(revenue);
  const total = L + R || 1;

  return (
    <>
      <section className="rcard rcard-pad stack gap-14" data-testid="balance-sheet">
        <div className="row between wrap gap-8">
          <h2 className="rcard-title">Owed to others vs platform revenue</h2>
          <span className="pill pill-green">recorded</span>
        </div>
        <div className="split-bar" aria-label="Liabilities versus revenue">
          <span style={{ width: `${(L / total) * 100}%`, background: "#9AA3B5" }} title={`Liabilities ${f4(L)} USDG`} />
          <span style={{ width: `${Math.max((R / total) * 100, R > 0 ? 1.5 : 0)}%`, background: "#3B5BDB" }} title={`Revenue ${f4(R)} USDG`} />
        </div>
        <div className="detail-two" style={{ gap: 20 }}>
          <div>
            <div className="row between" style={{ marginBottom: 4 }}>
              <span className="stat-label">Liabilities · not ours</span>
              <span className="mono-num small" data-testid="liabilities-total">{f4(L)} USDG</span>
            </div>
            {liabilities.map(([k, v, note]) => (
              <div key={k} className="kv">
                <span className="kv-k">
                  {k}
                  <span className="tiny" style={{ display: "block" }}>{note}</span>
                </span>
                <span className="kv-v mono-num">{v === null ? "—" : f4(v)}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="row between" style={{ marginBottom: 4 }}>
              <span className="stat-label" style={{ color: "var(--primary)" }}>Platform revenue</span>
              <span className="mono-num small" data-testid="revenue-total">{f4(R)} USDG</span>
            </div>
            {revenue.map(([k, v, note]) => (
              <div key={k} className="kv">
                <span className="kv-k">
                  {k}
                  <span className="tiny" style={{ display: "block" }}>{note}</span>
                </span>
                <span className="kv-v mono-num">{v === null ? "—" : f4(v)}</span>
              </div>
            ))}
            <span className="tiny">
              Provider cost of AI calls ({credits?.ok ? `${f4(credits.providerCostUsd)} USD` : "—"}) is passed through to the model provider and is
              not revenue.
            </span>
          </div>
        </div>
      </section>

      <section className="rcard rcard-pad stack gap-12" data-testid="reserves">
        <div className="row between wrap gap-8">
          <h2 className="rcard-title">Reserves · read from the chain</h2>
          <span className="tiny">refreshed every 30 s · direct RPC</span>
        </div>
        {err && !r && <span className="tiny neg">Couldn&apos;t read the vault: {err}</span>}
        <div className="joined-stats" style={{ ["--cols" as string]: 4 }}>
          <div>
            <span className="stat-label">USDG held by the vault</span>
            <span className="js-v" data-testid="reserve-cash">{r ? f4(r.cash) : "…"}</span>
            <span className="tiny">balanceOf(vault) on the USDG contract</span>
          </div>
          <div>
            <span className="stat-label">Reserved for claims</span>
            <span className="js-v">{r ? (r.reserved === null ? "n/a" : f4(r.reserved)) : "…"}</span>
            <span className="tiny">settled, waiting for the investor</span>
          </div>
          <div>
            <span className="stat-label">Free liquidity</span>
            <span className="js-v">{r ? (r.free === null ? "n/a" : f4(r.free)) : "…"}</span>
            <span className="tiny">cash minus reserved claims</span>
          </div>
          <div>
            <span className="stat-label">At the trading venue</span>
            <span className="js-v">{r ? (r.allocated === null ? "n/a" : f4(r.allocated)) : "…"}</span>
            <span className="tiny">allocated by the operator</span>
          </div>
        </div>
        {r && (
          <div className="stack gap-4">
            <div className="kv">
              <span className="kv-k">Cash + venue vs reported assets</span>
              <span className="kv-v mono-num" style={{ color: r.cash + (r.allocated ?? 0) + 1e-9 >= r.reported + (r.reserved ?? 0) ? "var(--positive)" : "var(--warning)" }}>
                {f4(r.cash + (r.allocated ?? 0))} vs {f4(r.reported + (r.reserved ?? 0))} USDG
              </span>
            </div>
            <div className="kv">
              <span className="kv-k">Fee recipient balance (treasury wallet)</span>
              <span className="kv-v mono-num">
                {f4(r.treasuryBal)} USDG ·{" "}
                {explorer ? (
                  <a className="link-primary mono" href={`${explorer}/address/${r.feeRecipient}`} target="_blank" rel="noreferrer noopener">
                    {r.feeRecipient.slice(0, 6)}…{r.feeRecipient.slice(-4)} ↗
                  </a>
                ) : (
                  <span className="mono">
                    {r.feeRecipient.slice(0, 6)}…{r.feeRecipient.slice(-4)}
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
        <span className="mono-note">
          The operator keeps at least 20% of vault assets as cash for withdrawals and only moves the rest to the trading account
          set by the owner. Reserved claim money cannot be allocated — the contract refuses it.
        </span>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ credits explainer */

export function CreditsHowItWorks({ reserveUsd, appFeePct }: { reserveUsd?: number | null; appFeePct?: number | null }) {
  const steps: [string, string][] = [
    ["Top up with USDG", "You send USDG from your own wallet to the credits address. 1 USDG = $1 of credits."],
    [
      "The server checks the receipt",
      "It reads the transaction receipt from Robinhood Chain itself: confirmed, the USDG contract, sent from your signed-in wallet, to the credits address. Each transaction is credited once — submitting it again adds nothing.",
    ],
    [
      "A call must be affordable before it runs",
      `Before each AI call your balance must cover a worst-case call${reserveUsd ? ` (currently $${reserveUsd.toFixed(4)})` : ""}. Calls run one at a time per wallet, so two calls can't both spend the same balance.`,
    ],
    [
      "You pay the real usage",
      `Afterwards only the actual tokens are charged${appFeePct != null ? ` (+${appFeePct}% app fee)` : ""}. Failed calls are free; the balance can't go below zero.`,
    ],
  ];
  return (
    <div className="credits-how" data-testid="credits-how">
      <span className="stat-label">How credits work · no over-spending</span>
      <ol>
        {steps.map(([t, b], i) => (
          <li key={t}>
            <span className="wd-dot">{i + 1}</span>
            <span className="stack" style={{ gap: 2 }}>
              <span className="small strong" style={{ color: "var(--ink)" }}>
                {t}
              </span>
              <span className="tiny">{b}</span>
            </span>
          </li>
        ))}
      </ol>
      <span className="tiny">Stops, exits and the emergency close never need credits — an empty balance only pauses the AI review.</span>
    </div>
  );
}
