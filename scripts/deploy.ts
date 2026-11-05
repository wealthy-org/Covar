/**
 * Covar vault deployment.
 *
 *   TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/deploy.ts --network robinhoodTestnet
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
  // testnet: the brief's table is mainnet-only (verified: no bytecode at these
  // addresses on 46630). The testnet collateral address must be confirmed by the
  // owner against docs.robinhood.com/chain/contracts/ before use.
  46630: { symbol: "USDG", address: process.env.USDG_ADDRESS ?? "" },
  4663: { symbol: "USDG", address: process.env.USDG_ADDRESS ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" },
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
  const vault = await Vault.deploy(tokenCfg.address, feeRecipient, operator);
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

  console.log(`\n  vault      ${address}`);
  console.log(`  tx         ${manifest.txHash}`);
  console.log(`  manifest   ${file}\n`);
  console.log("Next:");
  console.log(`  1. set NEXT_PUBLIC_COVAR_VAULT_ADDRESS=${address} and NEXT_PUBLIC_RH_CHAIN_ID=${chainId}`);
  console.log("  2. report the first NAV from the operator wallet, then test a 10 USDG deposit");
  console.log("  3. verify the source on the explorer before advertising the address\n");
}

main().catch((e) => {
  console.error(`\nDeployment aborted: ${e.message}\n`);
  process.exitCode = 1;
});
