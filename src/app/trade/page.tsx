"use client";

/**
 * Covar Stock Trade — buy and sell Robinhood Stock Tokens from your own wallet.
 * First pair: USDG ↔ NVDA on Robinhood Chain mainnet, quoted and routed by 0x.
 *
 * Reference prices (Robinhood API, Chainlink) are labelled as reference; the
 * execution price, fees and minimum received come from a quote for this exact
 * trade. After confirmation the page reads the receipt's Transfer logs and the
 * wallet balances, so what you see is what actually moved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALLOWANCE_HOLDER,
  DEFAULT_SLIPPAGE_BPS,
  SLIPPAGE_CHOICES_BPS,
  STOCKS,
  USDG,
  fromUnits,
  toUnits,
  unitPrice,
  type MarketInfo,
  type Side,
  type TradeError,
  type TradeQuote,
} from "@/lib/stockTrade";
import {
  addressUrl,
  approveExact,
  spenderFor,
  fetchMarket,
  fetchQuote,
  hasAttested,
  loadHistory,
  readWallet,
  recordFromReceipt,
  saveTrade,
  sendSwap,
  setAttested,
  tokenUrl,
  txUrl,
  waitForFullReceipt,
  type TradeRecord,
  type WalletState,
} from "@/lib/stockTradeClient";
import { explainError } from "@/lib/vaultTx";
import { useWalletAccount } from "@/lib/useWalletAccount";
import { cx, shortAddr, timeAgo } from "@/lib/format";

const QUOTE_TTL_MS = 30_000;

/* -------------------------------------------------------------- formatting */
const fmtUsdg = (v: bigint | string, frac = 2) => fromUnits(BigInt(v), USDG.decimals, frac);
const fmtStock = (v: bigint | string, d = 18, frac = 6) => fromUnits(BigInt(v), d, frac);
const fmtEth = (wei: bigint | string) => fromUnits(BigInt(wei), 18, 7);
const plain = (v: bigint, d: number) => fromUnits(v, d, d).replace(/,/g, "");
const money = (n: number | null | undefined, frac = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac });
const pctDiff = (a: number, ref: number | null | undefined) => (ref ? ((a - ref) / ref) * 100 : null);

const SESSION_LABEL: Record<string, string> = { market: "Market hours", extended: "Extended hours", overnight: "Overnight" };

