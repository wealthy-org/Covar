/**
 * Covar deployment preflight.
 *
 * Read-only checks against the target chain. Run this before every deployment —
 * it catches the failures that actually cost money: wrong chain, wrong token
 * address, wrong decimals, an unfunded key, or a stale public RPC.
 *
 *   TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/preflight.ts --network robinhoodTestnet
 */
import { ethers } from "ethers";

const NETWORKS: Record<string, { chainId: number; usdg: string; weth: string; rpc: string }> = {
  robinhoodTestnet: {
    chainId: 46630,
    rpc: process.env.RH_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com",
    // The brief's token table resolves on MAINNET only (verified 4 Nov 2026: no
    // bytecode at either address on 46630). Testnet collateral must be confirmed
    // by the owner — set USDG_ADDRESS explicitly, never inherit the mainnet value.
    usdg: process.env.USDG_ADDRESS ?? "",
    weth: process.env.WETH_ADDRESS ?? "",
  },
  robinhoodMainnet: {
    chainId: 4663,
    rpc: process.env.RH_MAINNET_RPC ?? "https://rpc.mainnet.chain.robinhood.com",
    usdg: process.env.USDG_ADDRESS ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    weth: process.env.WETH_ADDRESS ?? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  },
};

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];

type Result = { check: string; ok: boolean; detail: string; fatal: boolean };
const results: Result[] = [];
const record = (check: string, ok: boolean, detail: string, fatal = true) => {
  results.push({ check, ok, detail, fatal });
  const mark = ok ? "✓" : fatal ? "✗" : "!";
  console.log(`  ${mark} ${check} — ${detail}`);
};

async function main() {
  const networkName = process.env.HARDHAT_NETWORK ?? "robinhoodTestnet";
  const cfg = NETWORKS[networkName];
  if (!cfg) throw new Error(`Unknown network ${networkName}; use robinhoodTestnet or robinhoodMainnet`);

  console.log(`\nCovar preflight · ${networkName}\n`);

  const provider = new ethers.JsonRpcProvider(cfg.rpc, undefined, { staticNetwork: true });

  // 1 — chain identity
  try {
    const chainId = Number((await provider.getNetwork()).chainId);
    record("chain id", chainId === cfg.chainId, `RPC reports ${chainId}, expected ${cfg.chainId}`);
    const block = await provider.getBlockNumber();
    record("rpc reachable", true, `${cfg.rpc} · block ${block}`);
    const fee = await provider.getFeeData();
    record("gas price", !!fee.gasPrice, `${ethers.formatUnits(fee.gasPrice ?? 0n, "gwei")} gwei`);
  } catch (e) {
    record("rpc reachable", false, `${cfg.rpc} → ${(e as Error).message.slice(0, 120)}`);
    record(
      "network hint",
      false,
      "Robinhood Chain RPC is frequently blocked by Indonesian ISPs — enable a VPN and retry before blaming the endpoint",
      false
    );
  }

  // 2 — token contracts (the brief says verify code and decimals on-chain, never trust the table)
  for (const [label, address, expected] of [
    ["USDG", cfg.usdg, 6],
    ["WETH", cfg.weth, 18],
  ] as const) {
    if (!address) {
      record(
        `${label} address`,
        false,
        networkName === "robinhoodTestnet"
          ? `${label}_ADDRESS not set — the brief's table is mainnet-only on this chain; confirm the canonical testnet token first`
          : `${label}_ADDRESS not set`
      );
      continue;
    }
    const code = await provider.getCode(address).catch(() => "0x");
    if (code === "0x") {
      record(`${label} contract`, false, `no bytecode at ${address} on this chain`);
      continue;
    }
    const token = new ethers.Contract(address, ERC20_ABI, provider);
    const [decimals, symbol] = await Promise.all([token.decimals(), token.symbol().catch(() => label)]);
    record(`${label} contract`, true, `${address} · ${symbol} · ${decimals} decimals`);
    record(`${label} decimals`, Number(decimals) === expected, `${decimals} (expected ${expected})`);
  }

  // 3 — deployer key & funding
  const key = process.env.DEPLOYER_KEY;
  if (!key) {
    record("deployer key", false, "DEPLOYER_KEY not set — nothing can be signed (never commit this value)");
  } else {
    const wallet = new ethers.Wallet(key);
    const balance = await provider.getBalance(wallet.address);
    record("deployer key", true, `${wallet.address} (same wallet is used on testnet and mainnet)`);
    record(
      "deployer funded",
      balance > 0n,
      `${ethers.formatEther(balance)} ETH${balance === 0n ? " — claim testnet ETH from the Robinhood Chain or Chainlink faucet" : ""}`
    );
  }

  // 4 — authority configuration
  const operator = process.env.OPERATOR_ADDRESS;
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS;
  record("operator address", !!operator, operator ?? "OPERATOR_ADDRESS not set (isolated trading authority)");
  record("fee recipient address", !!feeRecipient, feeRecipient ?? "FEE_RECIPIENT_ADDRESS not set");
  if (operator && feeRecipient && operator.toLowerCase() === feeRecipient.toLowerCase()) {
    record("authority separation", false, "operator and fee recipient must not be the same wallet");
  }

  const fatalFails = results.filter((r) => !r.ok && r.fatal);
  console.log(
    fatalFails.length === 0
      ? "\nPreflight passed — deployment command is safe to run.\n"
      : `\nPreflight failed (${fatalFails.length} blocking issue${fatalFails.length > 1 ? "s" : ""}): ${fatalFails
          .map((r) => r.check)
          .join(", ")}\n`
  );
  if (fatalFails.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
