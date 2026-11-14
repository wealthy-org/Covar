/** Covar line icons — 24×24, 1.6 stroke, round caps. One set for the whole site; no emoji. */
export type IconName =
  | "target" | "bot" | "shield" | "scale" | "news" | "db" | "key" | "lock"
  | "undo" | "coins" | "layers" | "fallback" | "check" | "arrow-up"
  | "zap"
  | "candles"
  | "live"
  | "alert";

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "target": return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" /></svg>;
    case "bot": return <svg {...p}><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 17h5" /></svg>;
    case "shield": return <svg {...p}><path d="M12 3l7 3v6c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>;
    case "scale": return <svg {...p}><path d="M12 4v16M7 20h10M5 7h14M7 7l-3 7a3 3 0 006 0L7 7zM17 7l-3 7a3 3 0 006 0l-3-7z" /></svg>;
    case "news": return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
    case "db": return <svg {...p}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>;
    case "key": return <svg {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2 2M14 9l2 2" /></svg>;
    case "lock": return <svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>;
    case "undo": return <svg {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></svg>;
    case "coins": return <svg {...p}><circle cx="9" cy="9" r="5" /><path d="M14.5 5.5A5 5 0 1118.5 13M9 7v4M7 9h4" /></svg>;
    case "layers": return <svg {...p}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></svg>;
    case "fallback": return <svg {...p}><path d="M4 12a8 8 0 0113.7-5.7L20 8.5" /><path d="M20 4v4.5h-4.5" /><path d="M20 12a8 8 0 01-13.7 5.7L4 15.5" /><path d="M4 20v-4.5h4.5" /></svg>;
    case "check": return <svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
    case "zap": return <svg {...p}><path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" /></svg>;
    case "candles": return <svg {...p}><path d="M7 3v3M7 16v5M17 3v6M17 17v4" /><rect x="5" y="6" width="4" height="10" rx="1" /><rect x="15" y="9" width="4" height="8" rx="1" /></svg>;
    case "live": return <svg {...p}><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="7.5" opacity="0.45" /></svg>;
    case "alert": return <svg {...p}><path d="M12 4l9 16H3l9-16z" /><path d="M12 10v4M12 17h.01" /></svg>;
    case "arrow-up": return <svg {...p} strokeWidth={2.2}><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
  }
}