/* =================================================================== page */
export default function TradePage() {
  const asset = STOCKS[0];
  const { account, connect } = useWalletAccount();
  const [market, setMarket] = useState<MarketInfo | null>(null);
  const [marketErr, setMarketErr] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [preview, setPreview] = useState<TradeQuote | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [firm, setFirm] = useState<TradeQuote | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "info"; text: string; hash?: string } | null>(null);
  const [result, setResult] = useState<TradeRecord | null>(null);
  const [history, setHistory] = useState<TradeRecord[]>([]);
  const [attested, setAttestedState] = useState(false);
  const lastApprove = useRef<string | undefined>(undefined);

  useEffect(() => setAttestedState(hasAttested()), []);
  useEffect(() => setHistory(loadHistory(account)), [account]);

  /* ---- market (identity + reference prices), every 30 s */
  const loadMarket = useCallback(async () => {
    try {
      setMarket(await fetchMarket(asset.symbol));
      setMarketErr(null);
    } catch (e) {
      setMarketErr((e as Error).message);
    }
  }, [asset.symbol]);
  useEffect(() => {
    void loadMarket();
    const t = setInterval(() => void loadMarket(), 30_000);
    return () => clearInterval(t);
  }, [loadMarket]);

  /* ---- wallet balances, every 15 s */
  const spender = spenderFor(market);
  const loadWallet = useCallback(async () => {
    if (!account) return setWallet(null);
    try {
      setWallet(await readWallet(account, asset, spender));
    } catch {
      /* keep the last good read */
    }
  }, [account, asset, spender]);
  useEffect(() => {
    void loadWallet();
    const t = setInterval(() => void loadWallet(), 15_000);
    return () => clearInterval(t);
  }, [loadWallet]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const canTrade = !!market && market.tradingEnabled && market.region.allowed;
  const sellDecimals = side === "buy" ? USDG.decimals : asset.decimals;
  const sellSym = side === "buy" ? USDG.symbol : asset.symbol;
  const buySym = side === "buy" ? asset.symbol : USDG.symbol;
  const buyDecimals = side === "buy" ? asset.decimals : USDG.decimals;

  const parsed = useMemo(() => {
    if (!amount.trim()) return null;
    try {
      const v = toUnits(amount, sellDecimals);
      return v > 0n ? { v, error: null as string | null } : { v: 0n, error: "Enter an amount greater than zero." };
    } catch (e) {
      return { v: 0n, error: (e as Error).message };
    }
  }, [amount, sellDecimals]);

  const sellBalance = wallet ? (side === "buy" ? wallet.usdg : wallet.stock) : null;
  const allowance = wallet ? (side === "buy" ? wallet.usdgAllowance : wallet.stockAllowance) : null;
  const overBalance = !!(parsed && !parsed.error && sellBalance !== null && parsed.v > sellBalance);
  const needsApproval = !!(parsed && !parsed.error && allowance !== null && allowance < parsed.v);

  /* ---- indicative price, debounced; refreshed every 20 s */
  useEffect(() => {
    setFirm(null);
    if (!canTrade || !parsed || parsed.error) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    let stop = false;
    const run = async () => {
      setPreviewing(true);
      const q = await fetchQuote({ symbol: asset.symbol, side, amount, taker: account ?? "", slippageBps: slippage, firm: false });
      if (stop) return;
      setPreviewing(false);
      if (q.ok) {
        setPreview(q);
        setPreviewErr(null);
      } else {
        setPreview(null);
        setPreviewErr((q as TradeError).error);
      }
    };
    const t = setTimeout(() => void run(), 450);
    const iv = setInterval(() => void run(), 20_000);
    return () => {
      stop = true;
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [amount, side, slippage, account, canTrade, parsed, asset.symbol]);

  const ref = market?.chainlink?.price ?? null;
  const quote = firm ?? preview;
  const firmLeft = firm ? Math.max(0, Math.ceil((firm.quotedAt + QUOTE_TTL_MS - now) / 1000)) : 0;

  /* --------------------------------------------------------------- actions */
  const doConnect = async () => {
    try {
      await connect();
    } catch (e) {
      setMsg({ tone: "err", text: explainError(e) });
    }
  };

  const doApprove = async () => {
    if (!account || !parsed || parsed.error) return;
    const token = side === "buy" ? USDG.address : asset.address;
    setBusy("approve");
    setMsg({ tone: "info", text: `Approve ${side === "buy" ? fmtUsdg(parsed.v) : fmtStock(parsed.v, asset.decimals)} ${sellSym} for the 0x AllowanceHolder: confirm in your wallet…` });
    try {
      const hash = await approveExact(account, token, parsed.v, spender);
      setMsg({ tone: "info", text: "Approval sent, waiting for confirmation…", hash });
      const r = await waitForFullReceipt(hash);
      if (!r.ok) throw new Error("The approval failed on the network. Nothing moved except a small network fee.");
      lastApprove.current = hash;
      setMsg({ tone: "ok", text: `Approved in block ${r.blockNumber}. Next: review the order.`, hash });
      await loadWallet();
    } catch (e) {
      setMsg({ tone: "err", text: explainError(e) });
    } finally {
      setBusy(null);
    }
  };

  const doReview = async () => {
    if (!account || !parsed || parsed.error) return;
    setBusy("review");
    setMsg(null);
    const q = await fetchQuote({ symbol: asset.symbol, side, amount, taker: account, slippageBps: slippage, firm: true });
    setBusy(null);
    if (!q.ok) return setMsg({ tone: "err", text: (q as TradeError).error });
    if (q.allowance && BigInt(q.allowance.actual) < BigInt(q.sellAmount)) {
      await loadWallet();
      return setMsg({ tone: "err", text: `Approve ${sellSym} first (step 1), then review again.` });
    }
    if (q.balance) return setMsg({ tone: "err", text: `Your wallet doesn't have enough ${sellSym} for this trade.` });
    setFirm(q);
  };

  const doConfirm = async () => {
    if (!account || !firm?.transaction) return;
    if (firmLeft <= 0) return setMsg({ tone: "err", text: "This quote expired. Get a new one." });
    const q = firm;
    const before = wallet;
    setBusy("swap");
    setMsg({ tone: "info", text: `${side === "buy" ? "Buy" : "Sell"} ${asset.symbol}: confirm in your wallet…` });
    try {
      const hash = await sendSwap(account, q.transaction!, spender);
      setMsg({ tone: "info", text: "Trade sent, waiting for confirmation…", hash });
      const r = await waitForFullReceipt(hash);
      let after: WalletState | null = null;
      try {
        after = await readWallet(account, asset, spender);
        setWallet(after);
      } catch {
        /* balances refresh on the next poll */
      }
      const rec = recordFromReceipt({ hash, wallet: account, side, asset, receipt: r, quote: q, approveHash: lastApprove.current, before, after });
      saveTrade(rec);
      setHistory(loadHistory(account));
      setResult(rec);
      setFirm(null);
      lastApprove.current = undefined;
      if (!r.ok) setMsg({ tone: "err", text: "The trade failed on the network and nothing was swapped. Only a small network fee was spent.", hash });
      else {
        setMsg({ tone: "ok", text: `Trade confirmed in block ${r.blockNumber}.`, hash });
        setAmount("");
      }
    } catch (e) {
      setMsg({ tone: "err", text: explainError(e) });
    } finally {
      setBusy(null);
    }
  };

  const setMax = () => {
    if (sellBalance === null) return;
    setAmount(plain(sellBalance, sellDecimals));
  };

  /* ---------------------------------------------------------------- render */
  const roundTrip = useMemo(() => {
    const ok = history.filter((h) => h.status === "confirmed").sort((a, b) => a.block - b.block);
    const buy = ok.find((h) => h.side === "buy" && BigInt(h.stockDelta) > 0n);
    const sell = buy ? ok.find((h) => h.side === "sell" && h.block > buy.block && BigInt(h.usdgDelta) > 0n) : undefined;
    return buy && sell ? { buy, sell } : null;
  }, [history]);

  return (
    <div className="wrap-lg page-pad stack gap-20">
      <div className="row between wrap gap-16">
        <div className="stack gap-8" style={{ maxWidth: 680 }}>
          <span className="label-dot">Stock trade</span>
          <h1 className="page-title">Buy and sell Stock Tokens from your wallet</h1>
          <p className="page-sub">
            Spot trades between USDG and official Robinhood Stock Tokens on Robinhood Chain. Quotes come from 0x for the
            exact amount you enter, you sign in your own wallet, and the result is read back from the chain.
          </p>
        </div>
        <div className="row gap-8">
          <a className="btn btn-secondary" href={tokenUrl(asset.address)} target="_blank" rel="noreferrer noopener">
            {asset.symbol} contract ↗
          </a>
        </div>
      </div>

      <div className="trade-grid">
        {/* ------------------------------------------------------------ ticket */}
        <div className="rcard rcard-pad stack gap-14" data-testid="trade-ticket">
          <div className="row between gap-8">
            <div className="row gap-10" style={{ alignItems: "center" }}>
              <TokenMark symbol={asset.symbol} address={asset.address} />
              <div className="stack" style={{ gap: 2 }}>
                <span className="strong">{asset.name}</span>
                <span className="tiny">{asset.symbol} · Robinhood Stock Token</span>
              </div>
            </div>
            <div className="seg" role="tablist" aria-label="Buy or sell">
              {(["buy", "sell"] as const).map((s) => (
                <button key={s} role="tab" aria-selected={side === s} data-active={side === s} onClick={() => { setSide(s); setAmount(""); setResult(null); setMsg(null); }}>
                  {s === "buy" ? "Buy" : "Sell"}
                </button>
              ))}
            </div>
          </div>

          {market && !market.region.allowed && (
            <div className="notice notice-warn" role="alert" data-testid="region-blocked">
              <div>
                <strong>{market.region.message}</strong>
                <div className="tiny" style={{ marginTop: 4 }}>
                  Robinhood Stock Tokens are not offered in the United States or to U.S. persons, and are restricted in some other
                  jurisdictions.{" "}
                  <a href="https://docs.robinhood.com/rhj/restricted-jurisdictions" target="_blank" rel="noreferrer noopener">
                    Restricted jurisdictions ↗
                  </a>
                </div>
              </div>
            </div>
          )}
          {market && market.region.allowed && !market.tradingEnabled && (
            <div className="notice notice-neutral" data-testid="trade-soon">
              <div>
                {market.route?.problem ? `${market.route.problem} ` : ""}Stock trading opens soon. Prices and the token check below are already live.
              </div>
            </div>
          )}

          <label className="field stack gap-6">
            <div className="row between">
              <span className="stat-label">You {side === "buy" ? "pay" : "sell"}</span>
              <span className="tiny">
                {sellBalance !== null ? (
                  <>
                    Balance {side === "buy" ? fmtUsdg(sellBalance) : fmtStock(sellBalance, asset.decimals)} {sellSym}{" "}
                    <button type="button" className="link-btn" onClick={setMax} disabled={!canTrade}>
                      Max
                    </button>
                  </>
                ) : account ? (
                  "Reading balance…"
                ) : (
                  ""
                )}
              </span>
            </div>
            <div className="trade-input">
              <input
                className="input"
                inputMode="decimal"
                placeholder={side === "buy" ? "10.00" : "0.05"}
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setResult(null); }}
                disabled={!canTrade || !!busy}
                aria-label={`Amount of ${sellSym}`}
                data-testid="trade-amount"
              />
              <span className="trade-input-sym">{sellSym}</span>
            </div>
            {parsed?.error && <span className="tiny" style={{ color: "var(--red, #c4320a)" }}>{parsed.error}</span>}
            {overBalance && <span className="tiny" style={{ color: "var(--red, #c4320a)" }}>That&apos;s more than your wallet holds.</span>}
          </label>

          <div className="trade-receive">
            <span className="stat-label">You receive (estimated)</span>
            <div className="row between" style={{ alignItems: "baseline" }}>
              <span className="stat-value-sm num" data-testid="trade-estimate">
                {quote ? (side === "buy" ? fmtStock(quote.buyAmount, buyDecimals) : fmtUsdg(quote.buyAmount, 4)) : previewing ? "…" : "—"}
              </span>
              <span className="small strong">{buySym}</span>
            </div>
          </div>

          {previewErr && !firm && (
            <div className="notice notice-warn">
              <div>{previewErr}</div>
            </div>
          )}

          {quote && <QuotePreview quote={quote} side={side} refPrice={ref} buyDecimals={buyDecimals} firm={!!firm} />}

          <div className="row gap-8 wrap" style={{ alignItems: "center" }}>
            <span className="tiny">Max slippage</span>
            <div className="seg" aria-label="Maximum slippage">
              {SLIPPAGE_CHOICES_BPS.map((b) => (
                <button key={b} data-active={slippage === b} onClick={() => setSlippage(b)} disabled={!!busy}>
                  {(b / 100).toFixed(b % 100 ? 1 : 0)}%
                </button>
              ))}
            </div>
          </div>

          {canTrade && (
            <label className="row gap-8 tiny" style={{ alignItems: "flex-start", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => { setAttested(e.target.checked); setAttestedState(e.target.checked); }}
                style={{ marginTop: 2 }}
                data-testid="trade-attest"
              />
              <span>
                I am not a U.S. person, I am not located in a restricted jurisdiction, and I understand Stock Tokens are tokenized
                debt securities issued by Robinhood Assets (Jersey) Limited that track a share price but carry no shareholder rights.
              </span>
            </label>
          )}

          {/* ---- actions */}
          {!account ? (
            <button className="btn btn-primary btn-lg btn-block" onClick={doConnect} disabled={!canTrade}>
              Connect wallet
            </button>
          ) : firm ? (
            <div className="stack gap-8">
              <button className="btn btn-primary btn-lg btn-block" onClick={doConfirm} disabled={!!busy || firmLeft <= 0} data-testid="trade-confirm">
                {busy === "swap" ? "Waiting for your wallet…" : firmLeft > 0 ? `Confirm ${side} in wallet · ${firmLeft}s` : "Quote expired"}
              </button>
              <div className="row gap-8">
                <button className="btn btn-secondary btn-block" onClick={doReview} disabled={!!busy}>
                  Get a new quote
                </button>
                <button className="btn btn-secondary btn-block" onClick={() => setFirm(null)} disabled={!!busy}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="stack gap-8">
              {needsApproval && (
                <button className="btn btn-secondary btn-lg btn-block" onClick={doApprove} disabled={!canTrade || !!busy || overBalance || !attested} data-testid="trade-approve">
                  {busy === "approve" ? "Approving…" : `Step 1 · Approve ${sellSym}`}
                </button>
              )}
              <button
                className="btn btn-primary btn-lg btn-block"
                onClick={doReview}
                disabled={!canTrade || !!busy || !parsed || !!parsed.error || overBalance || needsApproval || !attested || !preview}
                data-testid="trade-review"
              >
                {busy === "review" ? "Getting a firm quote…" : `${needsApproval ? "Step 2 · " : ""}Review ${side === "buy" ? "buy" : "sell"}`}
              </button>
              {!attested && canTrade && <span className="tiny">Tick the box above to continue.</span>}
            </div>
          )}

          {msg && (
            <div className={cx("notice", msg.tone === "err" ? "notice-warn" : "notice-neutral")} role={msg.tone === "err" ? "alert" : "status"}>
              <div>
                {msg.text}
                {msg.hash && (
                  <>
                    {" "}
                    <a href={txUrl(msg.hash)} target="_blank" rel="noreferrer noopener" className="mono">
                      {shortAddr(msg.hash, 6)} ↗
                    </a>
                  </>
                )}
              </div>
            </div>
          )}

          {result && <TradeProof rec={result} asset={asset} />}
        </div>

        {/* -------------------------------------------------------- side cards */}
        <div className="stack gap-16">
          <AssetCard market={market} error={marketErr} />
          <WalletCard account={account} wallet={wallet} asset={asset} onConnect={doConnect} />
        </div>
      </div>

      {/* ------------------------------------------------------------ history */}
      <div className="stack gap-10">
        <div className="row between wrap gap-8">
          <span className="stat-label">Your trades on Covar</span>
          {roundTrip && (
            <span className="pill pill-green" data-testid="round-trip">
              Round trip proven · USDG → {asset.symbol} → USDG
            </span>
          )}
        </div>
        <HistoryTable rows={history} account={account} />
      </div>
    </div>
  );
}

/* ============================================================ components */

function TokenMark({ symbol, address }: { symbol: string; address: string }) {
  const [broken, setBroken] = useState(false);
  const src = `https://cdn.robinhood.com/ncw_assets/logos/${address.toLowerCase()}.png`;
  return broken ? (
    <span className="trade-logo" aria-hidden>{symbol.slice(0, 2)}</span>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="trade-logo" src={src} alt="" width={36} height={36} onError={() => setBroken(true)} />
  );
}

function Row({ k, v, sub, tone }: { k: string; v: React.ReactNode; sub?: React.ReactNode; tone?: "warn" | "ok" }) {
  return (
    <div className="trade-row">
      <span className="tiny">{k}</span>
      <span className={cx("small num", tone === "warn" && "trade-warn", tone === "ok" && "trade-ok")} style={{ textAlign: "right" }}>
        {v}
        {sub && <span className="tiny" style={{ display: "block" }}>{sub}</span>}
      </span>
    </div>
  );
}

function QuotePreview({ quote, side, refPrice, buyDecimals, firm }: { quote: TradeQuote; side: Side; refPrice: number | null; buyDecimals: number; firm: boolean }) {
  const diff = pctDiff(quote.price, refPrice);
  // buying above / selling below the reference costs the user
  const adverse = diff !== null && (side === "buy" ? diff : -diff);
  const fee = (f: { amount: string; token: string } | null) => {
    if (!f) return null;
    const isUsdg = f.token.toLowerCase() === USDG.address.toLowerCase();
    return `${isUsdg ? fmtUsdg(f.amount, 4) : fmtStock(f.amount, 18)} ${isUsdg ? "USDG" : quote.symbol}`;
  };
  const buyFmt = (v: string) => (side === "buy" ? fmtStock(v, buyDecimals) : fmtUsdg(v, 4));
  const buySym = side === "buy" ? quote.symbol : "USDG";
  const sources = quote.route.map((r) => r.source.replace(/_/g, " ")).filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div className={cx("trade-preview", firm && "trade-preview-firm")} data-testid={firm ? "trade-firm" : "trade-preview"}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <span className="stat-label">{firm ? "Firm quote · ready to sign" : "Price preview"}</span>
        <span className={cx("pill", firm ? "pill-green" : "pill-ink")}>{firm ? "Executable" : "Indicative"}</span>
      </div>
      <Row k="Execution price" v={`1 ${quote.symbol} = ${money(quote.price, 2)} USDG`} />
      <Row
        k="vs reference (Chainlink)"
        v={diff === null ? "—" : `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(2)}%`}
        sub={refPrice ? `ref ${money(refPrice, 2)} USDG` : undefined}
        tone={adverse !== false && adverse !== null && adverse > 2 ? "warn" : undefined}
      />
      <Row k="You receive (estimated)" v={`${buyFmt(quote.buyAmount)} ${buySym}`} />
      <Row k={`Minimum received (${(quote.slippageBps / 100).toFixed(1)}% slippage)`} v={quote.minBuyAmount ? `${buyFmt(quote.minBuyAmount)} ${buySym}` : "—"} />
      <Row k="0x fee" v={fee(quote.fees.zeroEx) ?? "none"} />
      {quote.fees.integrator && <Row k="Covar fee" v={fee(quote.fees.integrator)} />}
      <Row k="Network fee (gas)" v={quote.networkFeeWei ? `≈ ${fmtEth(quote.networkFeeWei)} ETH` : "—"} />
      {sources.length > 0 && <Row k="Route" v={sources.join(" + ")} />}
      {adverse !== false && adverse !== null && adverse > 2 && (
        <div className="tiny trade-warn" style={{ marginTop: 6 }}>
          This price is {adverse.toFixed(1)}% worse than the reference. That can happen outside U.S. market hours, when market makers
          widen their quotes.
        </div>
      )}
    </div>
  );
}

