export const usd = (n: number, opts: { compact?: boolean; max?: number } = {}) => {
  const { compact = false, max = 2 } = opts;
  const maxFrac = Math.max(0, Math.min(6, max));
  if (!isFinite(n)) return "—";
  if (compact && Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (compact && Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n === 0) return "$0";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: Math.min(2, maxFrac), maximumFractionDigits: maxFrac })}`;
};

export const usdSigned = (n: number, opts?: { compact?: boolean }) =>
  `${n >= 0 ? "+" : "−"}${usd(Math.abs(n), opts)}`;

export const pct = (n: number, digits = 2) => `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(digits)}%`;
export const pctSigned = (n: number, digits = 2) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}%`;
export const num = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const shortAddr = (a: string, size = 4) => `${a.slice(0, 2 + size)}…${a.slice(-size)}`;

export const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
};

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Deterministic PRNG (mulberry32) — every run of a given seed is reproducible. */
export const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const hashSeed = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
