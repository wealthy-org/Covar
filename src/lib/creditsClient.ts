"use client";

/**
 * Copilot credits, client side (3.7). Balance and ledger come from the server
 * (/api/credits), which reads the DB. The browser never decides a balance.
 * A top-up is a USDG transfer signed in the user's wallet; the server credits it
 * only after reading the receipt from the chain.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ChainId } from "./chain";
import { SEL, calldata, encAddress, encUint, ethCall, explainError, formatUnits, injected, parseUnits, sendTx, switchChain, waitForReceipt } from "./vaultTx";
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
    set({ ...state, status: "error", error: explainError(e) });
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
    if (r.status !== 409) return { ok: false, message: j.error ?? "We couldn't confirm your transfer right now. Use “Verify pending top-up” in a minute." };
    onStatus?.(j.error ?? "Waiting for the network…");
    await new Promise((res) => setTimeout(res, 2000));
  }
  return { ok: false, message: "Your transfer is still being confirmed. Your USDG is safe — use “Verify pending top-up” in a minute." };
}

/** Send `amount` USDG to the credits treasury from the signed-in wallet, then have the server credit it. */
export async function topUp(amount: string, account: string, onStatus: (m: string) => void): Promise<{ ok: boolean; message: string; txHash?: string }> {
  const cfg = state.config;
  if (!cfg?.topupsEnabled || !cfg.treasury || !cfg.usdg) return { ok: false, message: "Top-ups are not configured on this server." };
  let units: bigint;
  try {
    units = parseUnits(amount, 6);
  } catch {
    return { ok: false, message: "Enter the top-up amount in USDG, for example 5." };
  }
  if (units < parseUnits(String(cfg.minTopupUsd), 6)) return { ok: false, message: `Minimum top-up is ${cfg.minTopupUsd} USDG.` };
  if (units > parseUnits(String(cfg.maxTopupUsd), 6)) return { ok: false, message: `Maximum top-up is ${cfg.maxTopupUsd} USDG.` };
  if (!injected()) return { ok: false, message: "No wallet found in this browser. Install MetaMask or Rabby, then reload the page." };
  const chain = cfg.chainId as ChainId;
  try {
    onStatus("Switching the wallet to the right network…");
    await switchChain(chain);
    // Check the balance first so an empty wallet gets a clear answer instead of a wallet error.
    onStatus("Checking your USDG balance…");
    try {
      const bal = BigInt(await ethCall(cfg.usdg, calldata(SEL.balanceOf, encAddress(account)), chain));
      if (bal < units)
        return {
          ok: false,
          message:
            bal === 0n
              ? `This wallet (${account.slice(0, 6)}…${account.slice(-4)}) has no USDG yet. Add USDG to it first, then top up.`
              : `This wallet has ${formatUnits(bal, 6, 2)} USDG — not enough for a ${formatUnits(units, 6, 2)} USDG top-up. Enter ${formatUnits(bal, 6, 2)} or less, or add USDG first.`,
        };
    } catch {
      /* balance unreadable: let the wallet's own check decide */
    }
    onStatus("Confirm the USDG transfer in your wallet…");
    const hash = await sendTx({ from: account, to: cfg.usdg, data: calldata("0xa9059cbb", encAddress(cfg.treasury), encUint(units)), chain });
    window.localStorage.setItem(PENDING_KEY, hash);
    onStatus("Waiting for the transaction…");
    const rc = await waitForReceipt(hash);
    if (!rc.ok) {
      window.localStorage.removeItem(PENDING_KEY);
      return { ok: false, message: "The transfer failed on the network, so no USDG left your wallet.", txHash: hash };
    }
    onStatus("Verifying on the server…");
    return { ...(await verifyTopup(hash, onStatus)), txHash: hash };
  } catch (e) {
    return { ok: false, message: explainError(e) };
  }
}
