"use client";

/**
 * The connected browser wallet (EIP-1193), for pages that sign on Robinhood Chain
 * themselves (/trade, the Instant Stock Agent). Follows account and chain changes.
 */
import { useEffect, useState } from "react";
import { connectWallet, injected } from "./vaultTx";

export function useWalletAccount() {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    let found = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attached: ReturnType<typeof injected> = null;
    const onAcc = (a: string[]) => setAccount(a?.[0] ?? null);
    const onChain = (c: string) => setChainId(Number(BigInt(c)));
    const probe = async (attempt: number) => {
      const eth = injected();
      if (eth && !attached) {
        attached = eth;
        eth.on?.("accountsChanged", onAcc);
        eth.on?.("chainChanged", onChain);
      }
      if (eth) {
        try {
          const c: string = await eth.request({ method: "eth_chainId" });
          if (!cancelled) setChainId(Number(BigInt(c)));
          const a: string[] = await eth.request({ method: "eth_accounts" });
          if (!cancelled && a?.[0]) {
            found = true;
            setAccount(a[0]);
          }
        } catch {
          /* retried */
        }
      }
      if (!cancelled && !found && attempt < 20) timer = setTimeout(() => void probe(attempt + 1), 1500);
    };
    void probe(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      attached?.removeListener?.("accountsChanged", onAcc);
      attached?.removeListener?.("chainChanged", onChain);
    };
  }, []);
  const connect = async () => {
    const c = await connectWallet();
    setAccount(c.account);
    setChainId(c.chainId);
  };
  return { account, chainId, connect };
}

