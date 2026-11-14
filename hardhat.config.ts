import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import { config as loadEnv } from "dotenv";

// Load secrets/config from .env.local then .env (first one wins; values already
// set in the shell are never overridden). Hardhat does not read .env on its own.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

// Template placeholders ("0x...", "https://<url-alchemy-testnet>") count as unset,
// so a half-filled .env falls back to safe defaults instead of failing obscurely.
for (const k of ["DEPLOYER_KEY", "OPERATOR_ADDRESS", "FEE_RECIPIENT_ADDRESS", "USDG_ADDRESS", "WETH_ADDRESS", "RH_TESTNET_RPC", "RH_MAINNET_RPC"]) {
  const v = process.env[k]?.trim();
  if (!v || v.includes("<") || v.includes("...")) delete process.env[k];
  else process.env[k] = v;
}
// Accept a key pasted without the 0x prefix (MetaMask exports it that way).
if (process.env.DEPLOYER_KEY && /^[0-9a-fA-F]{64}$/.test(process.env.DEPLOYER_KEY)) {
  process.env.DEPLOYER_KEY = `0x${process.env.DEPLOYER_KEY}`;
}
const validKey = (k?: string) => !!k && /^0x[0-9a-fA-F]{64}$/.test(k);

/**
 * Covar contract build.
 *
 * Deployment order is fixed by the brief (§4):
 *   testnet 46630 → full suite → mainnet 4663, small controlled value first.
 * Never the other way around.
 *
 * Keys come from the environment only. Never commit a deployer key; the same
 * wallet is used for testnet and mainnet (single-owner model, documented risk).
 */
const DEPLOYER_KEY = validKey(process.env.DEPLOYER_KEY) ? process.env.DEPLOYER_KEY : undefined;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // HARDHAT_FORK_URL=https://rpc.mainnet.chain.robinhood.com → fork tests against real tokens
    hardhat: { chainId: 31337, ...(process.env.HARDHAT_FORK_URL ? { forking: { url: process.env.HARDHAT_FORK_URL } } : {}) },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    robinhoodTestnet: {
      url: process.env.RH_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
    robinhoodMainnet: {
      url: process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [],
    },
  },
  paths: { tests: "tests/contracts" },
};

export default config;