function AssetCard({ market, error }: { market: MarketInfo | null; error: string | null }) {
  if (!market) {
    return (
      <div className="rcard rcard-pad stack gap-8">
        <span className="stat-label">Token check</span>
        <span className="tiny">{error ?? "Loading…"}</span>
      </div>
    );
  }
  const a = market.asset;
  const rh = market.robinhood;
  const cl = market.chainlink;
  const official = market.registry.verified && market.onchain.uidMatches !== false;
  return (
    <div className="rcard rcard-pad stack gap-10" data-testid="asset-card">
      <div className="row between">
        <span className="stat-label">Token check</span>
        <span className={cx("pill", official ? "pill-green" : "pill-amber")} data-testid="official-badge">
          {official ? "Official Robinhood token" : "Not verified"}
        </span>
      </div>
      <Row
        k="Contract"
        v={
          <a href={tokenUrl(a.address)} target="_blank" rel="noreferrer noopener" className="mono">
            {shortAddr(a.address, 6)} ↗
          </a>
        }
      />
      <Row k="Robinhood registry" v={market.registry.verified ? "address matches ✓" : "couldn't confirm"} tone={market.registry.verified ? "ok" : "warn"} />
      <Row k="On-chain uid()" v={market.onchain.uidMatches === null ? "—" : market.onchain.uidMatches ? "matches registry ✓" : "mismatch"} tone={market.onchain.uidMatches ? "ok" : market.onchain.uidMatches === false ? "warn" : undefined} />
      <Row k="Token status" v={market.onchain.paused ? "paused" : market.registry.status === "ASSET_STATUS_ACTIVE" ? "active" : market.registry.status ?? "—"} tone={market.onchain.paused ? "warn" : undefined} />
      {market.registry.multiplier && <Row k="Shares per token" v={Number(market.registry.multiplier).toFixed(6)} sub="corporate-action multiplier" />}

      <div className="rcard-sep" />
      <span className="stat-label">Reference prices</span>
      <Row
        k="Chainlink feed"
        v={cl?.price ? `${money(cl.price, 2)} USD` : "—"}
        sub={cl?.updatedAt ? `updated ${timeAgo(new Date(cl.updatedAt * 1000).toISOString())}` : undefined}
      />
      <Row
        k="Robinhood bid / ask"
        v={rh?.tokenBid && rh?.tokenAsk ? `${money(rh.tokenBid, 2)} / ${money(rh.tokenAsk, 2)}` : "—"}
        sub={rh?.halted ? "trading halt" : rh?.at ? `as of ${new Date(rh.at).toLocaleTimeString()}` : undefined}
        tone={rh?.halted ? "warn" : undefined}
      />
      {market.registry.sessions && (
        <Row
          k="Sessions"
          v={Object.entries(market.registry.sessions)
            .map(([k, v]) => `${SESSION_LABEL[k] ?? k} ${v.endsWith("TRADABLE") ? "✓" : "—"}`)
            .join(" · ")}
        />
      )}
      <span className="tiny">
        Reference prices are for context. What you pay or receive is the quote for your exact trade.
      </span>
    </div>
  );
}

