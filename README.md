# Covar — Milestone B (UI foundation)

## Run with pnpm

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

On Windows PowerShell, use `Copy-Item .env.example .env.local`.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Included
- Shared desktop/mobile app shell and navigation
- Overview, Discover, My Agents (initial builder entry), and My Money pages
- Search, filter, and sorting interactions on Discover using explicitly labeled demo data
- Approved cobalt design tokens
- Testnet indicator and explicit wallet-integration placeholders

No wallet, trading, backtest, vault, or contract operations are implemented in this UI milestone. Demo performance figures are illustrative only.
