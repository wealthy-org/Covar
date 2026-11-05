# UI parity — matching the reference interface

Reference: `https://www.sharpe.ac/` (captured 4 Nov 2026 into `docs/reference/`).
Scope: **layout, type, spacing, component shapes and interaction patterns**. Colour is
not copied — the approved Covar palette (muted cobalt) stays locked, and P&L stays
semantic green/red.

Reference captures in this repo:

| File | What it shows |
| --- | --- |
| `docs/reference/landing.png` | Landing hero (contract strip, nav, headline + assistant card) |
| `docs/reference/scroll-01.png` | "How it works" — Build / Follow cards, step strip |
| `docs/reference/scroll-02.png` | "Why" — rules → copilot → risk chain, four proof cards, market chips |
| `docs/reference/scroll-03.png` | Infra cards + FAQ two-column layout |
| `docs/reference/explore.png` | Discover: title, tabs, sort, single table, mono footnote |
| `docs/reference/studio.png` | Wallet gate card ("Welcome to …") |

## Token mapping

| Role | Reference | Covar | Note |
| --- | --- | --- | --- |
| Page background | `#f4f4f2` (warm) | `#f7f8fc` (cool) | approved palette |
| Panel | `#ffffff` | `#ffffff` | same |
| Text | `#1a1a19` | `#171c2b` | same role |
| Accent | `#ef6a2e` (orange) | `#3b5bdb` (cobalt) | approved accent |
| Accent soft | `#fdeee6` | `#edf1ff` | announcement bar, icon dots |
| Raised | `#ececea` | `#eef0f7` | inputs, chips, step art |
| Border | `#e2e2df` | `#e3e7ef` | 1px everywhere |
| Positive / negative | `#17803d` / `#c9302c` | `#137a4b` / `#b42318` | P&L stays semantic |
| Ink (primary button) | `#0b0b0a` | `#10141f` | reference buttons are near-black, not accent |
| Radius | `0.25rem` (4px) | `3 / 4 / 6 / 8px` | deliberately square, not 12–18px |
| Sans / mono | Geist / Geist Mono | Geist / Geist Mono (`geist` package) | same fonts, self-hosted |

## Structure mapped screen by screen

| Reference | Covar | Status |
| --- | --- | --- |
| Top contract strip (`$SHRP CONTRACT ADDRESS` + COPY / VIEW ON ORBIO) | `.announce` strip: testnet vault address + COPY / VIEW ON EXPLORER, chain chip, says "not deployed yet" when there is none | done |
| Nav: mark + wordmark, uppercase mono links, `+ NEW AGENT`, `CONNECT WALLET` | same shape; links Discover / My Agents / My Money / Execution / Economics + `More ▾` | done |
| Hero: 2-line headline with accent second line, sub-copy, ink CTA, assistant chat card on the right | same; chat card is the real builder prompt→rules output, labelled `EXAMPLE` | done |
| `BUILT ON Lighter` strip | `BUILT ON Robinhood Chain · Lighter perps · testnet 46630` strip | done |
| How it works: Build (3 steps + CTA) / Follow (bullets + fee note), badges `BETA` / `SOON` | Build (01/02/03 steps) / Follow (vault bullets + fee note), badges `Beta` / `Testnet` | done |
| Why: Rules → Copilot → Risk chain, mono note, 4 proof cards, market chips | same chain with `data-last` emphasis on Risk engine, 4 proof cards, market chips | done |
| Infra section (3 cards) | "Built on Robinhood Chain" 3 cards → `/execution` | done |
| FAQ: eyebrow + title left, accordion right | same two-column layout | done |
| Closing CTA on dark band | same, ink band with white CTA | done |
| Discover: title, subtitle, tabs, `SORT BY` select, single table, mono footnote | same; tabs = Live vaults / Agent arena / Backtests, provenance is a column + tab boundary | done |
| Wallet gate card ("Welcome to …", 3 bullets, full-width ink button) | same card on `/studio` and `/portfolio`; adds one honest line: the wallet is a **session stand-in**, no keys | done |
| Footer: short mono link columns | same 4-column footer | done |

## Deliberate differences (and why)

1. **Colour** — cobalt replaces orange (owner instruction), warmer reference greys mapped to the approved cool palette.
2. **Wallet** — reference uses Privy. This build has a session wallet with no keys; the gate card says so instead of pretending a wallet connected.
3. **Imagery** — the reference uses rendered 3D props (scroll, hourglass, marble bust, candles). We use numbered tiles and icon dots; there are no stock images pretending to be product screenshots.
4. **Assistant example** — labelled `EXAMPLE`, and the numbers in it come from the deterministic parser, not from a fabricated trade.
5. **Numbers** — every table row carries its provenance; the reference shows "Real money · backtest numbers" in the subtitle, we show the provenance label plus the status.
6. **`SOON` features stay `SOON`** — token, staking and live venue are marked, not illustrated.

## Checking it

```bash
npm run dev            # http://localhost:3000
# compare against docs/reference/*.png
```

Screenshots of the result: `docs/screenshots/01-landing.png`, `02-discover.png`,
`00-wallet-gate.png`, `09-builder-chat.png`, `15-execution.png`, `16-mobile-landing.png`.
