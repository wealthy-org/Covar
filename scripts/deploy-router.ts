/**
 * CovarStockRouter deployment (Instant Stock Agent, wrap-0x router).
 *
 *   HARDHAT_FORK_URL=https://rpc.mainnet.chain.robinhood.com pnpm deploy:router   # dry run on a fork
 *   CONFIRM_MAINNET=yes ROUTER_FEE_BPS=0 pnpm deploy:router --network robinhoodMainnet
 *
 * Mainnet-only: official Robinhood Stock Tokens and the 0x AllowanceHolder only exist
 * on 4663. Refuses to run without CONFIRM_MAINNET=yes.
 *
 * Steps:
 *   1. checks every address on chain (USDG = 6 decimals, AllowanceHolder has code,
 *      each stock token has code, 18 decimals and the expected symbol)
 *   2. deploys CovarStockRouter(USDG, AllowanceHolder, feeRecipient, feeBps)
 *   3. setStockSupported(token, true) for ROUTER_STOCKS (default: NVDA only, the first
 *      pair). TSLA etc. can be added later with the same call, no redeploy.
 *   4. writes deployments/router-4663.json and prints the env to set
 *      (STOCK_ROUTER_ADDRESS, TRADE_ROUTE=auto)
 *
 * Env:
 *   ROUTER_FEE_BPS        0..100, default 0 (needs an explicit decision before > 0)
 *   ROUTER_FEE_RECIPIENT  default: treasury C
 *   ROUTER_STOCKS         comma list from src/lib/stockTrade.ts STOCKS, default "NVDA"
 */
import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { STOCKS, USDG, ALLOWANCE_HOLDER } from "../src/lib/stockTrade";

const TREASURY = ethers.getAddress("0x8b43ac0f705d18d2c42d12eb2fabe3e45e1045b1"); // treasury C
const ERC20 = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  // on a fork, reads at the fork block itself fail (no hardfork history for 4663) — mine one local block first
  if (chainId === 31337 && process.env.HARDHAT_FORK_URL) await network.provider.send("evm_mine", []);
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account — set DEPLOYER_KEY in the shell (never commit it).");
  const balance = await ethers.provider.getBalance(deployer.address);

  const feeBps = Number(process.env.ROUTER_FEE_BPS || "0");
  const feeRecipient = ethers.getAddress(process.env.ROUTER_FEE_RECIPIENT || TREASURY);
  const wanted = (process.env.ROUTER_STOCKS || "NVDA").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

  console.log(`\nCovarStockRouter deployment`);
  console.log(`  chain          ${chainId}`);
  console.log(`  deployer       ${deployer.address} (${ethers.formatEther(balance)} ETH)`);
  console.log(`  fee            ${feeBps} bps → ${feeRecipient}`);
  console.log(`  stocks         ${wanted.join(", ")}`);

  // dry run: `HARDHAT_FORK_URL=<mainnet rpc> pnpm deploy:router` deploys into a local fork (31337) against the real tokens
  const dryRun = chainId === 31337 && !!process.env.HARDHAT_FORK_URL;
  if (dryRun) console.log(`  mode           DRY RUN on a local fork of mainnet — nothing is broadcast`);
  else if (chainId !== 4663) throw new Error(`Router targets Robinhood Chain mainnet (4663) only — got ${chainId}.`);
  else if (process.env.CONFIRM_MAINNET !== "yes") throw new Error("Refusing to deploy to mainnet without CONFIRM_MAINNET=yes.");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 100) throw new Error("ROUTER_FEE_BPS must be an integer 0..100.");
  if (balance === 0n) throw new Error("Deployer has no ETH for gas.");

  // 1. on-chain checks
  const usdg = new ethers.Contract(USDG.address, ERC20, deployer);
  if (Number(await usdg.decimals()) !== 6) throw new Error("USDG decimals ≠ 6");
  if ((await ethers.provider.getCode(ALLOWANCE_HOLDER)) === "0x") throw new Error("No code at the 0x AllowanceHolder");
  const stocks = wanted.map((sym) => {
    const s = STOCKS.find((x) => x.symbol === sym);
    if (!s) throw new Error(`${sym} is not in STOCKS (src/lib/stockTrade.ts)`);
    return s;
  });
  for (const s of stocks) {
    const t = new ethers.Contract(s.address, ERC20, deployer);
    const [dec, sym] = await Promise.all([t.decimals(), t.symbol()]);
    if (Number(dec) !== 18 || sym !== s.symbol) throw new Error(`${s.symbol} at ${s.address}: got ${sym}/${dec}`);
    console.log(`  ✓ ${s.symbol.padEnd(6)} ${s.address}`);
  }

  // 2. deploy
  const Router = await ethers.getContractFactory("CovarStockRouter");
  const router = await Router.deploy(USDG.address, ALLOWANCE_HOLDER, feeRecipient, feeBps);
  const deployTx = router.deploymentTransaction();
  await router.waitForDeployment();
  const address = await router.getAddress();
  const rcpt = await deployTx?.wait();
  console.log(`\n  router         ${address}  (block ${rcpt?.blockNumber}, tx ${deployTx?.hash})`);

  // 3. allowlist
  const allowTxs: Record<string, string> = {};
  for (const s of stocks) {
    const tx = await router.setStockSupported(s.address, true);
    await tx.wait();
    allowTxs[s.symbol] = tx.hash;
    console.log(`  allowlisted    ${s.symbol}  ${tx.hash}`);
  }

  // 4. manifest
  const manifest = {
    contract: "CovarStockRouter",
    chainId,
    address,
    deployer: deployer.address,
    owner: deployer.address,
    deployBlock: rcpt?.blockNumber ?? null,
    deployTx: deployTx?.hash ?? null,
    constructor: { usdg: USDG.address, allowanceHolder: ALLOWANCE_HOLDER, feeRecipient, feeBps },
    stocks: Object.fromEntries(stocks.map((s) => [s.symbol, { address: s.address, tx: allowTxs[s.symbol] }])),
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, dryRun ? `router-dryrun-fork.json` : `router-${chainId}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));

  console.log(`\n  manifest       ${path.relative(process.cwd(), file)}`);
  console.log(`\nNext:`);
  console.log(`  1. verify on Blockscout/Sourcify (solc 0.8.24, 200 runs, paris)`);
  console.log(`  2. Vercel env: STOCK_ROUTER_ADDRESS=${address}  TRADE_ROUTE=auto  (auto = falls back to direct 0x if a maker refuses the router)`);
  console.log(`  3. small proof: USDG→NVDA→USDG through the router, check StockPurchased/StockSold on the explorer\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
