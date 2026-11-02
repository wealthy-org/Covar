import Link from "next/link";
import { Bot, Plus, WandSparkles } from "lucide-react";

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const params = await searchParams;
  const creating = params.new === "1";
  return (
    <div className="page-stack">
      <section className="page-heading-row">
        <div><p className="eyebrow">Strategy workspace</p><h1>{creating ? "Create an agent" : "My agents"}</h1><p className="muted">Build, test, and manage your trading strategies.</p></div>
        {!creating && <Link href="/studio?new=1" className="button button-primary"><Plus size={16}/> Create an agent</Link>}
      </section>
      {creating ? (
        <section className="content-card builder-start">
          <div className="builder-icon"><WandSparkles size={23}/></div>
          <h2>What would you like your agent to do?</h2>
          <p>Describe a strategy in plain language. The builder will turn it into editable rules you can review and test.</p>
          <textarea className="strategy-prompt" placeholder="Example: Buy BTC when the 20-day moving average crosses above the 50-day average. Use a 2% stop loss..." />
          <div className="builder-footer"><span>Draft only · No orders will be placed</span><button className="button button-primary" disabled>Generate strategy <WandSparkles size={15}/></button></div>
        </section>
      ) : (
        <section className="content-card empty-state compact">
          <div className="empty-illustration"><Bot size={28}/></div><h2>No agents yet</h2><p>Your created strategies and their versions will appear here.</p><Link href="/studio?new=1" className="button button-primary"><Plus size={16}/> Create your first agent</Link>
        </section>
      )}
    </div>
  );
}