function WalletCard({ account, wallet, asset, onConnect }: { account: string | null; wallet: WalletState | null; asset: (typeof STOCKS)[number]; onConnect: () => void }) {
  return (
    <div className="rcard rcard-pad stack gap-10" data-testid="wallet-card">
      <div className="row between">
        <span className="stat-label">Your wallet · Robinhood Chain</span>
        {account && (
          <a className="tiny mono" href={addressUrl(account)} target="_blank" rel="noreferrer noopener">
            {shortAddr(account, 4)} ↗
          </a>
        )}
      </div>
      {!account ? (
        <button className="btn btn-secondary" onClick={onConnect}>
          Connect wallet
        </button>
      ) : !wallet ? (
        <span className="tiny">Reading balances…</span>
      ) : (
        <>
          <Row k="USDG" v={fmtUsdg(wallet.usdg, 4)} />
          <Row k={asset.symbol} v={fmtStock(wallet.stock, asset.decimals)} />
          <Row k="ETH (for gas)" v={fmtEth(wallet.eth)} tone={wallet.eth === 0n ? "warn" : undefined} sub={wallet.eth === 0n ? "add a little ETH to pay network fees" : undefined} />
          <Row
            k={wallet.spender.toLowerCase() === ALLOWANCE_HOLDER.toLowerCase() ? "Approved to 0x" : "Approved to Covar router"}
            v={`${fmtAllowance(wallet.usdgAllowance, (a) => fmtUsdg(a))} USDG · ${fmtAllowance(wallet.stockAllowance, (a) => fmtStock(a, asset.decimals, 4))} ${asset.symbol}`}
            sub={
              <a href={addressUrl(wallet.spender)} target="_blank" rel="noreferrer noopener">
                {wallet.spender.toLowerCase() === ALLOWANCE_HOLDER.toLowerCase() ? "AllowanceHolder" : "CovarStockRouter"} ↗
              </a>
            }
          />
        </>
      )}
    </div>
  );
}

