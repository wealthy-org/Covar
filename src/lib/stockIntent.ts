/**
 * Instant Stock Agent — deterministic intent parser (Bahasa Indonesia + English).
 *
 *   "Beli $50 NVDA, jual pas naik 4%"        → BUY  NVDA 50 USDG, TP +4%
 *   "Buy $50 NVDA take profit 4%"             → same intent
 *   "Jual NVDA $50" / "sell 0.3 NVDA"         → SELL by value / by shares
 *   "jual semua NVDA" / "sell all NVDA"       → SELL entire balance
 *   "... 3-5%"                                → TP at the midpoint (4%)
 *   "... stop loss 2%" / "cut loss 2%" / "turun 2%" → SL −2%
 *
 * No model call: runs in well under a millisecond, and every number in the
 * result is one the user typed (or an explicit, flagged default).
 */

export interface StockTradeIntent {
  kind: "stock_trade";
  side: "BUY" | "SELL";
  stock: string;
  /** spend (BUY) or value to sell (SELL), in USDG */
  amountUsdg?: number;
  /** exact Stock Token amount (SELL by shares) */
  amountShares?: number;
  /** SELL the whole balance */
  sellAll?: boolean;
  /** take-profit, percent above entry (e.g. 4 = +4%) */
  takeProfitPct?: number;
  /** stop-loss, percent below entry (e.g. 2 = −2%) */
  stopLossPct?: number;
  /** true when the amount was not in the text and the 50 USDG default was used */
  amountDefaulted: boolean;
  lang: "id" | "en";
  rawText: string;
}

export type IntentResult =
  | { ok: true; intent: StockTradeIntent }
  | { ok: false; code: "EMPTY" | "NO_STOCK" | "UNSUPPORTED_STOCK" | "NO_SIDE" | "NO_AMOUNT" | "BAD_NUMBER"; lang: "id" | "en"; message: string };

export const DEFAULT_BUY_USDG = 50;
export const MAX_TP_PCT = 100;
export const MAX_SL_PCT = 50;

/** tickers the agent understands, with the names people actually type */
export const INTENT_STOCKS: Record<string, string[]> = {
  NVDA: ["nvda", "nvidia"],
  TSLA: ["tsla", "tesla"],
  AAPL: ["aapl", "apple"],
  MSFT: ["msft", "microsoft"],
  GOOGL: ["googl", "goog", "google", "alphabet"],
  AMZN: ["amzn", "amazon"],
  META: ["meta", "facebook"],
  AMD: ["amd"],
};

const ID_WORDS = /\b(beli|jual|senilai|sebesar|pas|saat|kalau|kalo|naik|turun|untung|rugi|semua|seluruh|saham|lembar|tolong|dong|aja|sampai|cuan|ketika|harga|dolar)\b/i;

const NUM = String.raw`([1-9]\d{0,2}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)`;
const PCT = String.raw`\+?${NUM}\s*%`;
const RANGE_PCT = String.raw`${NUM}\s*%?\s*(?:-|–|—|to|sampai|s\/d|hingga|ke)\s*${NUM}\s*%`;

const TP_CUES = String.raw`(?:take[\s-]*profit|tp|target|untung|profit|cuan|gain|naik|up|rises?|goes\s+up|jual\s+(?:pas|saat|kalau|kalo|ketika|di)\s*(?:naik|untung|profit|cuan)?|sell\s+(?:at|when|if|on)\s*(?:it'?s\s+)?(?:up|it\s+rises|rises|gains?)?)`;
const SL_CUES = String.raw`(?:stop[\s-]*loss|sl|cut[\s-]*loss|rugi|turun|drops?|falls?|down)`;

/**
 * "0,5" (ID decimal comma) → 0.5 · "1,000" (EN thousands) → 1000 · "1.000" (ID thousands) → 1000.
 * A dot is a decimal point in English; a comma is a decimal point in Indonesian.
 */
let numLang: "id" | "en" = "en";
function num(s: string): number {
  const grouped = /^[1-9]\d{0,2}([.,])\d{3}(?:\1\d{3})*(?:[.,]\d+)?$/.exec(s);
  if (grouped) {
    const sep = grouped[1];
    const thousands = (numLang === "en" && sep === ",") || (numLang === "id" && sep === ".");
    if (thousands) {
      const dec = sep === "," ? "." : ",";
      const [whole, frac] = s.split(dec);
      return Number(whole.split(sep).join("") + (frac !== undefined ? "." + frac : ""));
    }
  }
  return Number(s.replace(",", "."));
}

