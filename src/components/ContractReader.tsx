"use client";

/**
 * Generic "Read contract" panel for the deployed CovarVault — the same view
 * functions an explorer exposes, called straight against the chain (the wallet's
 * RPC when it is on the right network, else the public RPC). Read-only: nothing
 * here can send a transaction.
 */
import { useState } from "react";
import { Interface } from "ethers";
import { EXPECTED_CHAIN_ID } from "@/lib/chain";
import { ethCall, explainError } from "@/lib/vaultTx";
import { cx } from "@/lib/format";

type Unit = "asset" | "shares" | "wad" | "bps" | "time" | "seconds" | "plain" | "state";

interface ReadFn {
  sig: string;
  /** how to render each output, in order */
  units: Unit[];
  note?: string;
  v2?: boolean;
}

const READS: ReadFn[] = [
  { sig: "function navPerShare() view returns (uint256)", units: ["wad"], note: "USDG per share, 18-decimal fixed point" },
  { sig: "function reportedAssets() view returns (uint256)", units: ["asset"], note: "last NAV the operator reported" },
  { sig: "function totalShares() view returns (uint256)", units: ["shares"] },
  { sig: "function lastNavUpdate() view returns (uint64)", units: ["time"] },
  { sig: "function maxNavAge() view returns (uint64)", units: ["seconds"] },
  { sig: "function owner() view returns (address)", units: ["plain"] },
  { sig: "function operator() view returns (address)", units: ["plain"] },
  { sig: "function feeRecipient() view returns (address)", units: ["plain"] },
  { sig: "function asset() view returns (address)", units: ["plain"] },
  { sig: "function depositFeeBps() view returns (uint256)", units: ["bps"] },
  { sig: "function depositFeeFlat() view returns (uint256)", units: ["asset"] },
  { sig: "function withdrawalFeeBps() view returns (uint256)", units: ["bps"] },
  { sig: "function withdrawalFeeFlat() view returns (uint256)", units: ["asset"] },
  { sig: "function minDeposit() view returns (uint256)", units: ["asset"] },
  { sig: "function depositsPaused() view returns (bool)", units: ["plain"] },
  { sig: "function closeOnly() view returns (bool)", units: ["plain"] },
  { sig: "function maxTotalAssets() view returns (uint256)", units: ["asset"], v2: true },
  { sig: "function maxDepositPerTx() view returns (uint256)", units: ["asset"], v2: true },
  { sig: "function tradingAccount() view returns (address)", units: ["plain"], v2: true },
  { sig: "function totalAllocated() view returns (uint256)", units: ["asset"], v2: true },
  { sig: "function reservedForClaims() view returns (uint256)", units: ["asset"], v2: true },
  { sig: "function availableLiquidity() view returns (uint256)", units: ["asset"], v2: true },
  { sig: "function requestCount() view returns (uint256)", units: ["plain"] },
  { sig: "function balanceOf(address account) view returns (uint256)", units: ["shares"], note: "vault shares held by an address" },
  {
    sig: "function requests(address investor) view returns (address investor, uint256 shares, uint256 settledAssets, uint64 requestedAt, uint64 settledAt, uint8 state)",
    units: ["plain", "shares", "asset", "time", "time", "state"],
    note: "withdrawal request of an address",
  },
  { sig: "function previewDeposit(uint256 assets) view returns (uint256 net, uint256 shares)", units: ["asset", "shares"], note: "input in base units (6 decimals: 10 USDG = 10000000)" },
  { sig: "function convertToAssets(uint256 shares) view returns (uint256)", units: ["asset"], note: "input in base units (6 decimals)" },
];

const iface = new Interface(READS.map((r) => r.sig));
const STATES = ["None", "ClosingPositions", "Settling", "Claimable", "Claimed"];

