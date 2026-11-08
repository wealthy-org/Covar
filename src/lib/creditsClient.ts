"use client";

/**
 * Copilot credits, client side (3.7). Balance and ledger come from the server
 * (/api/credits), which reads the DB. The browser never decides a balance.
 * A top-up is a USDG transfer signed in the user's wallet; the server credits it
 * only after reading the receipt from the chain.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ChainId } from "./chain";
import { calldata, encAddress, encUint, injected, parseUnits, sendTx, switchChain, waitForReceipt } from "./vaultTx";
import { useAuth } from "./session";

export interface CreditEntryView {
  id: string;
  kind: string;
  amountUsd: number;
  at: string;
  txHash: string | null;
  chainId: number | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  providerCostUsd: number | null;
  appFeeUsd: number | null;
  basis: string | null;
}
export interface CreditsConfig {
  mode: "enforce" | "off";
  model: string | null;
  chainId: number;
  usdg: string | null;
  treasury: string | null;
  topupsEnabled: boolean;
  minTopupUsd: number;
  maxTopupUsd: number;
  pricing: { inPerMTok: number | null; outPerMTok: number | null; appFeePct: number };
  reserveUsd: number;
}
export interface CreditsState {
  status: "loading" | "ready" | "error";
  signedIn: boolean;
  balanceUsd: number | null;
  entries: CreditEntryView[];
  config: CreditsConfig | null;
  error?: string;
}

const PENDING_KEY = "covar.credits.pendingTx";
let state: CreditsState = { status: "loading", signedIn: false, balanceUsd: null, entries: [], config: null };
const listeners = new Set<() => void>();
const set = (s: CreditsState) => {
  state = s;
  listeners.forEach((l) => l());
};

export async function refreshCredits() {
  try {
    const r = await fetch("/api/credits", { cache: "no-store" });
    const j = await r.json();
    set({ status: "ready", signedIn: !!j.signedIn, balanceUsd: j.signedIn ? j.balanceUsd : null, entries: j.entries ?? [], config: j.config ?? null });
  } catch (e) {
    set({ ...state, status: "error", error: (e as Error).message });
  }
}

export function useCredits(): CreditsState {
  const auth = useAuth();
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
  const who = auth.user?.address ?? null;
  useEffect(() => {
    if (auth.status !== "unknown" && auth.status !== "signing") void refreshCredits();
  }, [who, auth.status]);
  return s;
}

export const pendingTopup = () => (typeof window === "undefined" ? null : window.localStorage.getItem(PENDING_KEY));

/** Ask the server to credit a mined transfer; retries while it waits for confirmations. */
export async function verifyTopup(txHash: string, onStatus?: (m: string) => void): Promise<{ ok: boolean; message: string }> {
  for (let i = 0; i < 20; i++) {
    const r = await fetch("/api/credits/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      window.localStorage.removeItem(PENDING_KEY);
      await refreshCredits();
      const msg = j.creditedUsd > 0 ? `Credited $${j.creditedUsd.toFixed(2)}. Balance $${j.balanceUsd.toFixed(2)}.` : `Already credited earlier. Balance $${j.balanceUsd.toFixed(2)}.`;
      return { ok: true, message: msg };
    }
    if (r.status !== 409) return { ok: false, message: j.error ?? `HTTP ${r.status}` };
    onStatus?.(j.error ?? "Waiting for the chain…");
    await new Promise((res) => setTimeout(res, 2000));
  }
  return { ok: false, message: "The server could not confirm the transfer yet. Use “Verify pending top-up” in a minute." };
}

/** Send `amount` USDG to the credits treasury from the signed-in wallet, then have the server credit it. */
export async function topUp(amount: string, account: string, onStatus: (m: string) => void): Promise<{ ok: boolean; message: string; txHash?: string }> {
  const cfg = state.config;
  if (!cfg?.topupsEnabled || !cfg.treasury || !cfg.usdg) return { ok: false, message: "Top-ups are not configured on this server." };
  let units: bigint;
  try {
    units = parseUnits(amount, 6);
  } catch {
    return { ok: false, message: "Enter an amount in USDG." };
  }
  if (units < parseUnits(String(cfg.minTopupUsd), 6)) return { ok: false, message: `Minimum top-up is ${cfg.minTopupUsd} USDG.` };
  if (units > parseUnits(String(cfg.maxTopupUsd), 6)) return { ok: false, message: `Maximum top-up is ${cfg.maxTopupUsd} USDG.` };
  if (!injected()) return { ok: false, message: "No browser wallet found." };
  const chain = cfg.chainId as ChainId;
  try {
    onStatus("Switching the wallet to the right network…");
    await switchChain(chain);
    onStatus("Confirm the USDG transfer in your wallet…");
    const hash = await sendTx({ from: account, to: cfg.usdg, data: calldata("0xa9059cbb", encAddress(cfg.treasury), encUint(units)), chain });
    window.localStorage.setItem(PENDING_KEY, hash);
    onStatus("Waiting for the transaction…");
    const rc = await waitForReceipt(hash);
    if (!rc.ok) {
      window.localStorage.removeItem(PENDING_KEY);
      return { ok: false, message: "The transfer reverted; no USDG moved.", txHash: hash };
    }
    onStatus("Verifying on the server…");
    return { ...(await verifyTopup(hash, onStatus)), txHash: hash };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