function detectLang(text: string): "id" | "en" {
  return ID_WORDS.test(text) ? "id" : "en";
}


export function parseStockIntent(text: string): IntentResult {
  const raw = (text ?? "").trim();
  const lang = detectLang(raw);
  numLang = lang;
  if (!raw) return { ok: false, code: "EMPTY", lang, message: "Type an order, e.g. Buy $50 NVDA, take profit 4%." };
  let lower = ` ${raw.toLowerCase().replace(/\s+/g, " ")} `;

  // ---- stock
  let stock: string | null = null;
  let stockAt = Infinity;
  for (const [sym, names] of Object.entries(INTENT_STOCKS)) {
    for (const n of names) {
      const m = new RegExp(String.raw`(?:^|[^a-z0-9$])\$?${n}(?![a-z0-9])`).exec(lower);
      if (m && m.index < stockAt) {
        stock = sym;
        stockAt = m.index;
      }
    }
  }
  if (!stock) {
    const ticker = /\b([A-Z]{2,5})\b/.exec(raw.replace(/\b(USDG|USD|TP|SL|ETH|BUY|SELL|BELI|JUAL)\b/g, ""));
    if (ticker) {
      return {
        ok: false,
        code: "UNSUPPORTED_STOCK",
        lang,
        message: `${ticker[1]} isn't supported yet. Available: ${Object.keys(INTENT_STOCKS).join(", ")}.`,
      };
    }
    return { ok: false, code: "NO_STOCK", lang, message: "Which stock? For example: Buy $50 NVDA." };
  }

  // ---- side: the FIRST action word decides ("beli … jual pas naik 4%" is a buy with a TP)
  const sideRe = /\b(beli|buy|ambil|long|purchase|jual|sell|close|exit|keluar|lepas)\b/g;
  const first = sideRe.exec(lower);
  if (!first) return { ok: false, code: "NO_SIDE", lang, message: "Buy or sell? For example: Buy $50 NVDA." };
  const side: "BUY" | "SELL" = /^(beli|buy|ambil|long|purchase)$/.test(first[1]) ? "BUY" : "SELL";

  // ---- take-profit / stop-loss (parsed first, then removed so their numbers are not read as amounts)
  let takeProfitPct: number | undefined;
  let stopLossPct: number | undefined;

  const slRange = new RegExp(String.raw`${SL_CUES}\s*(?:di|at|of|sebesar|pas|-|minus)?\s*-?${RANGE_PCT}`).exec(lower);
  const slOne = new RegExp(String.raw`${SL_CUES}\s*(?:di|at|of|sebesar|pas|by|-|minus)?\s*-?${NUM}\s*%`).exec(lower);
  if (slRange) {
    stopLossPct = (num(slRange[1]) + num(slRange[2])) / 2;
    lower = lower.replace(slRange[0], " ");
  } else if (slOne) {
    stopLossPct = num(slOne[1]);
    lower = lower.replace(slOne[0], " ");
  }

  const tpRange = new RegExp(String.raw`${TP_CUES}\s*(?:di|at|of|sebesar|pas|by|ke)?\s*\+?${RANGE_PCT}`).exec(lower) ?? new RegExp(String.raw`\+?${RANGE_PCT}`).exec(lower);
  if (tpRange) {
    takeProfitPct = (num(tpRange[1]) + num(tpRange[2])) / 2;
    lower = lower.replace(tpRange[0], " ");
  } else {
    const tpOne = new RegExp(String.raw`${TP_CUES}\s*(?:di|at|of|sebesar|pas|by|ke)?\s*${PCT}`).exec(lower) ?? new RegExp(String.raw`(?:^|\s)\+${NUM}\s*%`).exec(lower);
    if (tpOne) {
      takeProfitPct = num(tpOne[1]);
      lower = lower.replace(tpOne[0], " ");
    }
  }
  // any other bare percentage is ambiguous: drop it from amount parsing
  lower = lower.replace(new RegExp(PCT, "g"), " ");

  if (takeProfitPct !== undefined && !(takeProfitPct > 0 && takeProfitPct <= MAX_TP_PCT)) {
    return { ok: false, code: "BAD_NUMBER", lang, message: `Take-profit must be between 0 and ${MAX_TP_PCT}%.` };
  }
  if (stopLossPct !== undefined && !(stopLossPct > 0 && stopLossPct <= MAX_SL_PCT)) {
    return { ok: false, code: "BAD_NUMBER", lang, message: `Stop-loss must be between 0 and ${MAX_SL_PCT}%.` };
  }

  // ---- amount
  let amountUsdg: number | undefined;
  let amountShares: number | undefined;
  const sellAll = side === "SELL" && /\b(semua|seluruh|semuanya|all|everything|max|seluruhnya)\b/.test(lower);
  const names = INTENT_STOCKS[stock].join("|");
  const money =
    new RegExp(String.raw`\$\s*${NUM}`).exec(lower) ??
    new RegExp(String.raw`${NUM}\s*(?:\$|usdg|usd|dolar|dollars?|bucks)\b`).exec(lower) ??
    new RegExp(String.raw`(?:usdg|usd)\s*${NUM}`).exec(lower) ??
    new RegExp(String.raw`(?:senilai|sebesar|worth|for|of)\s*\$?\s*${NUM}(?!\s*(?:${names}|saham|shares?|lembar|token))`).exec(lower);
  const shares = new RegExp(String.raw`${NUM}\s*(?:saham\s+|lembar\s+|shares?\s+(?:of\s+)?|tokens?\s+(?:of\s+)?)?(?:${names})\b`).exec(lower) ?? new RegExp(String.raw`${NUM}\s*(?:saham|lembar|shares?)\b`).exec(lower);
  if (money) amountUsdg = num(money[1]);
  else if (shares) amountShares = num(shares[1]);
  else if (!sellAll) {
    const bare = new RegExp(String.raw`(?:^|\s)${NUM}(?:\s|$)`).exec(lower);
    if (bare) amountUsdg = num(bare[1]);
  }

  for (const v of [amountUsdg, amountShares]) {
    if (v !== undefined && !(Number.isFinite(v) && v > 0)) {
      return { ok: false, code: "BAD_NUMBER", lang, message: "The amount must be greater than zero." };
    }
  }

  let amountDefaulted = false;
  if (amountUsdg === undefined && amountShares === undefined && !sellAll) {
    if (side === "BUY") {
      amountUsdg = DEFAULT_BUY_USDG;
      amountDefaulted = true;
    } else {
      return { ok: false, code: "NO_AMOUNT", lang, message: `How much ${stock} to sell? For example: Sell NVDA $50, or sell all NVDA.` };
    }
  }

  const intent: StockTradeIntent = { kind: "stock_trade", side, stock, amountDefaulted, lang, rawText: raw };
  if (amountUsdg !== undefined) intent.amountUsdg = amountUsdg;
  if (amountShares !== undefined) intent.amountShares = amountShares;
  if (sellAll) intent.sellAll = true;
  if (takeProfitPct !== undefined && side === "BUY") intent.takeProfitPct = takeProfitPct;
  if (stopLossPct !== undefined && side === "BUY") intent.stopLossPct = stopLossPct;
  return { ok: true, intent };
}

