export const publicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Covar",
  appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  chainEnv: process.env.NEXT_PUBLIC_CHAIN_ENV ?? "testnet"
} as const;
