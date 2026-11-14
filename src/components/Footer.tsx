import Image from "next/image";
import Link from "next/link";
import { IS_MAINNET, NETWORK_LABEL } from "@/lib/chain";
import { X_HANDLE, X_URL, XIcon } from "./Social";

const COLS: { title: string; links: { href: string; label: string; ext?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/explore", label: "Discover" },
      { href: "/studio", label: "My agents" },
      { href: "/portfolio", label: "My money" },
      { href: "/trade", label: "Stock trade" },
      { href: "/economics", label: "Economics" },
      { href: "/treasury", label: "Treasury" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/docs#fees", label: "Fees & custody" },
      { href: "/docs#risk", label: "Risk controls" },
      { href: "/chain", label: "Contract & network" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link href="/" className="brand" aria-label="Covar home">
            <Image src="/logo.png" alt="" width={20} height={22} className="brand-logo" />
            <span>Covar</span>
          </Link>
          <p className="small" style={{ margin: 0 }}>
            Strategy agents with published rules, versioned history and vaults on Robinhood Chain.
          </p>
          <div className="footer-social">
            <a href={X_URL} target="_blank" rel="noreferrer noopener" className="nav-btn footer-x" aria-label={`Covar on X (${X_HANDLE})`}>
              <XIcon size={12} />
              <span>{X_HANDLE}</span>
            </a>
          </div>
        </div>
        <div className="footer-cols">
          {COLS.map((c) => (
            <div key={c.title} className="footer-col">
              <span className="footer-col-title">{c.title}</span>
              {c.links.map((l) =>
                l.ext ? (
                  <a key={l.href} className="footer-link" href={l.href} target="_blank" rel="noreferrer noopener">
                    {l.label} ↗
                  </a>
                ) : (
                  <Link key={l.href} className="footer-link" href={l.href}>
                    {l.label}
                  </Link>
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="footer-base">
        <div className="footer-base-inner">
          <span>
            {IS_MAINNET
              ? "Robinhood Chain · Trading digital assets carries risk, including loss of the money you deposit. Nothing here is investment advice."
              : `${NETWORK_LABEL} · test network, tokens have no value`}
          </span>
          <span>© {new Date().getFullYear()} Covar</span>
        </div>
      </div>
    </footer>
  );
}