/** The language-independent part of an intent (what the bilingual test compares). */
export function intentCore(i: StockTradeIntent) {
  const { rawText: _r, lang: _l, ...core } = i;
  return core;
}

/** Plain-language confirmation the copilot shows (always English; Indonesian input is still understood). */
export function describeIntent(i: StockTradeIntent, ctx: { price?: number | null; label?: string | null } = {}): string {
  const p = ctx.price ?? null;
  const usd = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parts: string[] = [];
  if (i.side === "BUY") {
    const amt = `${usd(i.amountUsdg ?? 0)} USDG`;
    parts.push(`I've prepared a buy of ${i.stock} for ${amt}${i.amountDefaulted ? " (default amount — change it if you like)" : ""}.`);
    if (i.takeProfitPct !== undefined) {
      const tgt = p ? ` ($${usd(p * (1 + i.takeProfitPct / 100))})` : "";
      parts.push(`Take-profit at +${i.takeProfitPct}%${tgt}: the watcher tracks the price and tells you when it hits.`);
    }
    if (i.stopLossPct !== undefined) {
      const sl = p ? ` ($${usd(p * (1 - i.stopLossPct / 100))})` : "";
      parts.push(`Stop-loss at −${i.stopLossPct}%${sl}.`);
    }
  } else {
    const what = i.sellAll ? `all your ${i.stock}` : i.amountShares !== undefined ? `${i.amountShares} ${i.stock}` : `${usd(i.amountUsdg ?? 0)} USDG of ${i.stock}`;
    parts.push(`I've prepared a sale of ${what} for USDG.`);
  }
  if (p) parts.push(`Reference share price $${usd(p)}${ctx.label ? ` · ${ctx.label}` : ""}.`);
  parts.push("The route is on the right; the final price is the 0x quote when you confirm.");
  return parts.join(" ");
}
