"use client";

import { useEffect, useState } from "react";

/** Sticky "On this page" list with scrollspy — the reference marks the active item with an accent dot. */
export function DocsToc({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const onScroll = () => {
      const y = window.scrollY + 140;
      let cur = els[0]?.id;
      for (const el of els) if (el.offsetTop <= y) cur = el.id;
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) cur = els[els.length - 1]?.id;
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections]);

  return (
    <nav className="docs-toc" aria-label="On this page">
      <span className="stat-label">On this page</span>
      <div className="docs-toc-list">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} data-active={active === s.id}>
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
