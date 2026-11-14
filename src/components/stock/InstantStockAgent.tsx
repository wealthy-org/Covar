"use client";

/**
 * Mode A in /studio — Instant Stock Agent.
 *
 *   type "Buy $50 NVDA, take profit 4%"  →  intent (instant, no model call)
 *   → Route Review (live share price + executable 0x quote, 0.5% max slippage)
 *   → Approve (exact) → Swap, signed in the user's wallet on Robinhood Chain
 *   → Active Watcher: live price every 5 s, progress to target, banner + chime
 *   → "Lock Profit": the sale is signed by the user, proof read from the receipt.
 *
 * Honesty rules: a position exists only after a confirmed on-chain buy; every
 * amount shown as "done" comes from the receipt; the share price (Yahoo) is the
 * watcher's reference and is labelled as such — what the user receives is the
 * 0x quote at the time they sell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { cx, shortAddr } from "@/lib/format";
import { describeIntent, parseStockIntent, type StockTradeIntent } from "@/lib/stockIntent";
import { DEFAULT_SLIPPAGE_BPS, REGION_BLOCKED_MESSAGE, USDG, findStock, fromUnits, toUnits, type MarketInfo, type TradeQuote } from "@/lib/stockTrade";
import { addressUrl, fetchMarket, fetchQuote, hasAttested, readWallet, setAttested, spenderFor, tokenUrl, txUrl, type TradeRecord, type WalletState } from "@/lib/stockTradeClient";
import {
  STEP_TEXT,
  chime,
  loadPositions,
  plainUnits,
  positionFromBuy,
  removePosition,
  runTrade,
  savePosition,
  watchState,
  type StockPosition,
  type TradeStep,
} from "@/lib/stockAgents";
import { useWalletAccount } from "@/lib/useWalletAccount";
import type { StockPrice } from "@/lib/stockPrices";

interface Msg {
  id: number;
  role: "user" | "agent";
  text: string;
  tone?: "ok" | "err";
  hash?: string;
}

const EXAMPLES = ["Buy $50 NVDA, take profit 4%", "Buy $25 NVDA take profit 3%, stop loss 2%", "Sell all NVDA"];

const usd2 = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtU = (v: bigint | string, frac = 2) => fromUnits(BigInt(v), USDG.decimals, frac);
const fmtS = (v: bigint | string, frac = 6) => fromUnits(BigInt(v), 18, frac);

/* --------------------------------------------------------------- prices */

