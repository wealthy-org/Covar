"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, ArrowUpRight, Search, SlidersHorizontal, Sparkles } from "lucide-react";

const demoAgents = [
  { name: "Cobalt Trend", creator: "Covar Research", symbol: "BTC / ETH", tag: "Trend following", return: "+12.8%", drawdown: "−4.2%", age: "21 days", score: 82, status: "Practice" },
  { name: "Mean Revert", creator: "Quant Garden", symbol: "ETH / USD", tag: "Mean reversion", return: "+8.4%", drawdown: "−3.1%", age: "14 days", score: 76, status: "Practice" },
  { name: "Range Scout", creator: "Northstar Labs", symbol: "BTC / USD", tag: "Range trading", return: "+5.2%", drawdown: "−2.8%", age: "9 days", score: 71, status: "Backtest" },
  { name: "Momentum Grid", creator: "Covar Research", symbol: "SOL / USD", tag: "Momentum", return: "+3.9%", drawdown: "−5.6%", age: "7 days", score: 68, status: "Backtest" }
];

export default function ExplorePage() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("score");
  const [filter, setFilter] = useState("All agents");

  const agents = useMemo(() => {
    const filtered = demoAgents.filter((agent) => {
      const matchesQuery = `${agent.name} ${agent.creator} ${agent.symbol} ${agent.tag}`.toLowerCase().includes(query.toLowerCase());
      const matchesFilter = filter === "All agents" || agent.status === filter;
      return matchesQuery && matchesFilter;
    });
    return filtered.sort((a, b) => sort === "return" ? parseFloat(b.return) - parseFloat(a.return) : b.score - a.score);
  }, [query, sort, filter]);

  return (
    <div className="page-stack">
      <section className="page-heading-row">
        <div><p className="eyebrow">Agent marketplace</p><h1>Discover agents</h1><p className="muted">Explore strategies, inspect their records, and find an approach that fits you.</p></div>
        <div className="heading-badge"><Sparkles size={15}/> Research preview</div>
      </section>
      <section className="discover-toolbar">
        <label className="search-field"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents, creators, or markets..." /></label>
        <div className="toolbar-controls">
          <label className="select-wrap"><SlidersHorizontal size={15}/><select value={filter} onChange={(e) => setFilter(e.target.value)}><option>All agents</option><option>Practice</option><option>Backtest</option></select></label>
          <label className="select-wrap"><ArrowDownUp size={15}/><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="score">Sort: Covar score</option><option value="return">Sort: Return</option></select></label>
        </div>
      </section>
      <div className="table-meta"><span>{agents.length} strategies</span><span>Demo data · Not live performance</span></div>
      <section className="agent-grid">
        {agents.map((agent, index) => (
          <article className="agent-card" key={agent.name}>
            <div className="agent-card-top"><div className={`agent-avatar avatar-${index % 4}`}>{agent.name.slice(0, 1)}</div><span className="status-badge">{agent.status}</span></div>
            <h2>{agent.name}</h2><p className="agent-creator">by {agent.creator}</p>
            <div className="agent-tags"><span>{agent.symbol}</span><span>{agent.tag}</span></div>
            <div className="agent-stats"><div><small>Return</small><strong className="positive">{agent.return}</strong></div><div><small>Max drawdown</small><strong>{agent.drawdown}</strong></div><div><small>Age</small><strong>{agent.age}</strong></div></div>
            <div className="agent-card-bottom"><span className="score-label">Covar score <strong>{agent.score}</strong></span><button className="icon-button" aria-label={`View ${agent.name}`}><ArrowUpRight size={16}/></button></div>
          </article>
        ))}
      </section>
      {agents.length === 0 && <div className="content-card no-results">No strategies match your search.</div>}
      <p className="disclaimer">All listed strategies are illustrative demo records for UI development. They do not represent actual users, trades, or returns.</p>
    </div>
  );
}
