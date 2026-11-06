import Link from "next/link";
import { DocsToc } from "@/components/DocsToc";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "network", label: "Network & deployment" },
  { id: "provenance", label: "Data provenance" },
  { id: "fees", label: "Fees & economics" },
  { id: "risk", label: "Risk controls" },
  { id: "custody", label: "Custody & authority" },
  { id: "execution", label: "Execution plane" },
  { id: "recovery", label: "Failure & recovery" },
  { id: "parity", label: "Parity register" },
  { id: "open", label: "Open decisions" },
];

export default function DocsPage() {
  return (
    <div className="wrap-md page-pad">
      <div className="page-head docs-head">
        <span className="label-dot">Docs</span>
        <h1 className="page-title">Covar operator &amp; user documentation</h1>
        <p className="page-sub">
          Covar is built as a direct functional mirror of the reference product ({'"'}Sharpe{'"'}) under our own identity, with
          the approved muted-cobalt palette. This page documents what the current build actually does — including what it
          does not do yet.
        </p>
      </div>

      <div className="docs-grid">
        <aside className="docs-side">
          <DocsToc sections={SECTIONS} />
        </aside>

        <article className="prose docs-article">
          <h2 id="overview">Overview</h2>
          <p>
            A creator describes a strategy, reviews the typed rule set, backtests it, runs it in practice and publishes a
            version. An investor browses agents, reads the record and its provenance, funds a vault, and can request and
            claim a withdrawal. Drafts and published versions are separate objects; editing a draft never silently alters
            what investors fund.
          </p>

          <div className="docs-kv">
            <div><span>Network</span><span>Testnet 46630</span></div>
            <div><span>Contracts compiled</span><span>2 · suite green</span></div>
            <div><span>Contracts deployed</span><span>None</span></div>
            <div><span>Real value at risk</span><span>$0</span></div>
          </div>
          <p>
            The web surface, the four-process execution plane and the vault indexer are reviewable now. The venue is a paper
            matcher and contracts exist only on the local rehearsal chain — zero contracts on Robinhood Chain. See{" "}
            <Link className="link-primary" href="/chain">Chain status</Link> or{" "}
            <Link className="link-primary" href="/studio?new=1">open Studio</Link>.
          </p>

          <h2 id="network">Network &amp; deployment</h2>
          <ul>
            <li>Testnet — chain ID <span className="mono">46630</span>, RPC <span className="mono">https://rpc.testnet.chain.robinhood.com</span>, faucet funds.</li>
            <li>Mainnet — chain ID <span className="mono">4663</span>, RPC <span className="mono">https://rpc.mainnet.chain.robinhood.com</span> (rate limited; production must use a provider).</li>
            <li>USDG <span className="mono">0x5fc5…d168</span> (6 decimals) · WETH <span className="mono">0x0Bd7…AD73</span> (18 decimals) — re-verify on-chain and against the current docs before any deployment.</li>
          </ul>
          <p>
            <strong>Mandatory order:</strong> every contract deploys to testnet first → the full suite and acceptance
            criteria pass → complete deposit → trade → withdraw flows pass including failure cases → only then mainnet,
            starting with a small controlled amount.
          </p>
          <h3>Verified on-chain (4 Nov 2026)</h3>
          <ul>
            <li><span className="mono">46630</span> answers as <span className="mono">0xb626</span>; <span className="mono">4663</span> as <span className="mono">0x1237</span> (Arbitrum Nitro).</li>
            <li>USDG <span className="mono">0x5fc5…d168</span> has bytecode on <strong>mainnet only</strong>: symbol <span className="mono">USDG</span>, 6 decimals. WETH <span className="mono">0x0Bd7…AD73</span>: symbol <span className="mono">WETH</span>, 18 decimals.</li>
            <li><strong>The brief&apos;s token table is mainnet.</strong> On testnet 46630 both addresses return empty bytecode — a deposit into a vault pointed at them would fail, and several impostor tokens with the same ticker exist there. The testnet collateral address must be confirmed by the owner against the official testnet token page before deployment; the deploy script refuses an address without bytecode or with the wrong decimals.</li>
          </ul>
          <p>
            Current deployment state, live RPC status and the gate checklist are on{" "}
            <Link className="link-primary" href="/chain">Chain status</Link>.
          </p>
          <div className="notice notice-warn" style={{ margin: "14px 0" }}>
            <div>
              Robinhood Chain RPC endpoints are frequently blocked by local ISPs (notably in Indonesia). Enable a VPN
              before treating an RPC failure as an endpoint problem.
            </div>
          </div>

          <h2 id="provenance">Data provenance</h2>
          <p>Five record types, never blended into one number:</p>
          <ul>
            <li><strong>Historical backtest</strong> — pinned dataset, explicit fees/slippage/funding, reproducible seed. Never shown as live performance.</li>
            <li><strong>Practice</strong> — isolated ledger, simulated fills. Practise marks follow the live feed (Hyperliquid perp mids, Coinbase spot fallback) whenever it is reachable; when it is not, the session says &quot;simulated&quot; and keeps the simulated wave. Fills are always simulated.</li>
            <li><strong>Test exchange</strong> — real orders on testnet with faucet funds. Not comparable to real money.</li>
            <li><strong>Real money</strong> — reconciled fills, fees and funding.</li>
            <li><strong>Vault share price</strong> — on-chain NAV per share with deposit/withdraw events.</li>
          </ul>
          <p>
            Ranking uses the real-money record only, and only after 30 days. Young agents display their age instead of an
            annualised figure. Creator histories keep unsuccessful live agents public.
          </p>

          <h2 id="fees">Fees &amp; economics</h2>
          <ul>
            <li>Deposits and withdrawals: 1% + 0.10 USDG, with separate treatment for the creator{'"'}s own funds.</li>
            <li>Creator fee: up to 20% of the profit of each winning trade, split 80/20 creator/platform.</li>
            <li>Losing trades are not netted against winning-trade fees.</li>
            <li>Copilot usage: provider cost plus an application fee; credits are reserved then reconciled.</li>
          </ul>
          <p>
            Capital flows, escrowed withdrawals and unused credits are liabilities under management, not revenue. See{" "}
            <Link className="link-primary" href="/economics">Economics</Link> and{" "}
            <Link className="link-primary" href="/treasury">Treasury</Link>.
          </p>

          <h2 id="risk">Risk controls</h2>
          <ul>
            <li>Platform ceiling: 5x leverage, 10% daily loss pause, 25% drawdown emergency stop. Agents may be tighter.</li>
            <li>Every order is checked by the risk service independently of Copilot output and strategy code.</li>
            <li>Loss boundaries are triggers, not guarantees of maximum realised loss during gaps or execution failure.</li>
            <li>AI-credit exhaustion never disables stops, exits or the emergency close path.</li>
            <li>Server-side checks are not on-chain guarantees; the distinction is stated on the agent page.</li>
          </ul>

          <h2 id="custody">Custody &amp; authority</h2>
          <ul>
            <li>Vault shares are minted against a NAV with a staleness window; stale NAVs are rejected, not priced.</li>
            <li>Withdrawals: request → close positions → settle → claim. Trading authority cannot redirect a withdrawal to an operator address.</li>
            <li>Admin model: <strong>single wallet</strong>, no multisig, same wallet on testnet and mainnet. No threshold approval delay exists; any required delay must be a contract-level timelock.</li>
            <li>Accepted risk: a leaked or lost admin key compromises treasury, fee recipient and upgrade authority. This is documented as deliberate, not as an oversight.</li>
            <li>Our operational keys and recipients are independent of the reference product; reference contracts are never reused.</li>
          </ul>

          <h2 id="execution">Execution plane</h2>
          <p>
            Orders cannot be sent from the web app. An intent is accepted by the execution service, written to an
            append-only journal, checked by the risk service, signed by an isolated signer, and only then handed to the
            venue. The four run as separate processes with separate journals:
          </p>
          <ul>
            <li><span className="mono">execution :4010</span> — order state machine, journal replay, reconciliation. Refuses new intents until reconciliation has completed.</li>
            <li><span className="mono">risk :4012</span> — seven named checks, platform ceilings, <span className="mono">normal / close_only / halted</span>. Cannot be bypassed by Copilot output or strategy code.</li>
            <li><span className="mono">signer :4013</span> — allowlisted markets only; refuses any request carrying a withdrawal-style <span className="mono">destination</span> field. It cannot move funds.</li>
            <li><span className="mono">exchange :4011</span> — the venue boundary. In this build it is a deterministic paper matcher; the interface is what a real venue adapter must satisfy.</li>
          </ul>
          <p>
            State transitions: <span className="mono">queued → signed → submitting → submitted → filled</span>, with{" "}
            <span className="mono">risk_rejected</span> and <span className="mono">failed</span> terminal.{" "}
            <span className="mono">submitting</span> is journaled <em>before</em> the venue call: if the process dies in
            that window, the restart reconciles against the venue and adopts the order it already accepted instead of
            resubmitting. Replayed intents are deduplicated by <span className="mono">intentId</span>, and the venue
            deduplicates by <span className="mono">clientOrderId</span> — including across its own restarts.
          </p>
          <p>
            An operator pause holds new risk (orders stay <span className="mono">queued</span>, they are not destroyed) and
            exits keep flowing. See <span className="mono">docs/EXECUTION_PLANE.md</span> for the runbook, the fault
            injection used in the test, and the evidence behind these claims.
          </p>

          <h2 id="recovery">Failure &amp; recovery</h2>
          <ul>
            <li>Order intents are durable and idempotent; a restart reconciles exchange state before placing anything new.</li>
            <li>Disconnect or provider outage: fallback to rules-only, decisions labelled <span className="mono">rules_only</span>.</li>
            <li>Risk pause (daily loss / drawdown) puts the agent in close-only mode while exits remain enabled.</li>
            <li>Wind-down: deposits close, withdrawals and claims stay open.</li>
            <li>Indexer handles confirmations and reorg rollback/replay per deployment.</li>
          </ul>

          <h2 id="parity">Parity register</h2>
          <p>
            Each reference screen/state is tracked with: reference URL, screen, observed behaviour, dependency, our
            implementation, acceptance evidence and unresolved question. Current status of the build in this workspace:
          </p>
          <div className="table-wrap panel" style={{ margin: "12px 0" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Area</th>
                  <th>Route</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Landing", "/", "Implemented (cobalt palette, reference hierarchy)"],
                  ["Discover", "/explore", "Implemented · filter/sort/provenance labels"],
                  ["Studio", "/studio", "Implemented · create/edit/practice/operate"],
                  ["Builder", "/studio?new=1", "Implemented · chat → rules → diff → validation → backtest"],
                  ["Agent detail", "/agents/[id]", "Implemented · record, decisions, rules, versions, vault"],
                  ["Creator record", "/creators/[id]", "Implemented · includes unsuccessful agents"],
                  ["My money", "/portfolio", "Implemented · holdings, flows, pending, claim"],
                  ["Economics", "/economics", "Implemented · calculator + explicit pending features"],
                  ["Treasury", "/treasury", "Implemented · accounting split, zero-burn stated"],
                  ["Chain status", "/chain", "Implemented · live RPC + on-chain vault read, gates"],
                  ["Contracts", "—", "Compiled + 18-assertion suite passing (local EVM); not deployed"],
                  ["Exchange adapter", "—", "Not implemented in this build"],
                  ["Indexer", "—", "Not implemented in this build"],
                ].map(([a, r, s]) => (
                  <tr key={a}>
                    <td className="strong">{a}</td>
                    <td className="mono tiny">{r}</td>
                    <td className="small">{s}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 id="open">Open decisions</h2>
          <ul>
            <li>Domain, logo, social handles and protocol-token identifiers.</li>
            <li>Production fee recipients and privileges; operational budget and provider billing accounts.</li>
            <li>Whether an agent token is in scope for this release (currently recorded as pending, not built).</li>
            <li>Final parameter table for rounding, exemption cases and charging time.</li>
          </ul>
        </article>

      </div>
    </div>
  );
}
