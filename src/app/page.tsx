import Link from "next/link";
import { ArrowUpRight, Bot, Compass, Plus, Wallet } from "lucide-react";

export default function OverviewPage() {
  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div><p className="eyebrow">Workspace</p><h1>Good evening.</h1><p className="muted">Your trading workspace, all in one place.</p></div>
        <Link href="/studio?new=1" className="button button-primary"><Plus size={16}/> Create an agent</Link>
      </section>
      <section className="metric-grid">
        <article className="metric-card"><div className="metric-label">Total balance <Wallet size={16}/></div><div className="metric-value">$0.00</div><div className="metric-foot">Connect a wallet to get started</div></article>
        <article className="metric-card"><div className="metric-label">Active agents <Bot size={16}/></div><div className="metric-value">0</div><div className="metric-foot">No agents running</div></article>
        <article className="metric-card"><div className="metric-label">Discover strategies <Compass size={16}/></div><div className="metric-value">Explore</div><Link className="inline-link" href="/explore">Browse agent strategies <ArrowUpRight size={14}/></Link></article>
      </section>
      <section className="content-card empty-state">
        <div className="empty-illustration"><Bot size={28}/><span className="empty-spark">✦</span></div>
        <h2>Your agents will live here</h2>
        <p>Create a strategy from an idea, test it, then decide when it’s ready to go live.</p>
        <div className="empty-actions"><Link href="/studio?new=1" className="button button-primary"><Plus size={16}/> Create your first agent</Link><Link href="/explore" className="button button-secondary">Explore agents</Link></div>
      </section>
    </div>
  );
}
