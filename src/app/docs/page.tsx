import Link from "next/link";
import { DocsToc } from "@/components/DocsToc";
import { CHAINS, EXPECTED_CHAIN_ID, IS_MAINNET, VAULT_ADDRESS, explorerAddress } from "@/lib/chain";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "network", label: "Network & contract" },
  { id: "investing", label: "Investing in a vault" },
  { id: "provenance", label: "Kinds of records" },
  { id: "fees", label: "Fees & economics" },
  { id: "credits", label: "Copilot credits" },
  { id: "risk", label: "Risk controls" },
  { id: "custody", label: "Custody & keys" },
  { id: "execution", label: "How orders run" },
  { id: "recovery", label: "When something fails" },
];

export default function DocsPage() {
  const chain = CHAINS[EXPECTED_CHAIN_ID];
  return (
    <div className="wrap-md page-pad">
      <div className="page-head docs-head">
        <span className="label-dot">Docs</span>
        <h1 className="page-title">How Covar works</h1>
        <p className="page-sub">
          What Covar does with your strategy and your money, what it charges, and the limits it enforces — including what
          it does not do.
        </p>
      </div>

      <div className="docs-grid">
        <aside className="docs-side">
          <DocsToc sections={SECTIONS} />
        </aside>

        <article className="prose docs-article">
          <h2 id="overview">Overview</h2>
          <p>
            A creator describes a strategy in plain words, reviews the typed rule set, backtests it, practises it on live
            prices and publishes a version. An investor browses agents, reads the record and where it comes from, funds a
            vault, and can request and claim a withdrawal at any time. Drafts and published versions are separate: editing
            a draft never changes what investors have funded.
          </p>
          <div className="docs-kv">
            <div><span>Network</span><span>{chain.name} · {EXPECTED_CHAIN_ID}</span></div>
            <div><span>Collateral</span><span>USDG · 6 decimals</span></div>
            <div><span>Vault</span><span>{VAULT_ADDRESS ? "live" : "opening soon"}</span></div>
            <div><span>Custody</span><span>your own wallet</span></div>
          </div>
          <p>
            Start with <Link className="link-primary" href="/explore">Discover</Link>, or{" "}
            <Link className="link-primary" href="/studio?new=1">build an agent</Link>.
          </p>

          <h2 id="network">Network &amp; contract</h2>
          <ul>
            <li>
              {chain.name} — chain ID <span className="mono">{EXPECTED_CHAIN_ID}</span>, gas paid in {chain.gasToken}.
            </li>
            {VAULT_ADDRESS && (
              <li>
                Covar vault{" "}
                {EXPECTED_CHAIN_ID === 31337 ? (
                  <span className="mono">{VAULT_ADDRESS}</span>
                ) : (
                  <a className="link-primary mono" href={explorerAddress(VAULT_ADDRESS)} target="_blank" rel="noreferrer noopener">
                    {VAULT_ADDRESS} ↗
                  </a>
                )}
                . Its source code is published and verified, so anyone can check what it does.
              </li>
            )}
            <li>
              {IS_MAINNET
                ? "Collateral is USDG, the dollar stablecoin issued by Paxos (6 decimals). Only the contract address shown on Contract & network is the real token."
                : "This is a test network: USDG and ETH here have no value."}
            </li>
          </ul>
          <p>
            Live settings, the latest transactions and the safety rules built into the contract are on{" "}
            <Link className="link-primary" href="/chain">Contract &amp; network</Link>. If a page can&apos;t reach the
            network, some internet providers block the endpoint — try again or use another connection.
          </p>

          <h2 id="investing">Investing in a vault</h2>
          <ol>
            <li>
              <strong>Deposit.</strong> You approve USDG and deposit from your own wallet. The fee (1% + 0.10 USDG) is taken
              on the way in and you receive shares at the current vault price. The contract refuses the deposit if that price
              is stale.
            </li>
            <li>
              <strong>Request a withdrawal.</strong> Choose how many shares to redeem. Money does not leave at once: your share
              of any open positions is closed first, so other investors aren&apos;t hurt by a sudden exit.
            </li>
            <li>
              <strong>Settlement.</strong> The operator closes positions and settles your request at the vault price, minus
              the withdrawal fee (1% + 0.10 USDG). The amount is then reserved for you inside the vault.
            </li>
            <li>
              <strong>Claim.</strong> Press Claim USDG on My money. The contract always pays the wallet that made the request.
              Claims stay open even if deposits are paused.
            </li>
          </ol>

          <h2 id="provenance">Kinds of records</h2>
          <p>Every number on Covar says where it comes from. Different kinds are never blended or ranked against each other:</p>
          <ul>
            <li><strong>Backtest</strong> — a replay on historical data with fees, slippage and funding charged on every fill. Never shown as live performance.</li>
            <li>
              <strong>Practice</strong> — live market prices (Lighter on Robinhood Chain, with Hyperliquid and then Coinbase as
              labelled fallbacks) and pretend money. Fills are simulated and kept in a separate ledger that never touches My money.
            </li>
            <li><strong>On-chain vault</strong> — the share price, deposits and withdrawals read from the vault contract.</li>
          </ul>
          <p>Young agents show their age instead of an annualised return.</p>

          <h2 id="fees">Fees &amp; economics</h2>
          <ul>
            <li>Deposits and withdrawals: 1% + 0.10 USDG each, charged by the vault contract and sent straight to the fee recipient.</li>
            <li>Creator fee: up to 20% of the profit of each winning trade, set per agent and split 80/20 between creator and platform.</li>
            <li>Losing trades are not netted against winning-trade fees.</li>
          </ul>
          <p>
            Investor money, settled-but-unclaimed withdrawals and unused credits are money owed to others, never revenue.
            Every fee transfer is listed on <Link className="link-primary" href="/treasury">Treasury</Link>; try the numbers
            on <Link className="link-primary" href="/economics">Economics</Link>.
          </p>

          <h2 id="credits">Copilot credits</h2>
          <ul>
            <li>Top up by sending USDG from your wallet; 1 USDG = $1 of credits.</li>
            <li>The server reads the transaction receipt on-chain and credits each transaction exactly once.</li>
            <li>An AI call only starts if your balance covers its worst-case cost; afterwards only actual usage is charged. Failed calls are free and the balance can&apos;t go below zero.</li>
            <li>Running out of credits never disables stops, exits or the emergency close — the agent just falls back to its plain rules.</li>
          </ul>

          <h2 id="risk">Risk controls</h2>
          <ul>
            <li>Platform ceiling: 5× leverage, a 10% daily loss pause and a 25% drawdown emergency stop. Agents may set tighter limits.</li>
            <li>Every order is checked by the risk service, independently of the Copilot and the strategy.</li>
            <li>Loss limits are triggers, not guarantees: in fast markets or outages the realised loss can be larger.</li>
            <li>Server-side checks are not on-chain guarantees; the agent page states which is which.</li>
          </ul>

          <h2 id="custody">Custody &amp; keys</h2>
          <ul>
            <li>Covar never holds your private keys. Every deposit, withdrawal and top-up is approved by you in your own wallet.</li>
            <li>Vault shares are minted against a price with a freshness window; stale prices are refused, not used.</li>
            <li>Trading money can only go to the trading account set by the vault owner. Money reserved for withdrawals can&apos;t be moved.</li>
            <li>The vault has a single owner wallet (no multisig). A lost or leaked owner key is a risk we state openly.</li>
          </ul>

          <h2 id="execution">How orders run</h2>
          <p>
            Orders can&apos;t be sent from the website. An agent&apos;s intent is written to an append-only journal, checked by
            the risk service, signed by an isolated signer that can only trade allowlisted markets (it refuses anything that
            looks like a withdrawal), and only then sent to the trading venue. If the process restarts mid-order, it checks the
            venue first and adopts the order instead of sending it twice.
          </p>
          <p>
            Trading venue: Lighter on Robinhood Chain.{" "}
            {IS_MAINNET
              ? "Until the owner enables the venue connection, vault money stays in the vault as cash and no trades are placed."
              : "On this test network orders go to a paper matcher; no venue receives real orders."}
          </p>

          <h2 id="recovery">When something fails</h2>
          <ul>
            <li>AI provider down or out of credits: the agent trades its plain rules, and decisions are labelled rules only.</li>
            <li>Daily loss or drawdown limit hit: the agent goes close-only; exits keep working.</li>
            <li>Wind-down: deposits close, withdrawals and claims stay open.</li>
            <li>Website or data feed unavailable: your money stays in the vault contract, and a settled withdrawal can be claimed with any tool that can call the contract.</li>
          </ul>
        </article>
      </div>
    </div>
  );
}
