import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="stack gap-12">
          <div className="brand" style={{ marginBottom: 10 }}>
            <Image src="/logo.png" alt="" width={20} height={22} className="brand-logo" />
            <span>Covar</span>
          </div>
          <p className="small" style={{ maxWidth: 280 }}>
            Strategy agents with published rules, versioned history and vaults on Robinhood Chain. Built as a direct
            functional mirror of the reference product; differentiating features land after parity is reviewable.
          </p>
          <span className="tiny">Development build · Robinhood Chain testnet 46630 · no real value at risk</span>
        </div>

        <div className="stack">
          <span className="upper" style={{ color: "var(--muted-2)", marginBottom: 6 }}>
            Product
          </span>
          <Link className="footer-link" href="/explore">Discover agents</Link>
          <Link className="footer-link" href="/studio">Studio</Link>
          <Link className="footer-link" href="/portfolio">My Money</Link>
          <Link className="footer-link" href="/economics">Economics</Link>
        </div>

        <div className="stack">
          <span className="upper" style={{ color: "var(--muted-2)", marginBottom: 6 }}>
            Resources
          </span>
          <Link className="footer-link" href="/docs">Documentation</Link>
          <Link className="footer-link" href="/docs#fees">Fees &amp; custody</Link>
          <Link className="footer-link" href="/docs#risk">Risk controls</Link>
          <Link className="footer-link" href="/docs#parity">Parity register</Link>
          <Link className="footer-link" href="/chain">Chain status</Link>
        </div>

        <div className="stack">
          <span className="upper" style={{ color: "var(--muted-2)", marginBottom: 6 }}>
            Reference
          </span>
          <a className="footer-link" href="https://www.sharpe.ac/" target="_blank" rel="noreferrer noopener">
            Sharpe (reference product)
          </a>
          <a className="footer-link" href="https://docs.robinhood.com/chain/" target="_blank" rel="noreferrer noopener">
            Robinhood Chain docs
          </a>
          <a className="footer-link" href="https://docs.lighter.xyz/" target="_blank" rel="noreferrer noopener">
            Lighter docs
          </a>
          <a className="footer-link" href="https://www.orbio.so/" target="_blank" rel="noreferrer noopener">
            Orbio
          </a>
        </div>
      </div>
    </footer>
  );
}
