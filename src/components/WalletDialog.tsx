"use client";

import { useEffect, useState } from "react";
import { useCovar } from "@/lib/store";
import { getWalletProvider } from "@/lib/wallet";
import { Modal } from "./ui";
import { shortAddr, usd } from "@/lib/format";
import { currentWalletAccount, signInWithEthereum, signOut, useAuth } from "@/lib/session";
import { formatUnits, injected, readAccount } from "@/lib/vaultTx";
import { CHAINS, EXPECTED_CHAIN_ID, VAULT_ADDRESS, readVault } from "@/lib/chain";
import { useCredits } from "@/lib/creditsClient";

export function WalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { portfolio, walletProviderId } = useCovar();
  const [copied, setCopied] = useState(false);
  const auth = useAuth();
  const credits = useCredits();
  const [authErr, setAuthErr] = useState<string | null>(null);
  // A real browser wallet: show its real USDG balance from the chain, never the practice ledger.
  const isEvm = (walletProviderId ?? getWalletProvider().id) === "evm";
  // Which account the browser wallet exposes right now (it can differ from the signed-in one).
  const [walletAcct, setWalletAcct] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const eth = injected();
    void currentWalletAccount().then(setWalletAcct);
    const onAcc = (a: string[]) => setWalletAcct(a?.[0] ?? null);
    eth?.on?.("accountsChanged", onAcc);
    return () => eth?.removeListener?.("accountsChanged", onAcc);
  }, [open]);
  const mismatch = auth.status === "signed-in" && !!auth.user && !!walletAcct && walletAcct.toLowerCase() !== auth.user.address.toLowerCase();
  const signIn = (pickAccount: boolean) => {
    setAuthErr(null);
    void signInWithEthereum({ pickAccount }).then((r) => !r.ok && setAuthErr(r.error ?? "Sign-in failed"));
  };
  const switchAccount = async () => {
    await signOut();
    signIn(false);
  };

  const [chainUsdg, setChainUsdg] = useState<{ v: bigint | null; err?: string }>({ v: null });
  useEffect(() => {
    if (!open || !isEvm || !VAULT_ADDRESS || !portfolio.wallet?.startsWith("0x")) return;
    let cancelled = false;
    setChainUsdg({ v: null });
    (async () => {
      try {
        const v = await readVault(VAULT_ADDRESS);
        const a = await readAccount(VAULT_ADDRESS, v.asset, portfolio.wallet, EXPECTED_CHAIN_ID);
        if (!cancelled) setChainUsdg({ v: a.usdgBalance });
      } catch (e) {
        if (!cancelled) setChainUsdg({ v: null, err: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isEvm, portfolio.wallet]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(portfolio.wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Connected wallet" subtitle={isEvm ? "Your browser wallet" : "Development session wallet"}>
      <div className="stack gap-16">
        {isEvm ? (
          <div className="notice">
            <div>
              <strong>Covar never holds your private keys.</strong>
              <div style={{ marginTop: 2 }}>
                Signing in is a free signature — no gas, no transaction. Deposits, withdrawals and credit top-ups are
                transactions you review and approve in your own wallet on {CHAINS[EXPECTED_CHAIN_ID].name}.
              </div>
            </div>
          </div>
        ) : (
          <div className="notice notice-warn">
            <div>
              <strong>Demo wallet.</strong>
              <div style={{ marginTop: 2 }}>
                This is a practice identity that only exists in this browser. Nothing is signed and no real funds are involved.
              </div>
            </div>
          </div>
        )}

        <div className="panel stack gap-8" style={{ padding: 14 }} data-testid="siwe-panel">
          <div className="row between gap-8">
            <span className="tiny">Account</span>
            <span className={auth.status === "signed-in" ? "badge badge-green" : "badge badge-outline"}>
              {auth.status === "signed-in" ? "Signed in" : auth.status === "signing" ? "Waiting for signature…" : "Not signed in"}
            </span>
          </div>
          {auth.status === "signed-in" && auth.user ? (
            <>
              <span className="small">
                <span className="mono">{shortAddr(auth.user.address, 8)}</span> · proven by a Sign-In with Ethereum signature. Your
                strategies, practice runs and history sync to this account on any device.
              </span>
              {mismatch && walletAcct && (
                <div className="notice notice-warn" data-testid="account-mismatch">
                  <span className="small">
                    Your wallet is now on <span className="mono">{shortAddr(walletAcct, 6)}</span>, but you are signed in as{" "}
                    <span className="mono">{shortAddr(auth.user.address, 6)}</span>.
                  </span>
                  <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => void switchAccount()}>
                    Sign in as {shortAddr(walletAcct, 4)}
                  </button>
                </div>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <span className="small">
                Sign a free message (no gas, no transaction) to prove you own your wallet and keep your data across devices.
              </span>
              <button
                className="btn btn-primary btn-sm"
                disabled={auth.status === "signing" || !injected()}
                onClick={() => signIn(false)}
              >
                {injected() ? (walletAcct ? `Sign in with Ethereum as ${shortAddr(walletAcct, 4)}` : "Sign in with Ethereum") : "Install MetaMask or Rabby to sign in"}
              </button>
              {injected() && (
                <button className="btn btn-secondary btn-sm" disabled={auth.status === "signing"} onClick={() => signIn(true)} data-testid="siwe-pick-account">
                  Use a different wallet account…
                </button>
              )}
              {(authErr ?? auth.error) && (
                <span className="tiny" role="alert" style={{ color: "var(--negative)" }}>
                  {authErr ?? auth.error}
                </span>
              )}
            </>
          )}
        </div>

        {process.env.NODE_ENV !== "production" && !isEvm && (
          <div className="panel" style={{ padding: 14 }}>
            <span className="tiny">Developer note</span>
            <p className="tiny" style={{ margin: "4px 0 0" }}>
              Set <span className="mono">NEXT_PUBLIC_WALLET_PROVIDER=evm</span> to use a real browser wallet (MetaMask, Rabby) with
              Sign-In with Ethereum.
            </p>
          </div>
        )}

        <div className="panel" style={{ padding: 14 }}>
          <div className="row between gap-12">
            <div className="stack" style={{ gap: 2 }}>
              <span className="tiny">Address</span>
              <span className="mono">{shortAddr(portfolio.wallet, 8)}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <hr className="divider" style={{ margin: "12px 0" }} />
          <div className="row between">
            <div className="stack" style={{ gap: 2 }}>
              <span className="tiny">Network</span>
              <span className="small">{portfolio.chain}</span>
            </div>
            <span className="badge badge-amber">Testnet</span>
          </div>
        </div>

        <div className="row gap-12">
          <div className="panel grow" style={{ padding: 14 }}>
            <span className="tiny">USDG balance{isEvm ? " · on-chain" : " · practice"}</span>
            <div className="strong num" data-testid="wallet-usdg">
              {!isEvm
                ? usd(portfolio.cashUsd)
                : !VAULT_ADDRESS
                  ? "—"
                  : chainUsdg.v !== null
                    ? `${formatUnits(chainUsdg.v, 6, 2)} USDG`
                    : chainUsdg.err
                      ? "Couldn't load"
                      : "…"}
            </div>
          </div>
          <div className="panel grow" style={{ padding: 14 }}>
            <span className="tiny">Copilot credits</span>
            <div className="strong num">{credits.balanceUsd === null ? "—" : usd(credits.balanceUsd)}</div>
          </div>
        </div>

        {isEvm ? (
          <p className="small">
            Your USDG balance is read live from {CHAINS[EXPECTED_CHAIN_ID].name}. Deposit and withdraw from{" "}
            <strong>My money</strong>; every transaction is approved in your own wallet.
          </p>
        ) : (
          <p className="small">
            Balances on this card are the practice session&apos;s. Real deposits go through the <strong>Invest · on-chain</strong>{" "}
            panel (Portfolio, or an agent with a deployed vault) and are signed in your own wallet.
          </p>
        )}
      </div>
    </Modal>
  );
}