function TradeProof({ rec, asset }: { rec: TradeRecord; asset: (typeof STOCKS)[number] }) {
  const u = BigInt(rec.usdgDelta);
  const s = BigInt(rec.stockDelta);
  const ok = rec.status === "confirmed" && (rec.side === "buy" ? u < 0n && s > 0n : u > 0n && s < 0n);
  const actualPrice = s !== 0n ? unitPrice(u < 0n ? -u : u, s < 0n ? -s : s, asset.decimals) : null;
  return (
    <div className="trade-proof" data-testid="trade-proof">
      <div className="row between">
        <span className="stat-label">Proof · read from the receipt</span>
        <span className={cx("pill", ok ? "pill-green" : "pill-red")}>{ok ? "Swap succeeded" : rec.status === "failed" ? "Failed" : "Check"}</span>
      </div>
      <Row k="USDG" v={`${u > 0n ? "+" : ""}${fmtUsdg(u, 6)}`} sub={u < 0n ? "left your wallet" : u > 0n ? "arrived in your wallet" : "no movement"} />
      <Row
        k={asset.symbol}
        v={`${s > 0n ? "+" : ""}${fmtStock(s, asset.decimals, 8)}`}
        sub={
          <a href={tokenUrl(rec.stockAddress)} target="_blank" rel="noreferrer noopener" className="mono">
            official token {shortAddr(rec.stockAddress, 4)} ↗
          </a>
        }
      />
      {actualPrice !== null && <Row k="Executed price" v={`${money(actualPrice, 2)} USDG / ${asset.symbol}`} />}
      {rec.minBuy && (
        <Row
          k="Received ≥ minimum"
          v={(rec.side === "buy" ? s : u) >= BigInt(rec.minBuy) ? "yes ✓" : "no"}
          tone={(rec.side === "buy" ? s : u) >= BigInt(rec.minBuy) ? "ok" : "warn"}
        />
      )}
      {rec.before && rec.after && (
        <Row
          k="Balances before → after"
          v={`${fmtUsdg(rec.before.usdg)} → ${fmtUsdg(rec.after.usdg)} USDG`}
          sub={`${fmtStock(rec.before.stock, asset.decimals)} → ${fmtStock(rec.after.stock, asset.decimals)} ${asset.symbol}`}
        />
      )}
      {rec.covarEvent && (
        <Row
          k="Executed through Covar"
          v={`${rec.covarEvent.kind} ✓`}
          tone="ok"
          sub={
            <a href={addressUrl(rec.covarEvent.router)} target="_blank" rel="noreferrer noopener" className="mono">
              CovarStockRouter {shortAddr(rec.covarEvent.router, 4)} · fee {fmtUsdg(BigInt(rec.covarEvent.fee), 6)} USDG ↗
            </a>
          }
        />
      )}
      <Row k="Network fee paid" v={`${fmtEth(rec.gasCostWei)} ETH`} />
      <Row
        k="Transaction"
        v={
          <a href={txUrl(rec.hash)} target="_blank" rel="noreferrer noopener" className="mono" data-testid="proof-tx">
            {shortAddr(rec.hash, 8)} ↗
          </a>
        }
        sub={`block ${rec.block.toLocaleString("en-US")}`}
      />
      {rec.approveHash && (
        <Row
          k="Approval"
          v={
            <a href={txUrl(rec.approveHash)} target="_blank" rel="noreferrer noopener" className="mono">
              {shortAddr(rec.approveHash, 6)} ↗
            </a>
          }
        />
      )}
    </div>
  );
}

