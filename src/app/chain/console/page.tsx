"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CHAINS, EXPECTED_CHAIN_ID, VAULT_ADDRESS, explorerAddress, readVault, type VaultState } from "@/lib/chain";
import {
  REQUEST_STATES,
  SEL,
  calldata,
  connectWallet,
  encAddress,
  encBool,
  encUint,
  explainError,
  formatUnits,
  injected,
  isAddress,
  parseUnits,
  readAccount,
  readV2,
  type VaultV2,
  readRequests,
  sendTx,
  switchChain,
  waitForReceipt,
  type ConsoleSnapshot,
  type PendingRequest,
} from "@/lib/vaultTx";
import { cx, shortAddr } from "@/lib/format";

type LogEntry = { id: number; label: string; hash?: string; status: "pending" | "success" | "failed" | "error"; detail?: string };
const STORAGE_KEY = "covar.console.vault";
const chain = CHAINS[EXPECTED_CHAIN_ID];
const txUrl = (hash: string) => `${chain.explorer}/tx/${hash}`;
const stateIndex = (s: string) => REQUEST_STATES.indexOf(s as (typeof REQUEST_STATES)[number]);

export default function VaultConsolePage() {
  const [vaultInput, setVaultInput] = useState(VAULT_ADDRESS ?? "");
  const [vaultAddr, setVaultAddr] = useState(VAULT_ADDRESS ?? "");
  const [account, setAccount] = useState<string | null>(null);
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [mine, setMine] = useState<ConsoleSnapshot | null>(null);
  const [queue, setQueue] = useState<PendingRequest[]>([]);
  const [v2, setV2] = useState<VaultV2 | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [hasWallet, setHasWallet] = useState(true);

  // form fields
  const [navInput, setNavInput] = useState("0");
  const [approveInput, setApproveInput] = useState("10");
  const [depositInput, setDepositInput] = useState("10");
  const [withdrawInput, setWithdrawInput] = useState("");
  const [investorInput, setInvestorInput] = useState("");
  const [settleInput, setSettleInput] = useState("");
  const [allocateInput, setAllocateInput] = useState("");
  const [tvlCapInput, setTvlCapInput] = useState("");
  const [perTxCapInput, setPerTxCapInput] = useState("");
  const [tradingInput, setTradingInput] = useState("");

  useEffect(() => {
    setHasWallet(!!injected());
    if (!VAULT_ADDRESS) {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && isAddress(saved)) {
        setVaultInput(saved);
        setVaultAddr(saved);
      }
    }
  }, []);

  // keep account/chain in sync with the wallet
  useEffect(() => {
    const eth = injected();
    if (!eth?.on) return;
    const onAccounts = (a: string[]) => setAccount(a?.[0] ?? null);
    const onChain = (c: string) => setWalletChain(Number(BigInt(c)));
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    // silently pick up an already-authorised account
    eth.request({ method: "eth_accounts" }).then((a: string[]) => a?.[0] && setAccount(a[0])).catch(() => {});
    eth.request({ method: "eth_chainId" }).then((c: string) => setWalletChain(Number(BigInt(c)))).catch(() => {});
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!vaultAddr) return;
    try {
      const v = await readVault(vaultAddr);
      setVault(v);
      setReadError(null);
      const [m, q, x] = await Promise.all([
        account ? readAccount(vaultAddr, v.asset, account, EXPECTED_CHAIN_ID) : Promise.resolve(null),
        readRequests(vaultAddr, EXPECTED_CHAIN_ID),
        readV2(vaultAddr, EXPECTED_CHAIN_ID),
      ]);
      setMine(m);
      setQueue(q);
      setV2(x);
    } catch (e) {
      setReadError(`${(e as Error).message}. If the RPC is unreachable, enable a VPN and retry.`);
    }
  }, [vaultAddr, account]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  // sensible defaults once state is known
  useEffect(() => {
    if (vault) setNavInput((cur) => (cur === "0" || cur === "" ? String(vault.reportedAssets) : cur));
  }, [vault]);
  useEffect(() => {
    if (mine && !withdrawInput && mine.shares > 0n) setWithdrawInput(formatUnits(mine.shares).replace(/,/g, ""));
  }, [mine, withdrawInput]);

  const role = useMemo(() => {
    if (!account || !vault) return [];
    const a = account.toLowerCase();
    const r: string[] = [];
    if (a === vault.owner.toLowerCase()) r.push("Owner · wallet A");
    if (a === vault.operator.toLowerCase()) r.push("Operator · wallet B");
    if (a === vault.feeRecipient.toLowerCase()) r.push("Fee recipient · wallet C");
    if (!r.length) r.push("Investor");
    return r;
  }, [account, vault]);
  const isOwner = role.some((r) => r.startsWith("Owner"));
  const isOperator = isOwner || role.some((r) => r.startsWith("Operator"));
  const wrongChain = account !== null && walletChain !== null && walletChain !== EXPECTED_CHAIN_ID;

  const push = (e: Omit<LogEntry, "id">) => {
    const id = Date.now() + Math.random();
    setLog((l) => [{ id, ...e }, ...l].slice(0, 30));
    return id;
  };
  const patch = (id: number, p: Partial<LogEntry>) => setLog((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function run(label: string, to: string, build: () => string) {
    if (!account) return;
    let data: string;
    try {
      data = build();
    } catch (e) {
      push({ label, status: "error", detail: (e as Error).message });
      return;
    }
    setBusy(label);
    const id = push({ label, status: "pending", detail: "Simulating, then waiting for your wallet…" });
    try {
      const hash = await sendTx({ from: account, to, data, chain: EXPECTED_CHAIN_ID });
      patch(id, { hash, detail: "Broadcast — waiting for confirmation…" });
      const r = await waitForReceipt(hash);
      await refresh(); // the screen reflects the new state before the row turns green
      patch(id, { status: r.ok ? "success" : "failed", detail: r.ok ? `Confirmed in block ${r.blockNumber.toLocaleString("en-US")}` : "Reverted on chain" });
    } catch (e) {
      patch(id, { status: "error", detail: (e as Error).message });
      void refresh();
    } finally {
      setBusy(null);
    }
  }

  async function onConnect() {
    try {
      const w = await connectWallet();
      setAccount(w.account);
      setWalletChain(w.chainId);
    } catch (e) {
      push({ label: "Connect wallet", status: "error", detail: explainError(e) });
    }
  }

  async function onSwitch() {
    try {
      await switchChain(EXPECTED_CHAIN_ID);
    } catch (e) {
      push({ label: "Switch network", status: "error", detail: explainError(e) });
    }
  }

  function applyVault() {
    const v = vaultInput.trim();
    if (!isAddress(v)) return push({ label: "Vault address", status: "error", detail: "Not a valid 0x… address" });
    window.localStorage.setItem(STORAGE_KEY, v);
    setVaultAddr(v);
  }

  const dec = vault?.assetDecimals ?? 6;
  const sym = vault?.assetSymbol ?? "USDG";
  const req = mine?.request;
  const steps: [string, string, boolean][] = [
    ["Operator reports NAV", "wallet B · reportNav", !!vault && !vault.navIsStale],
    ["Investor approves USDG", "wallet D · approve", !!mine && (mine.allowance > 0n || mine.shares > 0n || (req ? stateIndex(req.state) > 0 : false))],
    ["Investor deposits", "wallet D · deposit", !!mine && (mine.shares > 0n || (req ? stateIndex(req.state) > 0 : false))],
    ["Investor requests withdrawal", "wallet D · requestWithdrawal", !!req && stateIndex(req.state) >= 1],
    ["Operator marks positions closed", "wallet B · markPositionsClosed", !!req && stateIndex(req.state) >= 2],
    ["Operator settles", "wallet B · settleWithdrawal", !!req && stateIndex(req.state) >= 3],
    ["Investor claims", "wallet D · claim", !!req && stateIndex(req.state) >= 4],
  ];
  const nextStep = steps.findIndex((s) => !s[2]);

  const disabled = !account || wrongChain || !vault || busy !== null;

  return (
    <div className="wrap-md page-pad stack gap-20">
      <div className="row between wrap gap-16">
        <div className="stack gap-8" style={{ maxWidth: 680 }}>
          <Link href="/chain" className="tiny link-primary">
            ← Chain
          </Link>
          <span className="label-dot">Vault console</span>
          <h1 className="page-title">Send vault transactions from your wallet</h1>
          <p className="page-sub">
            Operator, investor and owner actions on the deployed CovarVault, signed in your own browser wallet. Every action
            is simulated first and explained if it would fail; nothing is sent until you confirm in the wallet. Keys never
            leave the wallet.
          </p>
        </div>
        <span className={cx("badge", chain.isMainnet ? "badge-red" : "badge-blue")}>
          {chain.isMainnet ? "MAINNET · real funds" : `${chain.name} · ${EXPECTED_CHAIN_ID}`}
        </span>
      </div>

      <div className="grid-2">
        {/* wallet */}
        <div className="card card-pad stack gap-10">
          <div className="row between">
            <span className="small strong">1 · Wallet</span>
            {account ? <span className="badge badge-green">Connected</span> : <span className="badge badge-amber">Not connected</span>}
          </div>
          {!hasWallet && (
            <span className="tiny neg">No browser wallet detected. Install MetaMask (or Rabby), then reload this page.</span>
          )}
          {account ? (
            <>
              <div className="row between">
                <span className="tiny">Account</span>
                <span className="small mono" data-testid="console-account">
                  {shortAddr(account, 6)}
                </span>
              </div>
              <div className="row between">
                <span className="tiny">Role in this vault</span>
                <span className="row gap-4 wrap">
                  {role.map((r) => (
                    <span key={r} className="badge badge-blue" data-testid="console-role">
                      {r}
                    </span>
                  ))}
                </span>
              </div>
              <div className="row between">
                <span className="tiny">Wallet network</span>
                <span className={cx("small strong", wrongChain && "neg")}>{walletChain ?? "—"}</span>
              </div>
              {wrongChain && (
                <button className="btn btn-primary" onClick={onSwitch}>
                  Switch wallet to {chain.name}
                </button>
              )}
              <span className="tiny">Change the account in your wallet to act as another role — this page follows it.</span>
            </>
          ) : (
            <button className="btn btn-primary" onClick={onConnect} disabled={!hasWallet} data-testid="console-connect">
              Connect wallet
            </button>
          )}
        </div>

        {/* vault */}
        <div className="card card-pad stack gap-10">
          <div className="row between">
            <span className="small strong">2 · Vault</span>
            {vault ? (
              <span className={cx("badge", vault.navIsStale ? "badge-amber" : "badge-green")} data-testid="console-nav">
                {vault.navIsStale ? "NAV stale — deposits blocked" : `NAV fresh · ${Math.round(vault.navAgeSeconds / 60)} min old`}
              </span>
            ) : (
              <span className="badge badge-amber">{vaultAddr ? "Loading…" : "No address"}</span>
            )}
          </div>
          {!VAULT_ADDRESS && (
            <div className="row gap-8">
              <input
                className="input mono"
                style={{ fontSize: 12 }}
                placeholder="0x… vault address"
                value={vaultInput}
                onChange={(e) => setVaultInput(e.target.value)}
                aria-label="Vault address"
              />
              <button className="btn btn-secondary" onClick={applyVault}>
                Use
              </button>
            </div>
          )}
          {vault && (
            <>
              <div className="row between">
                <span className="tiny">Address</span>
                <a className="small mono link-primary" href={explorerAddress(vault.address)} target="_blank" rel="noreferrer noopener">
                  {shortAddr(vault.address, 6)} ↗
                </a>
              </div>
              <div className="row between">
                <span className="tiny">Reported assets · shares</span>
                <span className="small num">
                  {vault.reportedAssets.toLocaleString("en-US")} {sym} · {vault.totalShares.toLocaleString("en-US")}
                </span>
              </div>
              <div className="row between">
                <span className="tiny">Status</span>
                <span className="small">
                  {vault.closeOnly ? "Close-only" : vault.depositsPaused ? "Deposits paused" : "Deposits open"}
                </span>
              </div>
              {v2 ? (
                <>
                  <div className="row between">
                    <span className="tiny">TVL cap · per deposit</span>
                    <span className="small num" data-testid="console-caps">
                      {formatUnits(v2.maxTotalAssets, dec)} · {formatUnits(v2.maxDepositPerTx, dec)} {sym}
                    </span>
                  </div>
                  <div className="row between">
                    <span className="tiny">Free liquidity · reserved for claims</span>
                    <span className="small num" data-testid="console-liquidity">
                      {formatUnits(v2.availableLiquidity, dec)} · {formatUnits(v2.reservedForClaims, dec)}
                    </span>
                  </div>
                  <div className="row between">
                    <span className="tiny">Trading account · sent so far</span>
                    <span className="small num" data-testid="console-trading">
                      {/^0x0{40}$/.test(v2.tradingAccount) ? "not set" : shortAddr(v2.tradingAccount)} · {formatUnits(v2.totalAllocated, dec)}
                    </span>
                  </div>
                </>
              ) : (
                <span className="tiny" data-testid="console-v1">
                  v1 vault (no on-chain caps or trading account). Redeploy v2 before mainnet.
                </span>
              )}
            </>
          )}
          {mine && (
            <>
              <hr className="divider" />
              <span className="tiny strong">This wallet</span>
              <div className="row between">
                <span className="tiny">{sym} balance · approved to vault</span>
                <span className="small num" data-testid="console-balance">
                  {formatUnits(mine.usdgBalance, dec)} · {formatUnits(mine.allowance, dec)}
                </span>
              </div>
              <div className="row between">
                <span className="tiny">Vault shares</span>
                <span className="small num" data-testid="console-shares">
                  {formatUnits(mine.shares, dec)}
                </span>
              </div>
              <div className="row between">
                <span className="tiny">Withdrawal request</span>
                <span className="small" data-testid="console-request">
                  {mine.request.state === "None"
                    ? "—"
                    : `${mine.request.state} · ${formatUnits(mine.request.shares, dec)} shares${
                        mine.request.settledAssets > 0n ? ` · ${formatUnits(mine.request.settledAssets, dec)} ${sym} claimable` : ""
                      }`}
                </span>
              </div>
            </>
          )}
          {readError && <span className="tiny neg">{readError}</span>}
        </div>
      </div>

      {/* flow checklist */}
      <div className="card card-pad stack gap-10">
        <span className="small strong">Test flow — deposit → withdraw → claim</span>
        <div className="stack gap-6">
          {steps.map(([label, who, done], i) => (
            <div key={label} className="row between gap-8" data-testid="console-step" data-done={done}>
              <span className={cx("small", i === nextStep && "strong")}>
                {done ? "✓" : i === nextStep ? "→" : "·"} {i + 1}. {label}
              </span>
              <span className="tiny mono">{who}</span>
            </div>
          ))}
        </div>
        <span className="tiny">Steps 2–7 track the connected wallet. Connect wallet D to see the investor&apos;s progress.</span>
      </div>

      <div className="grid-2">
        {/* investor */}
        <div className="card card-pad stack gap-12">
          <div className="row between">
            <span className="small strong">Investor actions</span>
            <span className="tiny">any wallet · wallet D in the test</span>
          </div>
          <ActionRow
            label={`Approve ${sym}`}
            hint={`Allow the vault to pull ${sym} for a deposit. Sent to the ${sym} contract.`}
            value={approveInput}
            onChange={setApproveInput}
            suffix={sym}
            disabled={disabled}
            busy={busy}
            onRun={() => run(`Approve ${approveInput} ${sym}`, vault!.asset, () => calldata(SEL.approve, encAddress(vault!.address), encUint(parseUnits(approveInput, dec))))}
          />
          <ActionRow
            label="Deposit"
            hint={`Minimum ${mine ? formatUnits(mine.minDeposit, dec) : "10"}${v2 ? `, maximum ${formatUnits(v2.maxDepositPerTx, dec)}` : ""} ${sym}. Fee ${vault ? `${vault.depositFeeBps / 100}% + ${vault.depositFeeFlat}` : "1% + 0.1"} ${sym}. Needs a fresh NAV.`}
            value={depositInput}
            onChange={setDepositInput}
            suffix={sym}
            disabled={disabled}
            busy={busy}
            onRun={() => run(`Deposit ${depositInput} ${sym}`, vault!.address, () => calldata(SEL.deposit, encUint(parseUnits(depositInput, dec))))}
          />
          <ActionRow
            label="Request withdrawal"
            hint="Escrows these shares and opens a request. Funds arrive after the operator settles."
            value={withdrawInput}
            onChange={setWithdrawInput}
            suffix="shares"
            disabled={disabled}
            busy={busy}
            onRun={() => run(`Request withdrawal ${withdrawInput} shares`, vault!.address, () => calldata(SEL.requestWithdrawal, encUint(parseUnits(withdrawInput || "0", dec))))}
          />
          <div className="row between gap-8">
            <div className="stack" style={{ gap: 2 }}>
              <span className="small strong">Claim</span>
              <span className="tiny">Pays the settled amount — always to this wallet, never elsewhere.</span>
            </div>
            <button className="btn btn-primary" disabled={disabled} onClick={() => run("Claim", vault!.address, () => SEL.claim)}>
              {busy === "Claim" ? "…" : "Claim"}
            </button>
          </div>
        </div>

        {/* operator */}
        <div className="card card-pad stack gap-12">
          <div className="row between">
            <span className="small strong">Operator actions</span>
            <span className={cx("tiny", account && vault && !isOperator && "neg")}>
              {account && vault && !isOperator ? "connect wallet B (operator)" : `operator ${vault ? shortAddr(vault.operator) : ""}`}
            </span>
          </div>
          <ActionRow
            label="Report NAV"
            hint={`Total assets the vault holds, in ${sym}. Max ±${20}% vs the last report; valid ${vault ? Math.round(vault.maxNavAgeSeconds / 3600) : 6} h. Use the current reported value to just refresh it.`}
            value={navInput}
            onChange={setNavInput}
            suffix={sym}
            disabled={disabled}
            busy={busy}
            onRun={() => run(`Report NAV ${navInput} ${sym}`, vault!.address, () => calldata(SEL.reportNav, encUint(parseUnits(navInput, dec))))}
          />
          {v2 && (
            <ActionRow
              label="Allocate to venue"
              hint={`Sends free ${sym} to the trading account set by the owner (${/^0x0{40}$/.test(v2.tradingAccount) ? "not set yet" : shortAddr(v2.tradingAccount)}). Free now: ${formatUnits(v2.availableLiquidity, dec)} ${sym}. NAV does not change — the capital moved.`}
              value={allocateInput}
              onChange={setAllocateInput}
              suffix={sym}
              disabled={disabled}
              busy={busy}
              onRun={() => run(`Allocate ${allocateInput} ${sym} to venue`, vault!.address, () => calldata(SEL.allocateToVenue, encUint(parseUnits(allocateInput || "0", dec))))}
            />
          )}
          <span className="tiny strong">Withdrawal queue</span>
          {queue.length === 0 ? (
            <span className="tiny">No withdrawal requests yet.</span>
          ) : (
            <div className="table-wrap panel">
              <table className="table table-min">
                <thead>
                  <tr>
                    <th>Investor</th>
                    <th>State</th>
                    <th className="right">Shares</th>
                    <th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((q) => {
                    const net = vault ? (q.shares * vault.navPerShareWad) / 10n ** 18n : q.shares;
                    return (
                      <tr key={q.investor} data-testid="console-queue-row">
                        <td className="mono tiny">{shortAddr(q.investor)}</td>
                        <td className="tiny">{q.state}</td>
                        <td className="right num tiny">{formatUnits(q.shares, dec)}</td>
                        <td className="right">
                          {q.state === "ClosingPositions" && (
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={disabled}
                              onClick={() => run(`Mark closed ${shortAddr(q.investor)}`, vault!.address, () => calldata(SEL.markPositionsClosed, encAddress(q.investor)))}
                            >
                              Mark closed
                            </button>
                          )}
                          {q.state === "Settling" && (
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={disabled}
                              title={`netAssets = shares × NAV per share = ${formatUnits(net, dec)} ${sym}`}
                              onClick={() =>
                                run(`Settle ${formatUnits(net, dec)} ${sym} → ${shortAddr(q.investor)}`, vault!.address, () =>
                                  calldata(SEL.settleWithdrawal, encAddress(q.investor), encUint(net))
                                )
                              }
                            >
                              Settle {formatUnits(net, dec)}
                            </button>
                          )}
                          {(q.state === "Claimable" || q.state === "Claimed") && (
                            <span className="tiny">{q.state === "Claimable" ? `${formatUnits(q.settledAssets, dec)} ready` : "done"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <details>
            <summary className="tiny link-primary" style={{ cursor: "pointer" }}>
              Manual settle (custom amount)
            </summary>
            <div className="stack gap-8" style={{ marginTop: 8 }}>
              <input className="input mono" style={{ fontSize: 12 }} placeholder="investor 0x…" value={investorInput} onChange={(e) => setInvestorInput(e.target.value)} aria-label="Investor address" />
              <div className="row gap-8">
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={disabled}
                  onClick={() =>
                    run(`Mark closed ${investorInput.slice(0, 8)}`, vault!.address, () => {
                      if (!isAddress(investorInput)) throw new Error("Investor address is not valid");
                      return calldata(SEL.markPositionsClosed, encAddress(investorInput.trim()));
                    })
                  }
                >
                  Mark closed
                </button>
                <input className="input" style={{ fontSize: 12 }} placeholder={`net ${sym}`} value={settleInput} onChange={(e) => setSettleInput(e.target.value)} aria-label="Net assets" />
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={disabled}
                  onClick={() =>
                    run(`Settle ${settleInput} ${sym}`, vault!.address, () => {
                      if (!isAddress(investorInput)) throw new Error("Investor address is not valid");
                      return calldata(SEL.settleWithdrawal, encAddress(investorInput.trim()), encUint(parseUnits(settleInput, dec)));
                    })
                  }
                >
                  Settle
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>

      {/* owner */}
      <div className="card card-pad stack gap-10">
        <div className="row between">
          <span className="small strong">Owner — emergency controls</span>
          <span className={cx("tiny", account && vault && !isOwner && "neg")}>
            {account && vault && !isOwner ? "connect wallet A (owner)" : `owner ${vault ? shortAddr(vault.owner) : ""}`}
          </span>
        </div>
        <div className="row gap-8 wrap">
          <button className="btn btn-secondary" disabled={disabled} onClick={() => run("Pause deposits", vault!.address, () => calldata(SEL.pause, encBool(true), encBool(false)))}>
            Pause deposits
          </button>
          <button className="btn btn-secondary" disabled={disabled} onClick={() => run("Close-only mode", vault!.address, () => calldata(SEL.pause, encBool(true), encBool(true)))}>
            Close-only
          </button>
          <button className="btn btn-secondary" disabled={disabled} onClick={() => run("Resume", vault!.address, () => calldata(SEL.pause, encBool(false), encBool(false)))}>
            Resume
          </button>
        </div>
        <span className="tiny">Pausing never blocks claims or withdrawal settlement — test that too.</span>
        {v2 && (
          <>
            <hr className="divider" />
            <span className="tiny strong">Launch limits</span>
            <div className="row gap-8 wrap">
              <input className="input num" style={{ maxWidth: 160 }} placeholder={`TVL cap ${sym}`} value={tvlCapInput} onChange={(e) => setTvlCapInput(e.target.value)} aria-label="TVL cap" />
              <input className="input num" style={{ maxWidth: 160 }} placeholder={`per deposit ${sym}`} value={perTxCapInput} onChange={(e) => setPerTxCapInput(e.target.value)} aria-label="Per-deposit cap" />
              <button
                className="btn btn-secondary"
                disabled={disabled}
                onClick={() =>
                  run(`Set limits ${tvlCapInput} / ${perTxCapInput} ${sym}`, vault!.address, () =>
                    calldata(SEL.setLimits, encUint(parseUnits(tvlCapInput, dec)), encUint(parseUnits(perTxCapInput, dec)))
                  )
                }
              >
                Set limits
              </button>
            </div>
            <span className="tiny strong">Trading account (venue deposit address)</span>
            <div className="row gap-8 wrap">
              <input className="input mono" style={{ fontSize: 12, maxWidth: 420 }} placeholder="0x… Lighter intent / deposit address" value={tradingInput} onChange={(e) => setTradingInput(e.target.value)} aria-label="Trading account" />
              <button
                className="btn btn-secondary"
                disabled={disabled}
                onClick={() =>
                  run(`Set trading account ${tradingInput.slice(0, 10)}…`, vault!.address, () => {
                    if (!isAddress(tradingInput)) throw new Error("Trading account address is not valid");
                    return calldata(SEL.setTradingAccount, encAddress(tradingInput.trim()));
                  })
                }
              >
                Set trading account
              </button>
            </div>
            <span className="tiny">The only address the operator can ever send capital to. Double-check it: capital sent there is under the venue account&apos;s control.</span>
          </>
        )}
      </div>

      {/* log */}
      <div className="card card-pad stack gap-8">
        <span className="small strong">Session log</span>
        {log.length === 0 ? (
          <span className="tiny">Transactions you send from this page appear here with explorer links. Save the hashes as test evidence.</span>
        ) : (
          log.map((l) => (
            <div key={l.id} className="row between gap-8 wrap" data-testid="console-log" data-status={l.status}>
              <span className="small">
                <span className={cx("badge", l.status === "success" ? "badge-green" : l.status === "pending" ? "badge-blue" : "badge-red")}>{l.status}</span>{" "}
                {l.label}
                {l.detail ? <span className="tiny"> — {l.detail}</span> : null}
              </span>
              {l.hash && (
                <a className="tiny mono link-primary" href={txUrl(l.hash)} target="_blank" rel="noreferrer noopener" data-testid="console-hash">
                  {shortAddr(l.hash, 8)} ↗
                </a>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ActionRow(props: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  disabled: boolean;
  busy: string | null;
  onRun: () => void;
}) {
  return (
    <div className="stack gap-6">
      <div className="row between gap-8">
        <span className="small strong">{props.label}</span>
        <span className="tiny">{props.suffix}</span>
      </div>
      <div className="row gap-8">
        <input className="input num" inputMode="decimal" value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-label={props.label} />
        <button className="btn btn-primary" disabled={props.disabled} onClick={props.onRun} style={{ minWidth: 112 }}>
          {props.busy?.startsWith(props.label.split(" ")[0]) ? "…" : props.label.split(" ")[0]}
        </button>
      </div>
      <span className="tiny">{props.hint}</span>
    </div>
  );
}
