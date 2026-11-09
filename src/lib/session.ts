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
import { injected, isStaleExtension, STALE_WALLET_MSG, switchChain } from "./vaultTx";
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
    if (!address) throw new Error("The wallet returned no account.");
    let chainId = parseInt(await eth.request({ method: "eth_chainId" }), 16);
    // Wallet on another network (e.g. Ethereum mainnet)? Ask it to switch to this
    // app's chain first (adds the network if the wallet doesn't know it yet).
    if (chainId !== EXPECTED_CHAIN_ID) {
      try {
        await switchChain(EXPECTED_CHAIN_ID);
      } catch (e) {
        if ((e as { code?: number })?.code === 4001) throw new Error(`Switch your wallet to ${CHAINS[EXPECTED_CHAIN_ID].name} (${EXPECTED_CHAIN_ID}) to sign in.`);
        throw e;
      }
      chainId = parseInt(await eth.request({ method: "eth_chainId" }), 16);
      if (chainId !== EXPECTED_CHAIN_ID) throw new Error(`Your wallet is on chain ${chainId}. Switch it to ${CHAINS[EXPECTED_CHAIN_ID].name} (${EXPECTED_CHAIN_ID}) and retry.`);
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
      err?.code === 4001 ? "Signature request was rejected in the wallet." : isStaleExtension(e) ? STALE_WALLET_MSG : (err?.message ?? String(e));
    setAuth({ status: auth.user ? "signed-in" : "signed-out", user: auth.user, error });
    return { ok: false, error };
  }
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