export function useStockPrices(symbols: string[], intervalMs = 5000) {
  const [prices, setPrices] = useState<Record<string, StockPrice>>({});
  const [at, setAt] = useState<number | null>(null);
  const key = [...new Set(symbols)].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/stocks/prices?symbols=${key}`, { cache: "no-store" });
        const j = await r.json();
        if (alive && j?.prices) {
          setPrices((p) => ({ ...p, ...j.prices }));
          setAt(Date.now());
        }
      } catch {
        /* keep last */
      }
    };
    void load();
    const t = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [key, intervalMs]);
  return { prices, at };
}

/* ---------------------------------------------------------------- agent */

export function InstantStockAgent() {
  const { account, connect } = useWalletAccount();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [intent, setIntent] = useState<StockTradeIntent | null>(null);
  const [market, setMarket] = useState<MarketInfo | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [step, setStep] = useState<TradeStep | null>(null);
  const [stepHash, setStepHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<StockPosition[]>([]);
  const [lastRec, setLastRec] = useState<TradeRecord | null>(null);
  const [attested, setAttestedState] = useState(false);
  const [banner, setBanner] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const nextId = useRef(1);

  const say = useCallback((m: Omit<Msg, "id">) => setMessages((x) => [...x, { ...m, id: nextId.current++ }]), []);

  useEffect(() => setAttestedState(hasAttested()), []);
  useEffect(() => setPositions(loadPositions(account)), [account]);

  const open = positions.filter((p) => p.status !== "closed");
  const symbols = useMemo(() => [...new Set([intent?.stock, ...open.map((p) => p.symbol)].filter(Boolean) as string[])], [intent?.stock, open]);
  const { prices } = useStockPrices(symbols.length ? symbols : ["NVDA"], 5000);
  const asset = intent ? findStock(intent.stock) : null;
  const ref = intent ? prices[intent.stock] : undefined;

  /* market info for the intent's stock (token check, region, route) */
  useEffect(() => {
    if (!intent) return;
    let alive = true;
    setMarket(null);
    fetchMarket(intent.stock)
      .then((m) => alive && setMarket(m))
      .catch(() => alive && setMarket(null));
    return () => {
      alive = false;
    };
  }, [intent]);

  /* wallet balances for the active stock */
  const spender = spenderFor(market);
  const refreshWallet = useCallback(async () => {
    const a = asset ?? findStock("NVDA")!;
    if (!account) return setWallet(null);
    try {
      setWallet(await readWallet(account, a, spender));
    } catch {
      /* keep last */
    }
  }, [account, asset, spender]);
  useEffect(() => {
    void refreshWallet();
    const t = setInterval(() => void refreshWallet(), 15_000);
    return () => clearInterval(t);
  }, [refreshWallet]);

  /* amount the trade will sell, in base units */
  const plan = useMemo(() => {
    if (!intent || !asset) return null;
    try {
      if (intent.side === "BUY") {
        const v = toUnits(String(intent.amountUsdg ?? 0), USDG.decimals);
        return { units: v, amount: plainUnits(v, USDG.decimals), estimated: false };
      }
      if (intent.sellAll) {
        if (!wallet) return null;
        return { units: wallet.stock, amount: plainUnits(wallet.stock, asset.decimals), estimated: false };
      }
      if (intent.amountShares !== undefined) {
        const v = toUnits(intent.amountShares.toFixed(asset.decimals).replace(/0+$/, "").replace(/\.$/, ""), asset.decimals);
        return { units: v, amount: plainUnits(v, asset.decimals), estimated: false };
      }
      if (intent.amountUsdg !== undefined && ref?.price) {
        const v = toUnits((intent.amountUsdg / ref.price).toFixed(8), asset.decimals);
        return { units: v, amount: plainUnits(v, asset.decimals), estimated: true };
      }
    } catch {
      return null;
    }
    return null;
  }, [intent, asset, wallet, ref?.price]);

  const canTrade = !!market && market.tradingEnabled && market.region.allowed && !!market.asset.enabled;

  /* indicative quote for the plan, refreshed every 20 s */
  useEffect(() => {
    setQuote(null);
    setQuoteErr(null);
    if (!intent || !plan || !canTrade || plan.units <= 0n) return;
    let alive = true;
    const load = async () => {
      const q = await fetchQuote({ symbol: intent.stock, side: intent.side === "BUY" ? "buy" : "sell", amount: plan.amount, taker: account ?? "", slippageBps: DEFAULT_SLIPPAGE_BPS, firm: false });
      if (!alive) return;
      if (q.ok) {
        setQuote(q);
        setQuoteErr(null);
      } else {
        setQuote(null);
        setQuoteErr(q.error);
      }
    };
    const d = setTimeout(load, 300);
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearTimeout(d);
      clearInterval(t);
    };
  }, [intent, plan?.amount, canTrade, account]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the watcher: crossing a level raises the banner + chime once */
  useEffect(() => {
    let changed = false;
    const next = positions.map((p) => {
      if (p.status !== "watching") return p;
      const px = prices[p.symbol]?.price;
      const w = watchState(p, px);
      if (!w.hit) return p;
      changed = true;
      const up: StockPosition = { ...p, status: w.hit === "target" ? "target_hit" : "stop_hit", hitAt: new Date().toISOString(), hitPrice: px ?? undefined };
      savePosition(up);
      chime();
      setBanner(
        w.hit === "target"
          ? { tone: "ok", text: `${p.symbol} +${p.takeProfitPct}% target hit! Lock the profit by selling to USDG.` }
          : { tone: "warn", text: `${p.symbol} hit the −${p.stopLossPct}% stop. Sell now to limit the loss.` }
      );
      return up;
    });
    if (changed) setPositions(next);
  }, [prices]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- chat */
  const submit = (text: string) => {
    const t = text.trim();
    if (!t || step) return;
    setInput("");
    setError(null);
    setLastRec(null);
    say({ role: "user", text: t });
    const r = parseStockIntent(t);
    if (!r.ok) {
      setIntent(null);
      say({ role: "agent", text: r.message, tone: "err" });
      return;
    }
    const a = findStock(r.intent.stock);
    if (!a) {
      setIntent(null);
      say({ role: "agent", text: `${r.intent.stock} isn't available.`, tone: "err" });
      return;
    }
    setIntent(r.intent);
    const p = prices[r.intent.stock];
    let reply = describeIntent(r.intent, { price: p?.price ?? null, label: p?.label ?? null });
    if (!a.enabled) reply += " " + `Note: ${a.symbol} isn't open for trading on Covar yet — NVDA is the first pilot.`;
    say({ role: "agent", text: reply });
  };

  /* ---- execute the route */
  const execute = async () => {
    if (!intent || !asset || !market || !plan) return;
    setError(null);
    const acct = account;
    try {
      if (!acct) {
        await connect();
        return; // balances load, then the user presses again with the wallet visible
      }
      const { rec } = await runTrade({
        account: acct,
        asset,
        market,
        side: intent.side === "BUY" ? "buy" : "sell",
        amount: plan.amount,
        amountUnits: plan.units,
        slippageBps: DEFAULT_SLIPPAGE_BPS,
        onStep: (s, info) => {
          setStep(s);
          if (info?.hash) setStepHash(info.hash);
        },
      });
      setLastRec(rec);
      if (intent.side === "BUY") {
        const pos = positionFromBuy({ rec, prompt: intent.rawText, takeProfitPct: intent.takeProfitPct, stopLossPct: intent.stopLossPct, entryRef: ref?.price ?? null, refLabel: ref?.label ?? null });
        savePosition(pos);
        setPositions(loadPositions(acct));
        say({
          role: "agent",
          tone: "ok",
          hash: rec.hash,
          text:
            `Bought ${fmtS(pos.shares, 6)} ${asset.symbol} for ${fmtU(pos.usdgIn, 6)} USDG (read from the receipt).` +
            (pos.targetRef ? " " + `Watcher is live — target ${usd2(pos.targetRef)} (+${pos.takeProfitPct}%).` : ""),
        });
      } else {
        say({ role: "agent", tone: "ok", hash: rec.hash, text: `Sold ${fmtS(-BigInt(rec.stockDelta))} ${asset.symbol} → +${fmtU(rec.usdgDelta, 6)} USDG.` });
      }
      setIntent(null);
      void refreshWallet();
    } catch (e) {
      const m = (e as Error).message;
      setError(m);
      say({ role: "agent", tone: "err", text: m });
    } finally {
      setStep(null);
      setStepHash(null);
    }
  };

  /* ---- close a watched position (Lock Profit / Emergency Exit) */
  const closePosition = async (p: StockPosition) => {
    const a = findStock(p.symbol);
    if (!a || step) return;
    setError(null);
    setBanner(null);
    try {
      if (!account) return void (await connect());
      const m = await fetchMarket(p.symbol);
      if (!m.tradingEnabled || !m.region.allowed) throw new Error(m.region.message || "Trading isn't available right now.");
      const w = await readWallet(account, a, spenderFor(m));
      const units = BigInt(p.shares) < w.stock ? BigInt(p.shares) : w.stock;
      if (units <= 0n) throw new Error(`This wallet no longer holds ${p.symbol}. Dismiss the watcher if you closed it elsewhere.`);
      const { rec } = await runTrade({
        account,
        asset: a,
        market: m,
        side: "sell",
        amount: plainUnits(units, a.decimals),
        amountUnits: units,
        slippageBps: DEFAULT_SLIPPAGE_BPS,
        onStep: (s, info) => {
          setStep(s);
          if (info?.hash) setStepHash(info.hash);
        },
      });
      const out = BigInt(rec.usdgDelta);
      const closed: StockPosition = { ...p, status: "closed", sellHash: rec.hash, usdgOut: out.toString(), closedAt: new Date().toISOString(), closeReason: p.status === "target_hit" ? "take_profit" : p.status === "stop_hit" ? "stop_loss" : "manual" };
      savePosition(closed);
      setPositions(loadPositions(account));
      setLastRec(rec);
      const pnl = out - BigInt(p.usdgIn);
      say({
        role: "agent",
        tone: "ok",
        hash: rec.hash,
        text: `${p.symbol} position closed: +${fmtU(out, 6)} USDG back in your wallet. Realised ${pnl >= 0n ? "+" : ""}${fmtU(pnl, 6)} USDG (after spread & fees).`,
      });
      void refreshWallet();
    } catch (e) {
      const m = (e as Error).message;
      setError(m);
      say({ role: "agent", tone: "err", text: m });
    } finally {
      setStep(null);
      setStepHash(null);
    }
  };

  const dismiss = (p: StockPosition) => {
    removePosition(p.id);
    setPositions(loadPositions(account));
  };

  const closed = positions.filter((p) => p.status === "closed");

  return (
    <div className="stack gap-20" data-testid="stock-agent">
      {banner && (
        <div className={cx("agent-banner", banner.tone === "ok" ? "agent-banner-ok" : "agent-banner-warn")} role="status" data-testid="tp-banner">
          <span className="row gap-8">
            <Icon name={banner.tone === "ok" ? "target" : "alert"} size={17} />
            {banner.text}
          </span>
          <button className="link-btn" onClick={() => setBanner(null)}>
            dismiss
          </button>
        </div>
      )}

      <div className="trade-grid">
        {/* ---------------- chat */}
        <div className="rcard rcard-pad stack gap-14" data-testid="agent-chat">
          <div className="row between wrap gap-8">
            <span className="stat-label">Instant Stock Agent · Robinhood Chain</span>
            <span className="tiny">{account ? <a href={addressUrl(account)} target="_blank" rel="noreferrer noopener" className="mono">{shortAddr(account, 4)} ↗</a> : "wallet not connected"}</span>
          </div>
          <div className="chat-log" aria-live="polite">
            {messages.length === 0 && (
              <div className="chat-msg chat-agent">
                Tell me what to trade in plain words — e.g. <em>“Buy $50 NVDA, take profit 4%”</em>. I prepare the route; you confirm every transaction in your own wallet.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cx("chat-msg", m.role === "user" ? "chat-user" : "chat-agent", m.tone === "err" && "chat-err", m.tone === "ok" && "chat-ok")} data-testid={m.role === "agent" ? "agent-msg" : "user-msg"}>
                {m.text}
                {m.hash && (
                  <a href={txUrl(m.hash)} target="_blank" rel="noreferrer noopener" className="mono tiny" style={{ display: "block", marginTop: 4 }}>
                    {shortAddr(m.hash, 8)} ↗
                  </a>
                )}
              </div>
            ))}
          </div>
          <form
            className="row gap-8"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <input className="input" style={{ flex: 1 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Buy $50 NVDA, take profit 4%" data-testid="agent-input" disabled={!!step} />
            <button className="btn btn-primary" type="submit" disabled={!input.trim() || !!step} data-testid="agent-send">
              Send
            </button>
          </form>
          <div className="row wrap gap-6">
            {EXAMPLES.map((e) => (
              <button key={e} className="chip" type="button" onClick={() => submit(e)} disabled={!!step}>
                {e}
              </button>
            ))}
          </div>
          <span className="tiny">
            Orders are read instantly in your browser (no AI call). The final price is the 0x quote when you confirm.
          </span>
        </div>

        {/* ---------------- right panel: route review, then watchers */}
        <div className="stack gap-14">
          {intent && asset && (
            <RouteReviewCard
              intent={intent}
              price={ref}
              market={market}
              quote={quote}
              quoteErr={quoteErr}
              plan={plan}
              wallet={wallet}
              step={step}
              stepHash={stepHash}
              error={error}
              account={account}
              attested={attested}
              onAttest={(v) => {
                setAttested(v);
                setAttestedState(v);
              }}
              onExecute={execute}
              onCancel={() => setIntent(null)}
            />
          )}
          {open.map((p) => (
            <ActiveStockWatcherCard key={p.id} p={p} price={prices[p.symbol]} busy={!!step} step={step} onSell={() => closePosition(p)} onDismiss={() => dismiss(p)} account={account} />
          ))}
          {!intent && open.length === 0 && (
            <div className="rcard rcard-pad stack gap-8" data-testid="agent-empty">
              <span className="stat-label">{"Route & watcher"}</span>
              <span className="small">
                Type an order on the left. The swap route appears here; once a buy confirms on chain, a watcher card tracks the price until your take-profit hits.
              </span>
            </div>
          )}
          {lastRec && !step && <MiniProof rec={lastRec} />}
        </div>
      </div>

      {closed.length > 0 && (
        <section className="stack gap-10" data-testid="agent-closed">
          <span className="stat-label">Completed agents</span>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th className="right">Bought</th>
                  <th className="right">Sold</th>
                  <th className="right">Realised</th>
                  <th>Reason</th>
                  <th className="right">Transactions</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => {
                  const pnl = BigInt(p.usdgOut ?? "0") - BigInt(p.usdgIn);
                  return (
                    <tr key={p.id}>
                      <td className="mono">{p.symbol}</td>
                      <td className="right mono-num">{fmtU(p.usdgIn)} USDG</td>
                      <td className="right mono-num">{fmtU(p.usdgOut ?? "0")} USDG</td>
                      <td className={cx("right mono-num", pnl >= 0n ? "pos" : "neg")}>
                        {pnl >= 0n ? "+" : ""}
                        {fmtU(pnl, 4)}
                      </td>
                      <td className="tiny">{p.closeReason === "take_profit" ? "take-profit" : p.closeReason === "stop_loss" ? "stop-loss" : "manual exit"}</td>
                      <td className="right tiny mono">
                        <a href={txUrl(p.buyHash)} target="_blank" rel="noreferrer noopener">buy ↗</a>{" "}
                        {p.sellHash && (
                          <a href={txUrl(p.sellHash)} target="_blank" rel="noreferrer noopener">sell ↗</a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/* --------------------------------------------------------- route review */

function Row({ k, v, sub, tone, testid }: { k: string; v: React.ReactNode; sub?: React.ReactNode; tone?: "ok" | "warn" | "accent"; testid?: string }) {
  return (
    <div className="trade-row" data-testid={testid}>
      <span className="tiny">{k}</span>
      <span className={cx("small num", tone === "warn" && "trade-warn", tone === "ok" && "trade-ok", tone === "accent" && "trade-accent")} style={{ textAlign: "right" }}>
        {v}
        {sub && <span className="tiny" style={{ display: "block" }}>{sub}</span>}
      </span>
    </div>
  );
}

function RouteReviewCard(p: {
  intent: StockTradeIntent;
  price: StockPrice | undefined;
  market: MarketInfo | null;
  quote: TradeQuote | null;
  quoteErr: string | null;
  plan: { units: bigint; amount: string; estimated: boolean } | null;
  wallet: WalletState | null;
  step: TradeStep | null;
  stepHash: string | null;
  error: string | null;
  account: string | null;
  attested: boolean;
  onAttest: (v: boolean) => void;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const { intent, price, market, quote, plan } = p;
  const asset = findStock(intent.stock)!;
  const buy = intent.side === "BUY";
  const spot = price?.price ?? null;
  const spend = intent.amountUsdg ?? null;
  const estOut = quote ? BigInt(quote.buyAmount) : null;
  const refOut = buy && spend && spot ? spend / spot : null;
  const tgt = buy && intent.takeProfitPct && spot ? spot * (1 + intent.takeProfitPct / 100) : null;
  const stop = buy && intent.stopLossPct && spot ? spot * (1 - intent.stopLossPct / 100) : null;
  const estProfit = buy && intent.takeProfitPct && spend ? (spend * intent.takeProfitPct) / 100 : null;
  const blocked = market && !market.region.allowed;
  const opensSoon = market && market.region.allowed && (!market.tradingEnabled || !market.asset.enabled);
  const needApprove = !!p.wallet && !!plan && (buy ? p.wallet.usdgAllowance : p.wallet.stockAllowance) < plan.units;
  const balanceShort = !!p.wallet && !!plan && (buy ? p.wallet.usdg : p.wallet.stock) < plan.units;
  const ready = !!market && market.tradingEnabled && market.region.allowed && !!plan && plan.units > 0n && !!quote && p.attested && !balanceShort;

  return (
    <div className="rcard rcard-pad stack gap-12 route-card" data-testid="route-review">
      <div className="row between wrap gap-8">
        <div className="row gap-8">
          <span className="pill pill-accent mono">{buy ? "SWAP ROUTE" : "SELL ROUTE"}</span>
          <strong className="small">{buy ? `USDG → ${asset.symbol}` : `${asset.symbol} → USDG`}</strong>
        </div>
        <span className="tiny mono">Robinhood Chain · 4663</span>
      </div>

      {blocked && (
        <div className="notice notice-warn" role="alert" data-testid="agent-region-blocked">
          <div>{market?.region.message || REGION_BLOCKED_MESSAGE(asset.symbol)}</div>
        </div>
      )}
      {opensSoon && (
        <div className="notice notice-neutral" data-testid="agent-trade-soon">
          <div>
            {!market!.asset.enabled
              ? `${asset.symbol} isn't open for trading on Covar yet. Prices stay live.`
              : `${market!.route?.problem ? market!.route.problem + " " : ""}Stock trading opens soon. The route and prices below are already live.`}
          </div>
        </div>
      )}

      <div className="stack">
        {buy ? (
          <Row k={"Pay amount"} v={`${spend?.toFixed(2)} USDG`} sub={intent.amountDefaulted ? "default amount — type another amount to change it" : undefined} testid="rr-spend" />
        ) : (
          <Row
            k={"Sell"}
            v={plan ? `${fmtS(plan.units, 6)} ${asset.symbol}` : intent.sellAll ? "entire balance (connect wallet)" : "—"}
            sub={plan?.estimated ? `≈ ${usd2(intent.amountUsdg)} at the share price` : undefined}
            testid="rr-sell"
          />
        )}
        <Row k={"Spot market price (reference)"} v={usd2(spot)} sub={price ? `${price.label}${price.source === "yahoo" ? " · Yahoo Finance" : ""}` : "loading…"} testid="rr-spot" />
        <Row
          k={"Estimated output"}
          v={
            estOut !== null
              ? `${buy ? fmtS(estOut, 6) : fmtU(estOut, 4)} ${buy ? asset.symbol : "USDG"}`
              : refOut !== null
                ? `≈ ${refOut.toFixed(5)} ${asset.symbol}`
                : "—"
          }
          sub={estOut !== null ? "from the 0x quote (indicative)" : refOut !== null ? "estimate from the share price — not the execution price" : undefined}
          tone="accent"
          testid="rr-out"
        />
        {quote && <Row k={"Execution price"} v={`${quote.price.toFixed(2)} USDG / ${asset.symbol}`} sub={spot ? `${(((quote.price - spot) / spot) * 100).toFixed(2)}% vs share price` : undefined} />}
        {quote?.minBuyAmount && (
          <Row k={`Minimum received (${(DEFAULT_SLIPPAGE_BPS / 100).toFixed(1)}% slippage)`} v={`${buy ? fmtS(quote.minBuyAmount, 6) : fmtU(quote.minBuyAmount, 4)} ${buy ? asset.symbol : "USDG"}`} sub={quote.via === "router" ? "enforced on chain by the Covar router" : undefined} />
        )}
        <Row
          k={"Slippage & routing fee"}
          v={`${(DEFAULT_SLIPPAGE_BPS / 100).toFixed(1)}% max · ${market?.route?.via === "router" && market.route.router ? `${(market.route.router.feeBps / 100).toFixed(2)}% Covar fee` : quote?.fees.integrator ? `${fmtU(quote.fees.integrator.amount, 4)} USDG Covar fee` : "no Covar fee"}`}
          sub={market?.route ? (market.route.via === "router" ? `via CovarStockRouter ${market.route.router ? shortAddr(market.route.router.address, 4) : ""} → 0x` : "via 0x AllowanceHolder") : undefined}
        />
        {buy && intent.takeProfitPct !== undefined && (
          <div className="tp-box" data-testid="rr-target">
            <div className="row between">
              <span className="small strong">Target take-profit</span>
              <span className="small strong trade-ok">
                +{intent.takeProfitPct}% ({usd2(tgt)})
              </span>
            </div>
            {stop && (
              <div className="row between">
                <span className="tiny">Stop-loss</span>
                <span className="tiny trade-warn">
                  −{intent.stopLossPct}% ({usd2(stop)})
                </span>
              </div>
            )}
            <span className="tiny">
              {`The watcher tracks the share price and tells you when the target hits (≈ +${usd2(estProfit)} from the price move; the real result is the sell quote at that time, after spread & fees).`}
            </span>
          </div>
        )}
      </div>

      {p.quoteErr && <div className="notice notice-warn"><div>{p.quoteErr}</div></div>}
      {balanceShort && <div className="notice notice-warn"><div>{buy ? "Not enough USDG in this wallet." : `Not enough ${asset.symbol} in this wallet.`}</div></div>}

      {market?.tradingEnabled && market.region.allowed && (
        <label className="row gap-8 tiny" style={{ alignItems: "flex-start" }}>
          <input type="checkbox" checked={p.attested} onChange={(e) => p.onAttest(e.target.checked)} data-testid="agent-attest" style={{ marginTop: 2 }} />
          <span>
            I am not a U.S. person, I am not located in a restricted jurisdiction, and I understand Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited that track a share price but carry no shareholder rights.
          </span>
        </label>
      )}

      <div className="row gap-6 tiny steps">
        <span className={cx("step", (p.step === "approve" || p.step === "approve_wait") && "step-on", p.wallet && !needApprove && "step-done")}>1. Approve {buy ? "USDG" : asset.symbol}</span>
        <span>→</span>
        <span className={cx("step", (p.step === "quote" || p.step === "sign" || p.step === "confirming") && "step-on")}>2. {"Execute swap on-chain"}</span>
      </div>

      {p.step && (
        <div className="notice notice-neutral" data-testid="agent-step">
          <div>
            {STEP_TEXT[p.step]}
            {p.stepHash && (
              <a href={txUrl(p.stepHash)} target="_blank" rel="noreferrer noopener" className="mono tiny" style={{ marginLeft: 6 }}>
                {shortAddr(p.stepHash, 6)} ↗
              </a>
            )}
          </div>
        </div>
      )}

      <div className="row gap-8">
        <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={p.onExecute} disabled={!!p.step || (!!p.account && !ready) || !market?.tradingEnabled || !market.region.allowed} data-testid="agent-execute">
          {!market?.tradingEnabled || !market?.region.allowed
            ? "Trading not available"
            : !p.account
              ? "Connect wallet"
              : p.step
                ? "Submitting to wallet…"
                : buy
                  ? `${needApprove ? "Approve & " : ""}Buy ${asset.symbol} On-Chain`
                  : `${needApprove ? "Approve & " : ""}Sell ${asset.symbol} On-Chain`}
        </button>
        <button className="btn btn-secondary btn-lg" onClick={p.onCancel} disabled={!!p.step}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- active watcher */

export function ActiveStockWatcherCard({
  p,
  price,
  busy,
  step,
  onSell,
  onDismiss,
  account,
}: {
  p: StockPosition;
  price: StockPrice | undefined;
  busy: boolean;
  step: TradeStep | null;
  onSell: () => void;
  onDismiss: () => void;
  account: string | null;
}) {
  const w = watchState(p, price?.price);
  const hit = p.status === "target_hit";
  const stopped = p.status === "stop_hit";
  const [sellNow, setSellNow] = useState<{ usdg: bigint } | null>(null);

  // what selling right now would actually pay (indicative 0x quote), every 20 s
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const q = await fetchQuote({ symbol: p.symbol, side: "sell", amount: plainUnits(BigInt(p.shares), 18), taker: account ?? "", slippageBps: DEFAULT_SLIPPAGE_BPS, firm: false });
      if (alive) setSellNow(q.ok ? { usdg: BigInt(q.buyAmount) } : null);
    };
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [p.symbol, p.shares, account]);
  const nowPnl = sellNow ? sellNow.usdg - BigInt(p.usdgIn) : null;

  return (
    <div className={cx("rcard rcard-pad stack gap-12 watcher-card", hit && "watcher-hit", stopped && "watcher-stop")} data-testid="watcher-card" data-status={p.status}>
      <div className="row between wrap gap-8">
        <div className="row gap-8">
          <span className={cx("pill", hit ? "pill-green" : stopped ? "pill-red" : "pill-amber")} data-testid="watcher-status">
            <span className={cx("pill-ico", !hit && !stopped && "pill-live")}>
              <Icon name={hit ? "target" : stopped ? "alert" : "live"} size={12} />
            </span>
            {hit ? "TARGET ACHIEVED" : stopped ? "STOP HIT" : "ACTIVE WATCHER"}
          </span>
          <strong className="small">{p.symbol} {"Agent"}</strong>
        </div>
        <a className="tiny mono" href={tokenUrl(p.stockAddress)} target="_blank" rel="noreferrer noopener">
          {fmtS(p.shares, 5)} {p.symbol} ↗
        </a>
      </div>
      <div className="grid-2" style={{ gap: 12 }}>
        <div className="stack" style={{ gap: 2 }}>
          <span className="tiny">Entry price (share)</span>
          <span className="mono-num strong">{usd2(p.entryRef)}</span>
          <span className="tiny">{"paid"} {p.entryExec.toFixed(2)} USDG/{p.symbol}</span>
        </div>
        <div className="stack" style={{ gap: 2 }}>
          <span className="tiny">Current price</span>
          <span className={cx("mono-num strong", w.pnlPct !== null && (w.pnlPct >= 0 ? "pos" : "neg"))} data-testid="watcher-price">
            {usd2(price?.price)} {w.pnlPct !== null ? `(${w.pnlPct >= 0 ? "+" : ""}${w.pnlPct.toFixed(2)}%)` : ""}
          </span>
          <span className="tiny">{price?.label ?? "loading…"}</span>
        </div>
      </div>
      {p.targetRef && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="row between tiny">
            <span>
              {"Progress to target"} ({usd2(p.targetRef)} · +{p.takeProfitPct}%)
            </span>
            <span className="strong" data-testid="watcher-progress">{hit ? 100 : w.progressPct.toFixed(0)}%</span>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${hit ? 100 : w.progressPct}%` }} />
          </div>
        </div>
      )}
      {p.stopRef && <span className="tiny">Stop-loss {usd2(p.stopRef)} (−{p.stopLossPct}%)</span>}
      <div className="trade-row">
        <span className="tiny">Sell now (0x quote)</span>
        <span className="small num" style={{ textAlign: "right" }}>
          {sellNow ? `${fmtU(sellNow.usdg, 4)} USDG` : "—"}
          <span className={cx("tiny", nowPnl !== null && (nowPnl >= 0n ? "trade-ok" : "trade-warn"))} style={{ display: "block" }}>
            {nowPnl !== null ? `${nowPnl >= 0n ? "+" : ""}${fmtU(nowPnl, 4)} USDG vs cost ${fmtU(p.usdgIn, 2)}` : "available when trading is open"}
          </span>
        </span>
      </div>
      <span className="tiny">Polling the live price every 5 s while this page is open.</span>
      {busy && step && <span className="tiny">{STEP_TEXT[step]}</span>}
      <div className="row gap-8">
        <button className={cx("btn btn-lg", hit ? "btn-primary btn-lock" : "btn-exit")} style={{ flex: 1 }} onClick={onSell} disabled={busy} data-testid="watcher-sell">
          {hit ? `Lock Profit: Sell ${p.symbol} to USDG` : "Emergency Market Exit (Sell Now)"}
        </button>
        <button className="btn btn-secondary btn-lg" onClick={onDismiss} disabled={busy} title={"Remove the watcher (does not sell)"}>
          Dismiss
        </button>
      </div>
      <a className="tiny mono" href={txUrl(p.buyHash)} target="_blank" rel="noreferrer noopener">
        {"buy transaction"} {shortAddr(p.buyHash, 6)} ↗
      </a>
    </div>
  );
}

/* ------------------------------------------------------------ mini proof */

function MiniProof({ rec }: { rec: TradeRecord }) {
  const u = BigInt(rec.usdgDelta);
  const s = BigInt(rec.stockDelta);
  const ok = rec.status === "confirmed" && (rec.side === "buy" ? u < 0n && s > 0n : u > 0n && s < 0n);
  return (
    <div className="trade-proof" data-testid="agent-proof">
      <div className="row between">
        <span className="stat-label">Proof · read from the receipt</span>
        <span className={cx("pill", ok ? "pill-green" : "pill-red")}>{ok ? "Swap succeeded" : "Check"}</span>
      </div>
      <Row k="USDG" v={`${u > 0n ? "+" : ""}${fmtU(u, 6)}`} />
      <Row k={rec.symbol} v={`${s > 0n ? "+" : ""}${fmtS(s, 8)}`} sub={<a href={tokenUrl(rec.stockAddress)} target="_blank" rel="noreferrer noopener" className="mono">official {shortAddr(rec.stockAddress, 4)} ↗</a>} />
      {rec.covarEvent && <Row k={"Executed through Covar"} v={<span className="row gap-4"><Icon name="check" size={13} />{rec.covarEvent.kind}</span>} tone="ok" sub={`fee ${fmtU(rec.covarEvent.fee, 6)} USDG`} />}
      <Row k={"Transaction"} v={<a href={txUrl(rec.hash)} target="_blank" rel="noreferrer noopener" className="mono" data-testid="agent-proof-tx">{shortAddr(rec.hash, 8)} ↗</a>} sub={`block ${rec.block.toLocaleString("en-US")}`} />
    </div>
  );
}