function HistoryTable({ rows, account }: { rows: TradeRecord[]; account: string | null }) {
  if (!account) {
    return (
      <div className="table-wrap" style={{ padding: 18 }}>
        <span className="tiny">Connect your wallet to see the trades you made on Covar.</span>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="table-wrap" style={{ padding: 18 }}>
        <span className="tiny">No trades yet from this wallet on this device.</span>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table" data-testid="trade-history">
        <thead>
          <tr>
            <th>Time</th>
            <th>Side</th>
            <th className="right">Sent</th>
            <th className="right">Received</th>
            <th className="right">Price</th>
            <th>Status</th>
            <th className="right">Transaction</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const u = BigInt(r.usdgDelta);
            const s = BigInt(r.stockDelta);
            const sent = r.side === "buy" ? `${fmtUsdg(u < 0n ? -u : u)} USDG` : `${fmtStock(s < 0n ? -s : s, 18)} ${r.symbol}`;
            const got = r.side === "buy" ? `${fmtStock(s, 18)} ${r.symbol}` : `${fmtUsdg(u, 4)} USDG`;
            const px = s !== 0n ? unitPrice(u < 0n ? -u : u, s < 0n ? -s : s) : null;
            return (
              <tr key={r.hash}>
                <td className="tiny">{new Date(r.at).toLocaleString()}</td>
                <td>
                  <span className={cx("pill", r.side === "buy" ? "pill-green" : "pill-ink")}>{r.side === "buy" ? "Buy" : "Sell"}</span>
                </td>
                <td className="right">{r.status === "confirmed" ? sent : "—"}</td>
                <td className="right">{r.status === "confirmed" ? got : "—"}</td>
                <td className="right">{px ? money(px, 2) : "—"}</td>
                <td>
                  <span className={cx("badge", r.status === "confirmed" ? "badge-green" : "badge-red")}>{r.status === "confirmed" ? "Confirmed" : "Failed"}</span>
                </td>
                <td className="right">
                  <a href={txUrl(r.hash)} target="_blank" rel="noreferrer noopener" className="mono">
                    {shortAddr(r.hash, 6)} ↗
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Allowances set by other apps are often "infinite" (2^256-1); a 78-digit number helps no one. */
function fmtAllowance(v: bigint, fmt: (v: bigint) => string): string {
  return v >= 2n ** 128n ? "unlimited" : fmt(v);
}
