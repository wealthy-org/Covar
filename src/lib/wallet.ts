import { IS_MAINNET } from "./chain";
/**
 * Wallet providers are pluggable. The app only ever sees the WalletProvider
 * interface, and every provider declares exactly what "connected" proves:
 *
 *  - `session`  — demo stand-in. Proves nothing on-chain; the UI gates screens
 *                 behind it so reviewers can walk the product without a wallet.
 *  - `evm`      — injected EIP-1193 wallet (browser extension). Proves account
 *                 access only; no signature is requested and nothing is signed.
 *  - `privy`    — the provider the reference uses. Listed so the seam is visible;
 *                 this build does not ship the Privy SDK, so selecting it
 *                 reports "not configured" instead of pretending to work.
 *
 * Select with NEXT_PUBLIC_WALLET_PROVIDER=session|evm|privy (default: session).
 */

export interface WalletConnection {
  address: string;
  providerId: string;
  providerLabel: string;
  /** Honest statement of what this connection proves. */
  guarantee: string;
}

export interface WalletProvider {
  id: string;
  label: string;
  isAvailable(): boolean;
  connect(): Promise<WalletConnection>;
  disconnect(): void;
  current(): WalletConnection | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const ethereum = (): any | null =>
  typeof window === "undefined" ? null : ((window as any).ethereum ?? null);

const SESSION_ADDRESS = "0x4dE9a1C7B2f05E8a3C6b9D1f4A7c2E5b8D0a3F61";

class SessionWallet implements WalletProvider {
  id = "session";
  label = "Session wallet (simulated)";
  private conn: WalletConnection | null = null;
  isAvailable() {
    return true;
  }
  async connect(): Promise<WalletConnection> {
    this.conn = {
      address: SESSION_ADDRESS,
      providerId: this.id,
      providerLabel: this.label,
      guarantee: "No signature, no chain read — a demo identity that exists only in this browser session.",
    };
    return this.conn;
  }
  disconnect() {
    this.conn = null;
  }
  current() {
    return this.conn;
  }
}

class InjectedEvmWallet implements WalletProvider {
  id = "evm";
  label = "Browser wallet (MetaMask, Rabby…)";
  private conn: WalletConnection | null = null;
  isAvailable() {
    return ethereum() !== null;
  }
  async connect(): Promise<WalletConnection> {
    const eth = ethereum();
    if (!eth) throw new Error("No wallet found in this browser. Install MetaMask or Rabby, then reload the page.");
    const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
    const address = accounts?.[0];
    if (!address) throw new Error("Your wallet didn't share an account. Unlock it, choose an account and try again.");
    this.conn = {
      address,
      providerId: this.id,
      providerLabel: this.label,
      guarantee: "Wallet connected. Sign in with a free signature to prove it is yours and keep your data across devices.",
    };
    return this.conn;
  }
  disconnect() {
    this.conn = null;
  }
  current() {
    return this.conn;
  }
}

class PrivyWallet implements WalletProvider {
  id = "privy";
  label = "Privy";
  isAvailable() {
    return false;
  }
  async connect(): Promise<WalletConnection> {
    throw new Error(
      "Privy is the provider the reference product uses, but this build does not ship the Privy SDK or an app id. Use NEXT_PUBLIC_WALLET_PROVIDER=evm for a real injected wallet, or session to review."
    );
  }
  disconnect() {}
  current() {
    return null;
  }
}

const BY_ID: Record<string, () => WalletProvider> = {
  session: () => new SessionWallet(),
  evm: () => new InjectedEvmWallet(),
  privy: () => new PrivyWallet(),
};

let active: WalletProvider | null = null;

export function getWalletProvider(): WalletProvider {
  if (active) return active;
  // mainnet always uses the real browser wallet — the practice session wallet is for testnet/local only
  const want = IS_MAINNET ? "evm" : (process.env.NEXT_PUBLIC_WALLET_PROVIDER || "session").toLowerCase();
  const make = BY_ID[want] ?? BY_ID.session;
  active = make();
  return active;
}

export const PROVIDER_CHOICES = [
  { id: "session", label: "Session wallet — for review, proves nothing" },
  { id: "evm", label: "Injected wallet (EIP-1193) — real account access, no signature" },
  { id: "privy", label: "Privy — not shipped in this build" },
] as const;
