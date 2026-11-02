export type NetworkMode = "practice" | "testnet" | "mainnet";

export const NETWORKS = {
  testnet: {
    name: "Robinhood Chain Testnet",
    chainId: 46630,
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    currency: "ETH",
    explorerUrl: "https://docs.robinhood.com/chain/"
  },
  mainnet: {
    name: "Robinhood Chain",
    chainId: 4663,
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    currency: "ETH",
    explorerUrl: "https://robinhoodchain.blockscout.com"
  }
} as const;

export const DEFAULT_NETWORK_MODE: NetworkMode = "testnet";