function fmtFixed(v: bigint, decimals: number, places: number) {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = (a % base).toString().padStart(decimals, "0").slice(0, places);
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${places ? `.${frac}` : ""}`;
}

function render(v: unknown, unit: Unit, sym: string): string {
  if (typeof v === "bigint") {
    switch (unit) {
      case "asset":
        return `${v.toString()}  (${fmtFixed(v, 6, 6)} ${sym})`;
      case "shares":
        return `${v.toString()}  (${fmtFixed(v, 6, 6)} shares)`;
      case "wad":
        return `${v.toString()}  (${fmtFixed(v, 18, 6)})`;
      case "bps":
        return `${v.toString()} bps  (${(Number(v) / 100).toFixed(2)}%)`;
      case "time":
        return v === 0n ? "0  (never)" : `${v.toString()}  (${new Date(Number(v) * 1000).toLocaleString("en-GB")})`;
      case "seconds":
        return `${v.toString()} s  (${(Number(v) / 3600).toFixed(1)} h)`;
      case "state":
        return `${v.toString()}  (${STATES[Number(v)] ?? "?"})`;
      default:
        return v.toString();
    }
  }
  return String(v);
}

export function ContractReader({ address, sym = "USDG" }: { address: string; sym?: string }) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [out, setOut] = useState<Record<string, { ok: boolean; lines: string[] }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const query = async (r: ReadFn) => {
    const f = iface.getFunction(r.sig.split("function ")[1].split("(")[0])!;
    setBusy(f.name);
    try {
      const args = f.inputs.map((i) => {
        const raw = (inputs[`${f.name}.${i.name}`] ?? "").trim();
        if (!raw) throw new Error(`Enter ${i.name}`);
        return i.type === "address" ? raw : BigInt(raw);
      });
      const data = iface.encodeFunctionData(f, args);
      const res = await ethCall(address, data, EXPECTED_CHAIN_ID);
      const decoded = iface.decodeFunctionResult(f, res);
      const lines = f.outputs.map((o, k) => `${o.name || (f.outputs.length > 1 ? `out${k}` : "")}${o.name || f.outputs.length > 1 ? ": " : ""}${render(decoded[k], r.units[k] ?? "plain", sym)}`);
      setOut((m) => ({ ...m, [f.name]: { ok: true, lines } }));
    } catch (e) {
      setOut((m) => ({ ...m, [f.name]: { ok: false, lines: [explainError(e)] } }));
    } finally {
      setBusy(null);
    }
  };

  const readAll = async () => {
    // only the functions without inputs; ones that need an address or amount wait for the user
    for (const r of READS) if (iface.getFunction(r.sig.split("function ")[1].split("(")[0])!.inputs.length === 0) await query(r);
  };

  const shown = READS.filter((r) => !filter || r.sig.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="card card-pad stack gap-12" data-testid="contract-reader">
      <div className="row between wrap gap-8">
        <div className="stack" style={{ gap: 2 }}>
          <span className="small strong">Read contract</span>
          <span className="tiny">Every public view function of the vault, called live. No wallet or gas needed.</span>
        </div>
        <div className="row gap-8">
          <input className="input" style={{ width: 160, height: 32 }} placeholder="Filter functions" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter functions" />
          <button className="btn btn-secondary btn-sm" onClick={() => void readAll()} disabled={busy !== null} data-testid="read-all">
            Read all
          </button>
        </div>
      </div>
      <div className="reader-list">
        {shown.map((r) => {
          const f = iface.getFunction(r.sig.split("function ")[1].split("(")[0])!;
          const res = out[f.name];
          return (
            <div key={f.name} className="reader-row" data-testid={`read-${f.name}`}>
              <div className="row between gap-8 wrap">
                <span className="mono small" style={{ color: "var(--ink)" }}>
                  {f.name}
                  <span className="muted">({f.inputs.map((i) => `${i.type} ${i.name}`).join(", ")})</span>
                  {r.v2 && <span className="tiny muted"> · v2</span>}
                </span>
                <div className="row gap-6">
                  {f.inputs.map((i) => (
                    <input
                      key={i.name}
                      className="input mono"
                      style={{ height: 28, width: i.type === "address" ? 220 : 140, fontSize: 11.5 }}
                      placeholder={i.type === "address" ? "0x…" : `${i.name} (base units)`}
                      value={inputs[`${f.name}.${i.name}`] ?? ""}
                      onChange={(e) => setInputs((m) => ({ ...m, [`${f.name}.${i.name}`]: e.target.value }))}
                      aria-label={`${f.name} ${i.name}`}
                    />
                  ))}
                  <button className="btn btn-secondary btn-sm" onClick={() => void query(r)} disabled={busy !== null}>
                    {busy === f.name ? "…" : "Query"}
                  </button>
                </div>
              </div>
              {r.note && <span className="tiny">{r.note}</span>}
              {res && (
                <div className={cx("reader-out mono", !res.ok && "neg")} data-testid="read-result">
                  {res.lines.map((l, k) => (
                    <div key={k}>{l}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
