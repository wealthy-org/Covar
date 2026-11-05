# Deployment manifests

Written by `scripts/deploy.ts` and `scripts/deploy-local.ts`, one file per chain id. The web app does not
read these directly — it reads `NEXT_PUBLIC_COVAR_VAULT_ADDRESS` — but the manifest is the record of what
was deployed, with constructor arguments and the transaction hash.

- `31337.json` — local rehearsal (hardhat node). **Ephemeral:** addresses change on every restart, and the
  MockUSDG used there must never reach a real chain. Kept as evidence that the on-chain read path works.
- `46630.json` — testnet, produced by `npm run deploy:testnet` (not present yet: needs a funded key and a
  confirmed testnet USDG address).
- `4663.json` — mainnet, only after the testnet gates pass.

Never edit a manifest by hand; redeploy and let the script write it.
