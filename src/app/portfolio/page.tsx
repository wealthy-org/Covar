import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";

export default function PortfolioPage() {
  return (
    <div className="page-stack">
      <section className="page-heading-row"><div><p className="eyebrow">Capital & vaults</p><h1>My money</h1><p className="muted">Manage balances, agent vaults, deposits, and withdrawals.</p></div><button className="button button-primary" disabled><Wallet size={16}/> Connect wallet</button></section>
      <section className="metric-grid portfolio-metrics">
        <article className="metric-card"><div className="metric-label">Total balance <Wallet size={16}/></div><div className="metric-value">$0.00</div><div className="metric-foot">Connect a wallet to view your balance</div></article>
        <article className="metric-card"><div className="metric-label">In agent vaults <ArrowUpRight size={16}/></div><div className="metric-value">$0.00</div><div className="metric-foot">No active investments</div></article>
        <article className="metric-card"><div className="metric-label">Available to withdraw <ArrowDownLeft size={16}/></div><div className="metric-value">$0.00</div><div className="metric-foot">No settled claims</div></article>
      </section>
      <section className="content-card empty-state compact"><div className="empty-illustration"><Wallet size={27}/></div><h2>Your portfolio is empty</h2><p>Connect your wallet to view your assets and explore available vaults.</p><button className="button button-secondary" disabled>Wallet integration in a later milestone</button></section>
    </div>
  );
}
