"use client";
/**
 * Client side of Sign-In with Ethereum (package 3.2).
 *
 * The server writes the EIP-4361 text; the wallet signs it with personal_sign
 * (free, no transaction); the server verifies it and sets an HttpOnly cookie.
 * This module never sees the cookie. It only knows "who is signed in" by asking
 * /api/auth/session.
 */
import { useSyncExternalStore } from "react";
import { explainError, injected, isStaleExtension, STALE_WALLET_MSG, switchChain } from "./vaultTx";
import { CHAINS, EXPECTED_CHAIN_ID } from "./chain";
import { actions } from "./store";

export interface AuthUser {
  address: string;
  chainId: number;
  expiresAt: string;
}
type AuthState = { status: "unknown" | "signed-out" | "signed-in" | "signing"; user: AuthUser | null; error?: string };

let auth: AuthState = { status: "unknown", user: null };
const listeners = new Set<() => void>();
const setAuth = (next: AuthState) => {
  auth = next;
  listeners.forEach((l) => l());
};
let loaded = false;

export async function refreshSession(): Promise<AuthUser | null> {
  try {
    const r = await fetch("/api/auth/session", { cache: "no-store" }).then((x) => x.json());
    const user = (r?.user ?? null) as AuthUser | null;
    setAuth({ status: user ? "signed-in" : "signed-out", user });
    return user;
  } catch {
    setAuth({ status: "signed-out", user: null });
    return null;
  }
}

const toHex = (s: string) => "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Sign in with the wallet's account. `pickAccount` first opens the wallet's own
 * account picker (wallet_requestPermissions) — MetaMask otherwise returns the
 * account already connected to this site, not the one selected in the extension.
 */
export async function signInWithEthereum(opts: { pickAccount?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  const eth = injected();
  if (!eth) return { ok: false, error: "No browser wallet found. Install MetaMask or Rabby, then retry." };
  setAuth({ ...auth, status: "signing", error: undefined });
  try {
    if (opts.pickAccount) {
      try {
        await eth.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
      } catch (e) {
        const code = (e as { code?: number })?.code;
        if (code === 4001) throw e;
        // -32601 / unsupported: fall back to eth_requestAccounts below
      }
    }
    const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
    const address = accounts?.[0];
    if (!address) throw new Error("Your wallet didn't share an account. Unlock it, choose an account and try again.");
    let chainId = parseInt(await eth.request({ method: "eth_chainId" }), 16);
    // Wallet on another network (e.g. Ethereum mainnet)? Ask it to switch to this
    // app's chain first (adds the network if the wallet doesn't know it yet).
    if (chainId !== EXPECTED_CHAIN_ID) {
      try {
        await switchChain(EXPECTED_CHAIN_ID);
      } catch (e) {
        if ((e as { code?: number })?.code === 4001) throw new Error(`To sign in, allow your wallet to switch to ${CHAINS[EXPECTED_CHAIN_ID].name}.`);
        throw e;
      }
      chainId = parseInt(await eth.request({ method: "eth_chainId" }), 16);
      if (chainId !== EXPECTED_CHAIN_ID) throw new Error(`Your wallet is on a different network. Switch it to ${CHAINS[EXPECTED_CHAIN_ID].name} and try again.`);
    }

    const n = await fetch("/api/auth/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, chainId }) }).then((x) => x.json());
    if (!n?.ok) throw new Error(n?.error ?? "Could not start sign-in.");

    const signature: string = await eth.request({ method: "personal_sign", params: [toHex(n.message), address] });

    const v = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: n.message, signature }) }).then((x) => x.json());
    if (!v?.ok) throw new Error(v?.error ?? "Sign-in was refused.");
    setAuth({ status: "signed-in", user: v.user });
    await actions.adoptAccount(v.user.address);
    return { ok: true };
  } catch (e) {
    const err = e as { code?: number; message?: string };
    const error =
      err?.code === 4001 ? "You cancelled the signature in your wallet, so you're not signed in." : isStaleExtension(e) ? STALE_WALLET_MSG : friendlyAuthError(e);
    setAuth({ status: auth.user ? "signed-in" : "signed-out", user: auth.user, error });
    return { ok: false, error };
  }
}

/** Sign-in failures in plain words (server messages are precise but technical). */
function friendlyAuthError(e: unknown): string {
  const raw = String((e as { message?: string })?.message ?? e ?? "");
  if (/too old|expired|nonce is unknown|already used|request a new one/i.test(raw)) return "Your sign-in request expired. Please sign in again.";
  if (/issued for|URI does not match/i.test(raw)) return "This sign-in was made for a different website address. Refresh the page and sign in again.";
  if (/chain \d+ is not accepted/i.test(raw)) return `Switch your wallet to ${CHAINS[EXPECTED_CHAIN_ID].name} and sign in again.`;
  if (/smart-contract|does not match the address|could not be verified|65-byte/i.test(raw))
    return "That signature couldn't be matched to your wallet. Use a regular wallet account (smart-contract wallets aren't supported yet) and try again.";
  if (/too many/i.test(raw)) return "Too many sign-in attempts. Wait a minute and try again.";
  if (/cross-origin/i.test(raw)) return "Sign-in was blocked for security reasons. Open Covar from its main web address and try again.";
  if (/not an ethereum address/i.test(raw)) return "Your wallet returned an unexpected account. Choose another account and try again.";
  if (/could not start sign-in|sign-in was refused/i.test(raw)) return "Sign-in isn't available right now. Please try again in a moment.";
  return explainError(e);
}

/** The account the browser wallet currently exposes to this site (no prompt). */
export async function currentWalletAccount(): Promise<string | null> {
  const eth = injected();
  if (!eth) return null;
  try {
    const a: string[] = await eth.request({ method: "eth_accounts" });
    return a?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  setAuth({ status: "signed-out", user: null });
  actions.forgetAccount();
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      if (!loaded) {
        loaded = true;
        void refreshSession();
      }
      return () => listeners.delete(l);
    },
    () => auth,
    () => auth,
  );
}
