"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Site-wide entrance animation. Blocks fade and rise as they scroll into view;
 * siblings are staggered. Content is only hidden once this script has run
 * (`html.rv`), so nothing disappears without JS, and `prefers-reduced-motion`
 * turns the whole thing off in CSS. After an element has animated its marker
 * is cleared, so its own hover transitions keep working.
 */
const BLOCKS = [
  ".page-head",
  ".detail-head",
  ".back-link",
  ".rcard",
  ".card",
  ".panel:not(.nav-panel)",
  ".joined-stats",
  ".table-wrap",
  ".notice",
  ".utabs",
  ".seg",
  ".mono-note",
  ".docs-toc",
  ".docs-article > h2",
  ".docs-article > h3",
  ".docs-article > p",
  ".docs-article > ul",
  ".docs-kv",
  ".lp-hero-copy",
  ".lp-chat",
  ".lp-eyebrow",
  ".lp-h2",
  ".lp-section-lead",
  ".lp-step",
  ".lp-card",
  ".lp-chain",
  ".lp-follow",
  ".lp-faq-item",
  ".lp-markets",
  ".lp-cta-art",
  ".lp-cta-sub",
  ".lp-built",
  ".footer-inner",
].join(",");

/** Allowed even inside an animated block — they cascade after their container. */
const NESTED = [".table tbody tr", ".arena-stats > div", ".stat-strip > div", ".joined-stats > div", ".lp-chip", ".lp-chain-node", ".decision-row"].join(",");

const STEP = 60;
const MAX_DELAY = 420;

export function Reveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("rv");

    const io = new IntersectionObserver(
      (entries) => {
        // everything entering together cascades in reading order
        const batch = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
        batch.forEach((e, i) => {
          const el = e.target as HTMLElement;
          io.unobserve(el);
          const delay = Math.min(i * STEP, MAX_DELAY);
          el.style.setProperty("--rv-d", `${delay}ms`);
          el.dataset.rv = "in";
          window.setTimeout(() => {
            el.dataset.rv = "done";
            el.style.removeProperty("--rv-d");
          }, 700 + delay);
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.06 }
    );

    const mark = (el: HTMLElement, nested: boolean) => {
      if (el.dataset.rv) return;
      if (!nested && el.parentElement?.closest("[data-rv]")) return;
      el.dataset.rv = "wait";
      io.observe(el);
    };

    const scan = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(BLOCKS).forEach((el) => mark(el, false));
      root.querySelectorAll<HTMLElement>(NESTED).forEach((el) => mark(el, true));
    };

    scan(document.body);

    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => scan(document.body));
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // printing / "save as PDF" must show everything
    const showAll = () => document.querySelectorAll<HTMLElement>("[data-rv]").forEach((el) => (el.dataset.rv = "done"));
    window.addEventListener("beforeprint", showAll);

    return () => {
      // anything still waiting (e.g. the shared footer) is re-armed on the next page
      document.querySelectorAll<HTMLElement>('[data-rv="wait"]').forEach((el) => delete el.dataset.rv);
      io.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("beforeprint", showAll);
    };
  }, [pathname]);

  return null;
}
