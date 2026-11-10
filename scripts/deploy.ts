/**
 * Covar vault deployment.
 *
 *   pnpm deploy:testnet   (= node scripts/hardhat.mjs run scripts/deploy.ts --network robinhoodTestnet)
 *
 * Order (brief §4): testnet first, full suite green, end-to-end deposit → trade →
 * withdraw proven, and only then mainnet starting with a small controlled value.
 *
 * Mainnet requires an explicit confirmation flag — the script refuses to guess.
 *
 * Writes a manifest to deployments/<chainId>.json which the web app reads to
 * switch the vault UI from "simulated" to "on-chain".
 */
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

const TOKENS: Record<number, { symbol: string; address: string }> = {
  // testnet: the brief's table is mainnet-only (no bytecode on 46630). Paxos, the
  // USDG issuer, publishes the Robinhood Testnet token at docs.paxos.com/guides/
  // stablecoin/usdg/testnet (test funds: faucet.paxos.com). Checked on-chain.
  46630: { symbol: "USDG", address: process.env.USDG_ADDRESS || "0x7E955252E15c84f5768B83c41a71F9eba181802F" },
  4663: { symbol: "USDG", address: process.env.USDG_ADDRESS || "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" },
};

const ERC20_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`\nCovar vault deployment`);
  console.log(`  chain      ${chainId}`);
  console.log(`  deployer   ${deployer.address}`);
  console.log(`  balance    ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error("Deployer has no gas. Claim testnet ETH from a Robinhood Chain faucet before deploying.");
  }
  if (chainId === 4663 && process.env.CONFIRM_MAINNET !== "yes") {
    throw new Error(
      "Refusing to deploy to mainnet without CONFIRM_MAINNET=yes. Testnet must pass the full suite first, and the first mainnet launch uses a small controlled value."
    );
  }

  const tokenCfg = TOKENS[chainId];
  if (!tokenCfg?.address) {
    throw new Error(
      `No USDG address configured for chain ${chainId}. Set USDG_ADDRESS after verifying the token on-chain (code + 6 decimals) and against the official docs.`
    );
  }

  const code = await ethers.provider.getCode(tokenCfg.address);
  if (code === "0x") throw new Error(`No bytecode at USDG address ${tokenCfg.address} on chain ${chainId}`);

  const token = new ethers.Contract(tokenCfg.address, ERC20_ABI, deployer);
  const [decimals, symbol] = await Promise.all([token.decimals(), token.symbol()]);
  if (Number(decimals) !== 6) throw new Error(`USDG decimals is ${decimals}, expected 6`);
  console.log(`  collateral ${tokenCfg.address} · ${symbol} · ${decimals} decimals`);

  const operator = process.env.OPERATOR_ADDRESS;
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS;
  if (!operator || !feeRecipient) throw new Error("OPERATOR_ADDRESS and FEE_RECIPIENT_ADDRESS are required");
  if (operator.toLowerCase() === feeRecipient.toLowerCase()) {
    throw new Error("Operator and fee recipient must be separate wallets (isolated trading authority).");
  }

  const Vault = await ethers.getContractFactory("CovarVault");
  const minDep = process.env.VAULT_MIN_DEPOSIT_USDG || (chainId === 4663 ? "1" : "");
  // a stale checkout once deployed a vault without setMinDeposit (10 Nov) — fail before spending gas
  if (minDep && !Vault.interface.getFunction("setMinDeposit")) {
    throw new Error("This checkout's CovarVault has no setMinDeposit — pull the latest code (git log -1) before deploying.");
  }

  // gas budget: Robinhood Chain charges the actual base fee, but the wallet must
  // hold gasLimit × maxFeePerGas up front for each tx. ethers' default (2 × base)
  // doubles that. We pick the highest maxFee up to 1.5 × base that the balance
  // covers (never below 1.1 × base), with no tip, and check the real cost too.
  const feeOv: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasLimit?: bigint } = {};
  const block = await ethers.provider.getBlock("latest");
  let deployOv: typeof feeOv = {};
  if (block?.baseFeePerGas) {
    const base = block.baseFeePerGas;
    const deployTx = await Vault.getDeployTransaction(tokenCfg.address, feeRecipient, operator);
    const est = await ethers.provider.estimateGas({ ...deployTx, from: deployer.address });
    const gasLimit = (est * 105n) / 100n;
    const followUps = 200_000n; // setLimits + setMinDeposit, generous
    const fits = balance / gasLimit; // highest maxFee the balance covers for the deploy tx
    const maxFee = fits < (base * 3n) / 2n ? fits : (base * 3n) / 2n;
    const realCost = est * base + followUps * maxFee;
    console.log(
      `  gas        deploy ≈${est} gas · base ${ethers.formatUnits(base, "gwei")} gwei · max fee ${ethers.formatUnits(maxFee, "gwei")} gwei` +
        ` · up front ${ethers.formatEther(gasLimit * maxFee)} ETH · real cost ≈${ethers.formatEther(realCost)} ETH`
    );
    if (maxFee < (base * 11n) / 10n || balance < realCost) {
      const need = gasLimit * ((base * 11n) / 10n) > realCost ? gasLimit * ((base * 11n) / 10n) : realCost;
      throw new Error(`Deployer has ${ethers.formatEther(balance)} ETH but needs about ${ethers.formatEther(need)} ETH. Nothing was sent.`);
    }
    feeOv.maxFeePerGas = maxFee;
    feeOv.maxPriorityFeePerGas = 0n;
    deployOv = { ...feeOv, gasLimit };
  }

  const prevFile = path.join(process.cwd(), "deployments", `${chainId}.json`);
  if (fs.existsSync(prevFile)) {
    const prev = JSON.parse(fs.readFileSync(prevFile, "utf8"));
    if (prev?.address) {
      const keep = path.join(process.cwd(), "deployments", `${chainId}.superseded-${String(prev.address).slice(0, 10)}.json`);
      fs.copyFileSync(prevFile, keep);
      console.log(`  previous   ${prev.address} → kept as ${path.basename(keep)}`);
    }
  }

  const vault = await Vault.deploy(tokenCfg.address, feeRecipient, operator, deployOv);
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  const receipt = await vault.deploymentTransaction()?.wait();

  const manifest = {
    chainId,
    network: chainId === 46630 ? "robinhood-testnet" : chainId === 4663 ? "robinhood-mainnet" : "unknown",
    contract: "CovarVault",
    address,
    txHash: vault.deploymentTransaction()?.hash,
    blockNumber: receipt?.blockNumber,
    deployer: deployer.address,
    constructorArgs: { asset: tokenCfg.address, feeRecipient, operator },
    sharesDecimals: 6,
    assetSymbol: symbol,
    assetDecimals: Number(decimals),
    compiler: "0.8.24",
    deployedAt: new Date().toISOString(),
    notes:
      chainId === 4663
        ? "Mainnet. Single-owner admin (no multisig) — documented accepted risk. Launch with small controlled value."
        : "Testnet rehearsal. No real value. Run the acceptance suite and the full deposit → trade → withdraw path before mainnet.",
  };

  fs.mkdirSync(path.join(process.cwd(), "deployments"), { recursive: true });
  const file = path.join(process.cwd(), "deployments", `${chainId}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));

  const limits = new ethers.Contract(
    address,
    ["function maxTotalAssets() view returns (uint256)", "function maxDepositPerTx() view returns (uint256)", "function setLimits(uint256,uint256)", "function setMinDeposit(uint256)", "function minDeposit() view returns (uint256)"],
    deployer,
  );
  // first mainnet launch: small caps (owner decision 0.4 — TVL 100 / 25 per deposit), overridable via env
  const capTvl = process.env.VAULT_MAX_TOTAL_USDG || (chainId === 4663 ? "100" : "");
  const capTx = process.env.VAULT_MAX_PER_TX_USDG || (chainId === 4663 ? "25" : "");
  if (capTvl && capTx) {
    console.log(`\n  setting launch limits: TVL ${capTvl} USDG · per deposit ${capTx} USDG …`);
    const args = [ethers.parseUnits(capTvl, 6), ethers.parseUnits(capTx, 6)] as const;
    const g = await limits.setLimits.estimateGas(...args);
    const tx = await limits.setLimits(...args, { ...feeOv, gasLimit: (g * 120n) / 100n });
    await tx.wait();
    Object.assign(manifest, { launchLimits: { maxTotalAssets: capTvl, maxDepositPerTx: capTx, txHash: tx.hash } });
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  }
  // first mainnet test: 1 USDG minimum so a small wallet can run the full deposit → claim path (owner raises it later in the console)
  if (minDep) {
    console.log(`  setting minimum deposit: ${minDep} USDG …`);
    const g = await limits.setMinDeposit.estimateGas(ethers.parseUnits(minDep, 6));
    const tx = await limits.setMinDeposit(ethers.parseUnits(minDep, 6), { ...feeOv, gasLimit: (g * 120n) / 100n });
    await tx.wait();
    Object.assign(manifest, { minDeposit: { usdg: minDep, txHash: tx.hash } });
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  }
  console.log(`\n  vault      ${address}`);
  console.log(`  limits     TVL ${ethers.formatUnits(await limits.maxTotalAssets(), 6)} USDG · per deposit ${ethers.formatUnits(await limits.maxDepositPerTx(), 6)} USDG · minimum ${ethers.formatUnits(await limits.minDeposit(), 6)} USDG (owner: setLimits / setMinDeposit)`);
  console.log(`  tx         ${manifest.txHash}`);
  console.log(`  manifest   ${file}\n`);
  console.log("Next:");
  console.log(`  1. set NEXT_PUBLIC_COVAR_VAULT_ADDRESS=${address} and NEXT_PUBLIC_CHAIN_ENV=${chainId === 4663 ? "mainnet" : "testnet"}`);
  console.log("  2. report the first NAV from the operator wallet, then test a deposit at the minimum");
  console.log(`  3. verify the source: pnpm verify:${chainId === 4663 ? "mainnet" : "testnet"}`);
  console.log("  4. owner sets the trading account (venue deposit address) in /chain/console before any allocation");
  console.log("  5. remove DEPLOYER_KEY (and CONFIRM_MAINNET) from .env — see docs/GO_LIVE_RUNBOOK.md\n");
}

main().catch((e) => {
  console.error(`\nDeployment aborted: ${e.message}\n`);
  process.exitCode = 1;
});
