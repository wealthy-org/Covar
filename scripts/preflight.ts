/**
 * Covar deployment preflight.
 *
 * Read-only checks against the target chain. Run this before every deployment —
 * it catches the failures that actually cost money: wrong chain, wrong token
 * address, wrong decimals, an unfunded key, or a stale public RPC.
 *
 *   pnpm preflight:testnet   (= node scripts/hardhat.mjs run scripts/preflight.ts --network robinhoodTestnet)
 */
import { ethers } from "ethers";

const NETWORKS: Record<string, { chainId: number; usdg: string; weth: string; rpc: string }> = {
  robinhoodTestnet: {
    chainId: 46630,
    rpc: process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com",
    // The brief's token table resolves on MAINNET only (no bytecode on 46630).
    // Testnet USDG as published by Paxos (docs.paxos.com/guides/stablecoin/usdg/testnet).
    usdg: process.env.USDG_ADDRESS || "0x7E955252E15c84f5768B83c41a71F9eba181802F",
    weth: process.env.WETH_ADDRESS || "",
  },
  robinhoodMainnet: {
    chainId: 4663,
    rpc: process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com",
    usdg: process.env.USDG_ADDRESS || "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    weth: process.env.WETH_ADDRESS || "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
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
  const networkName = process.env.HARDHAT_NETWORK || "robinhoodTestnet";
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
    // WETH is informational: the vault deployment only needs USDG.
    const fatal = label === "USDG";
    if (!address) {
      record(
        `${label} address`,
        !fatal,
        !fatal
          ? `${label}_ADDRESS not set — informational only, the vault deployment does not use ${label}`
          : networkName === "robinhoodTestnet"
            ? `${label}_ADDRESS not set — the brief's table is mainnet-only on this chain; confirm the canonical testnet token first`
            : `${label}_ADDRESS not set`,
        fatal
      );
      continue;
    }
    if (!ethers.isAddress(address)) {
      record(`${label} address`, false, `"${address}" is not a valid address`, fatal);
      continue;
    }
    const code = await provider.getCode(address).catch(() => "0x");
    if (code === "0x") {
      record(`${label} contract`, false, `no bytecode at ${address} on this chain`, fatal);
      continue;
    }
    const token = new ethers.Contract(address, ERC20_ABI, provider);
    const [decimals, symbol] = await Promise.all([token.decimals(), token.symbol().catch(() => label)]);
    record(`${label} contract`, true, `${address} · ${symbol} · ${decimals} decimals`);
    record(`${label} decimals`, Number(decimals) === expected, `${decimals} (expected ${expected})`, fatal);
  }

  // 3 — deployer key & funding
  const key = process.env.DEPLOYER_KEY;
  let deployer = "";
  if (!key) {
    record("deployer key", false, "DEPLOYER_KEY not set — nothing can be signed (never commit this value)");
  } else if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    record("deployer key", false, "DEPLOYER_KEY is not a 64-hex-character private key (check for spaces, quotes or a seed phrase)");
  } else {
    const wallet = new ethers.Wallet(key);
    deployer = wallet.address;
    record("deployer key", true, `${wallet.address} (same wallet is used on testnet and mainnet)`);
    try {
      const balance = await provider.getBalance(wallet.address);
      record(
        "deployer funded",
        balance > 0n,
        `${ethers.formatEther(balance)} ETH${balance === 0n ? " — claim testnet ETH from the Robinhood Chain faucet" : ""}`
      );
    } catch (e) {
      record("deployer funded", false, `balance check failed: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  // 4 — authority configuration
  const operator = process.env.OPERATOR_ADDRESS;
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS;
  for (const [check, value, envKey] of [
    ["operator address", operator, "OPERATOR_ADDRESS"],
    ["fee recipient address", feeRecipient, "FEE_RECIPIENT_ADDRESS"],
  ] as const) {
    if (!value) record(check, false, `${envKey} not set`);
    else if (!ethers.isAddress(value)) record(check, false, `"${value}" is not a valid address`);
    else record(check, true, ethers.getAddress(value));
  }
  if (operator && feeRecipient && operator.toLowerCase() === feeRecipient.toLowerCase()) {
    record("authority separation", false, "operator and fee recipient must not be the same wallet");
  }
  if (deployer && operator && deployer.toLowerCase() === operator.toLowerCase()) {
    record("admin/operator separation", false, "operator should be a different wallet from the admin/deployer", false);
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
