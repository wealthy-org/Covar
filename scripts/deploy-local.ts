/**
 * Local rehearsal deployment: MockUSDG + CovarVault against a local node.
 *
 *   npx hardhat node                                             # terminal 1
 *   npm run deploy:local                                         # terminal 2
 *   NEXT_PUBLIC_COVAR_VAULT_ADDRESS=0x… NEXT_PUBLIC_RH_CHAIN_ID=31337 npm run dev
 *
 * This is how the web app's on-chain read path is exercised without touching a
 * real chain: the UI switches from "Simulated" to "On-chain" and reads NAV,
 * shares, fees and pause flags straight from the contract.
 *
 * It also runs the investor path once (deposit → request → close → settle) so the
 * dashboard has real values to display.
 */
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

const USDG = (n: number | string) => ethers.parseUnits(String(n), 6);

async function main() {
  const [deployer, operator, feeRecipient, investor] = await ethers.getSigners();
  console.log(`\nLocal rehearsal deployment`);
  console.log(`  deployer  ${deployer.address}`);

  const Token = await ethers.getContractFactory("MockUSDG");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const Vault = await ethers.getContractFactory("CovarVault");
  const vault = await Vault.deploy(tokenAddress, feeRecipient.address, operator.address);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  // collateral for the rehearsal
  await token.mint(investor.address, USDG(5_000));
  await token.connect(investor).approve(vaultAddress, ethers.MaxUint256);

  // operator reports a first NAV, investor deposits, NAV moves up, withdrawal starts
  // Local chain only: lift the v2 launch limits so the rehearsal can use 2,000 USDG. Testnet/mainnet keep the defaults.
  await (await vault.setLimits(USDG(1_000_000), USDG(100_000))).wait();
  await (await vault.connect(operator).reportNav(USDG(0))).wait();
  await (await vault.connect(investor).deposit(USDG(2_000))).wait();
  await (await vault.connect(operator).reportNav(USDG(2_141.38))).wait(); // +8.2% on the deposited net
  await (await vault.connect(investor).requestWithdrawal(USDG(500))).wait();
  await (await vault.connect(operator).markPositionsClosed(investor.address)).wait();

  const nav = await vault.navPerShare();
  const manifest = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    network: "localhost",
    contract: "CovarVault",
    address: vaultAddress,
    asset: tokenAddress,
    constructorArgs: { asset: tokenAddress, feeRecipient: feeRecipient.address, operator: operator.address },
    investor: investor.address,
    navPerShare: ethers.formatUnits(nav, 18),
    totalShares: ethers.formatUnits(await vault.totalShares(), 6),
    reportedAssets: ethers.formatUnits(await vault.reportedAssets(), 6),
    deployedAt: new Date().toISOString(),
    notes: "Local rehearsal only. MockUSDG is a faucet token and must never reach mainnet.",
  };

  fs.mkdirSync(path.join(process.cwd(), "deployments"), { recursive: true });
  const file = path.join(process.cwd(), "deployments", `${manifest.chainId}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));

  console.log(`  USDG      ${tokenAddress}`);
  console.log(`  vault     ${vaultAddress}`);
  console.log(`  NAV       ${manifest.navPerShare}`);
  console.log(`  shares    ${manifest.totalShares}`);
  console.log(`  assets    ${manifest.reportedAssets}`);
  console.log(`  manifest  ${file}`);
  console.log(`\n  NEXT_PUBLIC_COVAR_VAULT_ADDRESS=${vaultAddress} NEXT_PUBLIC_RH_CHAIN_ID=31337 npm run dev\n`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
