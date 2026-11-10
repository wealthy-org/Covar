/**
 * Investor path in a real browser against a real (local) chain — package 3.5.
 *
 *   pnpm test:e2e:invest   (boots Hardhat + deploys + dev server; see scripts/e2e-invest.mjs)
 *
 * The browser gets an EIP-1193 wallet whose signing happens in the test process
 * with a Hardhat dev key (window.ethereum → page.exposeFunction → ethers). Every
 * transaction is a real one on the local node, and the operator steps are run by
 * the real operator service code, not by hand.
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Contract, getBytes, JsonRpcProvider, Wallet } from "ethers";
import { RPC, USDG_ADDR, VAULT_ADDR, ROLES, keyOf } from "./support/chain";
import { createOperator } from "../../services/operator/app";
import { createChainPort } from "../../services/operator/chain";

test.skip(!process.env.E2E_CHAIN, "needs a local chain fixture — run pnpm test:e2e:invest");
test.describe.configure({ mode: "serial" });
// Next dev compiles routes on first visit (slow on Windows): give assertions room.
// These only matter when something is slow; a passing run is not made longer.
test.use({ navigationTimeout: 90_000 });

/* ---- failure diagnostics: printed to the terminal + test-results/e2e-failure.txt ---- */
const browserLog: string[] = [];
test.beforeEach(async ({ page }) => {
  browserLog.length = 0;
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") browserLog.push(`[${m.type()}] ${m.text()}`.slice(0, 500));
  });
  page.on("pageerror", (e) => browserLog.push(`[pageerror] ${e.message}`.slice(0, 500)));
  page.on("requestfailed", (r) => browserLog.push(`[requestfailed] ${r.method()} ${r.url()} — ${r.failure()?.errorText}`.slice(0, 300)));
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const safe = async <T>(f: () => Promise<T>, fb: T) => {
    try {
      return await f();
    } catch {
      return fb;
    }
  };
  const panel = await safe(() => page.getByTestId("invest-panel").innerText({ timeout: 2000 }), "(no invest-panel on the page)");
  const body = await safe(() => page.locator("body").innerText({ timeout: 2000 }), "(page unreadable)");
  const wallet = await safe(
    () =>
      page.evaluate(async () => {
        const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<unknown> } }).ethereum;
        if (!eth) return "window.ethereum missing";
        const r = await Promise.allSettled([eth.request({ method: "eth_accounts" }), eth.request({ method: "eth_chainId" })]);
        return JSON.stringify(r.map((x) => (x.status === "fulfilled" ? x.value : `ERR ${(x.reason as Error)?.message}`)));
      }),
    "(evaluate failed)"
  );
  const t0 = Date.now();
  const nodeRpc = await safe(async () => {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }), signal: AbortSignal.timeout(5000) });
    return `${JSON.stringify(await r.json())} in ${Date.now() - t0} ms`;
  }, "FAILED/TIMEOUT (5 s)");
  const browserRpc = await safe(
    () =>
      page.evaluate(async (url) => {
        const s = performance.now();
        try {
          const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }), signal: AbortSignal.timeout(5000) });
          return `${JSON.stringify(await r.json())} in ${Math.round(performance.now() - s)} ms`;
        } catch (e) {
          return `ERR ${(e as Error).name}: ${(e as Error).message} after ${Math.round(performance.now() - s)} ms`;
        }
      }, RPC),
    "(evaluate failed)"
  );
  const report = [
    `=== E2E failure: ${info.title}`,
    `url: ${page.url()}`,
    `wallet (eth_accounts, eth_chainId): ${wallet}`,
    `RPC from the test process: ${nodeRpc}`,
    `RPC from the browser: ${browserRpc}`,
    `--- invest-panel text ---`,
    panel.slice(0, 2500),
    `--- page text (first 2500 chars) ---`,
    body.slice(0, 2500),
    `--- browser console errors/warnings (last 40) ---`,
    ...browserLog.slice(-40),
    `=== end`,
  ].join("\n");
  console.log("\n" + report + "\n");
  fs.mkdirSync("test-results", { recursive: true });
  fs.appendFileSync(path.join("test-results", "e2e-failure.txt"), report + "\n\n");
});

async function installWallet(page: Page, key: string | string[], startChain = "0x7a69") {
  let walletChain = startChain; // e.g. "0x1": the wallet starts on Ethereum mainnet
  const provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  // several accounts like a real extension; window.__covarSelect(i) switches the active one
  const wallets = (Array.isArray(key) ? key : [key]).map((k) => new Wallet(k, provider));
  let wallet = wallets[0];
  await page.exposeFunction("__covarSelectAccount", async (i: number) => {
    wallet = wallets[i];
    return wallet.address;
  });
  await page.exposeFunction("__covarWallet", async (method: string, params: unknown[]) => {
    try {
      switch (method) {
        case "wallet_requestPermissions":
          return { result: [{ parentCapability: "eth_accounts" }] };
        case "eth_requestAccounts":
        case "eth_accounts":
          return { result: [wallet.address] };
        case "eth_chainId":
          return { result: walletChain };
        case "wallet_switchEthereumChain":
          walletChain = (params[0] as { chainId: string }).chainId;
          return { result: null };
        case "wallet_addEthereumChain":
          return { result: null };
        case "personal_sign":
          return { result: await wallet.signMessage(getBytes(params[0] as string)) };
        case "eth_sendTransaction": {
          const tx = params[0] as { to: string; data: string };
          const sent = await wallet.sendTransaction({ to: tx.to, data: tx.data });
          return { result: sent.hash };
        }
        default:
          return { result: await provider.send(method, params ?? []) };
      }
    } catch (e) {
      const err = e as { info?: { error?: { code?: number; message?: string; data?: unknown } }; data?: unknown; message?: string };
      return { error: { code: err.info?.error?.code ?? -32000, message: err.info?.error?.message ?? err.message, data: err.info?.error?.data ?? err.data } };
    }
  });
  await page.addInitScript(() => {
    const w = window as unknown as { ethereum: unknown; __covarWallet: (m: string, p: unknown[]) => Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> };
    // EIP-1193 events like a real wallet: chainChanged fires after a network switch
    const listeners: Record<string, Set<(v: unknown) => void>> = {};
    w.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        const r = await w.__covarWallet(method, params ?? []);
        if (r.error) throw Object.assign(new Error(r.error.message), r.error);
        if (method === "wallet_switchEthereumChain") {
          const id = (params?.[0] as { chainId: string }).chainId;
          listeners.chainChanged?.forEach((fn) => fn(id));
        }
        return r.result;
      },
      on: (ev: string, fn: (v: unknown) => void) => void (listeners[ev] ??= new Set()).add(fn),
      removeListener: (ev: string, fn: (v: unknown) => void) => void listeners[ev]?.delete(fn),
    };
    // the user picks another account in the extension → accountsChanged
    (w as unknown as { __covarSelect: (i: number) => Promise<void> }).__covarSelect = async (i: number) => {
      const addr = await (w as unknown as { __covarSelectAccount: (i: number) => Promise<string> }).__covarSelectAccount(i);
      listeners.accountsChanged?.forEach((fn) => fn([addr]));
    };
  });
  return wallets[0];
}

const usdgOf = async (addr: string) => {
  const provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  return (await new Contract(USDG_ADDR, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(addr)) as bigint;
};

test("investor: SIWE sign-in → approve → deposit → withdraw → operator settles → claim", async ({ page }) => {
  test.setTimeout(240_000);
  // the wallet starts on Ethereum mainnet (chain 1): sign-in must switch it, not fail
  const investor = await installWallet(page, keyOf(ROLES.investor), "0x1");
  const before = await usdgOf(investor.address);

  await page.goto("/portfolio");
  await page.getByRole("button", { name: /connect/i }).first().click();

  // Sign-In with Ethereum from the wallet menu
  await page.locator("button.nav-btn[title^='Wallet']").first().click();
  const siwe = page.getByTestId("siwe-panel");
  await siwe.getByRole("button", { name: "Sign in with Ethereum" }).click();
  await expect(siwe.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(siwe).toContainText(investor.address.slice(0, 8).toLowerCase(), { ignoreCase: true });
  // a real browser wallet shows its real USDG balance from the chain, not the practice ledger
  await expect(page.getByText("Your browser wallet")).toBeVisible();
  await expect(page.getByTestId("wallet-usdg")).toHaveText("500 USDG", { timeout: 20_000 });
  await page.keyboard.press("Escape");

  // Vault holdings card: NAV per share from the contract, then the Invest modal
  const card = page.getByTestId("vault-holdings-card");
  await expect(card.getByTestId("nav-per-share")).toHaveText(/^\d+\.\d{4} USDG$/, { timeout: 20_000 });
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/invest-a-card.png` });
  await card.getByTestId("open-invest").click();
  const panel = page.getByRole("dialog").getByTestId("invest-panel");
  await expect(panel).toContainText("Invest · on-chain");
  await expect(panel).toContainText("500", { timeout: 20_000 }); // wallet USDG balance read from the chain

  // guards before any wallet prompt
  await panel.getByLabel("Deposit amount").fill("5");
  await expect(panel.getByRole("alert")).toContainText("Minimum deposit is 10");
  await panel.getByLabel("Deposit amount").fill("150");
  await expect(panel.getByRole("alert")).toContainText("Per-deposit limit is 100");

  await panel.getByLabel("Deposit amount").fill("100");
  await expect(panel).toContainText("Fee 1.1 · invested 98.9");
  const fees = panel.getByTestId("fee-breakdown");
  await expect(fees).toContainText("Fee · 1%");
  await expect(fees).toContainText("Fee · flat");
  await expect(fees).toContainText("−0.1");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/invest-0-fees.png` });
  // one click, two wallet confirmations: approve, then deposit
  await panel.getByRole("button", { name: "Approve & deposit" }).click();
  await expect(page.getByTestId("invest-msg")).toContainText("Deposit 100 USDG: confirmed", { timeout: 60_000 });
  await expect(panel.getByTestId("tx-receipt")).toContainText("0 → 98.9", { timeout: 20_000 });
  await expect(panel.getByTestId("receipt-hash")).toContainText(/^0x[0-9a-f]{8}…/);
  await expect(card.getByTestId("holding-shares")).toHaveText("98.9000", { timeout: 20_000 });
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/invest-1-deposit.png` });
  await expect(panel).toContainText("98.9 ≈ 98.9", { timeout: 20_000 });
  expect(before - (await usdgOf(investor.address))).toBe(100_000_000n);

  // withdrawal request
  await panel.getByRole("tab", { name: "Withdraw" }).click();
  await panel.getByRole("button", { name: "Max" }).click();
  await expect(panel).toContainText("97.81 after the withdrawal fee"); // 98.9 − (0.989 + 0.1) = 97.811
  await panel.getByRole("button", { name: "Request withdrawal" }).click();
  await expect(page.getByTestId("invest-msg")).toContainText("confirmed", { timeout: 30_000 });
  await expect(page.getByTestId("request-state")).toHaveText("Withdrawal requested", { timeout: 20_000 });
  await expect(page.getByTestId("invest-request")).toContainText("WithdrawalRequested");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/invest-2-requested.png` });

  // the real operator service, live, with wallet B
  const provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  const chain = createChainPort({ rpcUrl: RPC, vault: VAULT_ADDR, privateKey: keyOf(ROLES.operator), provider });
  const op = createOperator({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), "covar-e2e-op-")),
    vault: chain,
    venue: { describe: "none", equity: async () => 0n },
    close: { describe: "no-positions", status: async () => "done", start: async () => undefined },
    live: true,
  });
  const c1 = await op.cycle();
  expect(c1.sent.map((s) => s.kind)).toContain("markPositionsClosed");
  const c2 = await op.cycle();
  expect(c2.sent.map((s) => s.kind)).toContain("settleWithdrawal");
  expect(c2.sent.every((s) => !s.error)).toBe(true);

  await page.reload();
  // the card picks up the settlement and offers the claim
  await expect(card.getByTestId("open-withdraw")).toHaveText("Claim USDG", { timeout: 30_000 });
  await card.getByTestId("open-withdraw").click();
  const panel2 = page.getByRole("dialog").getByTestId("invest-panel");
  const claim = panel2.getByRole("button", { name: /^Claim 97\.81/ });
  await expect(claim).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("request-state")).toHaveText("Settled");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/invest-3-settled.png` });
  await claim.click();
  await expect(page.getByTestId("invest-msg")).toContainText("Claim: confirmed", { timeout: 30_000 });
  await expect(panel2.getByTestId("tx-receipt")).toContainText("(+97.81", { timeout: 20_000 });
  await expect(panel2.getByTestId("claim-full")).toContainText("received in full");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/invest-4-claimed.png` });
  expect(before - (await usdgOf(investor.address))).toBe(100_000_000n - 97_811_000n); // only the two fees are gone

  // ledger rows carry the real tx hashes and are stored under this wallet's account
  const state = await page.evaluate(async () => (await fetch("/api/state", { cache: "no-store" })).json());
  expect(state.owner).toBe(investor.address.toLowerCase());
  await expect
    .poll(async () => {
      const s = await page.evaluate(async () => (await fetch("/api/state", { cache: "no-store" })).json());
      return (s.state?.portfolio?.ledger ?? []).filter((l: { txHash?: string }) => /^0x[0-9a-f]{64}$/.test(l.txHash ?? "")).map((l: { kind: string; state: string }) => `${l.kind}:${l.state}`).sort().join(",");
    }, { timeout: 20_000 })
    .toBe("deposit:settled,withdrawal_claim:settled,withdrawal_request:settled"); // the claim completes the request
});

test("account switch: header and SIWE follow the wallet account that actually signed", async ({ page }) => {
  test.setTimeout(120_000);
  const other = new Wallet(keyOf(ROLES.owner)).address;
  const investor = new Wallet(keyOf(ROLES.investor)).address;
  await installWallet(page, [keyOf(ROLES.owner), keyOf(ROLES.investor)]);
  const select = (i: number) => page.evaluate((n) => (window as unknown as { __covarSelect: (i: number) => Promise<void> }).__covarSelect(n), i);
  const header = page.locator("button.nav-btn[title^='Wallet']").first();
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`.toUpperCase();

  await page.goto("/portfolio");
  await page.getByRole("button", { name: /connect/i }).first().click();
  await expect(header).toHaveText(short(other), { ignoreCase: true }); // connected with the first account

  // the user switches the extension to the investor account, then signs in
  await select(1);
  await header.click();
  const siwe = page.getByTestId("siwe-panel");
  await siwe.getByRole("button", { name: /Sign in with Ethereum as 0x90F7/i }).click();
  await expect(siwe.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(header).toHaveText(short(investor), { ignoreCase: true }); // header = the SIWE-proven account

  // switching the extension again → the dialog says so and re-signs in one click
  await select(0);
  await header.click();
  await expect(page.getByTestId("account-mismatch")).toBeVisible();
  await page.getByTestId("account-mismatch").getByRole("button", { name: /Sign in as/ }).click();
  await expect(siwe.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("account-mismatch")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(header).toHaveText(short(other), { ignoreCase: true });

  // the "different account" button opens the wallet's picker (wallet_requestPermissions) and signs in
  await header.click();
  await siwe.getByRole("button", { name: "Sign out" }).click();
  await siwe.getByTestId("siwe-pick-account").click();
  await expect(siwe.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
});

test("owner console v2: caps, limits and trading account from the browser", async ({ page }) => {
  test.setTimeout(240_000);
  await installWallet(page, keyOf(ROLES.owner));
  // /chain: RPC node status and live vault parameters
  await page.goto(`/chain`);
  await expect(page.getByTestId("rpc-status")).toHaveText(/Connected/, { timeout: 30_000 });
  await expect(page.getByTestId("rpc-chain-id")).toContainText("31337");
  await expect(page.getByTestId("vault-param").filter({ hasText: "Operator" })).toContainText(/0x[0-9a-f]{40}/i, { timeout: 30_000 });

  await page.goto(`/chain/console`);
  // an already-authorised wallet is picked up silently (eth_accounts) — no connect click needed
  await expect(page.getByTestId("console-role").first()).toContainText(/owner/i, { timeout: 20_000 });
  // read contract: every no-input view function answers from the chain
  await page.getByTestId("read-all").click();
  await expect(page.getByTestId("read-navPerShare").getByTestId("read-result")).toContainText(/\d+ {2}\(\d/, { timeout: 30_000 });
  await expect(page.getByTestId("read-operator").getByTestId("read-result")).toContainText(/^0x[0-9a-fA-F]{40}$/, { timeout: 30_000 });
  await expect(page.getByTestId("console-caps")).toContainText("1,000", { timeout: 20_000 });

  await page.getByLabel("TVL cap").fill("2000");
  await page.getByLabel("Per-deposit cap").fill("250");
  await page.getByRole("button", { name: "Set limits" }).click();
  await expect(page.getByTestId("console-log").first()).toHaveAttribute("data-status", "success", { timeout: 30_000 });
  await expect(page.getByTestId("console-caps")).toContainText("2,000", { timeout: 20_000 });

  const trading = new Wallet(keyOf(ROLES.trading)).address;
  await page.getByLabel("Trading account").fill(trading);
  await page.getByRole("button", { name: "Set trading account" }).click();
  await expect(page.getByTestId("console-log").first()).toHaveAttribute("data-status", "success", { timeout: 30_000 });
  await expect(page.getByTestId("console-trading")).toContainText(trading.slice(0, 6), { timeout: 20_000 });

  const provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  const v = new Contract(VAULT_ADDR, ["function maxTotalAssets() view returns (uint256)", "function tradingAccount() view returns (address)"], provider);
  expect(await v.maxTotalAssets()).toBe(2_000_000_000n);
  expect((await v.tradingAccount()) as string).toBe(trading);
});

test("3.6 on-chain record: Discover row, vault agent page and treasury all read the indexer", async ({ page }) => {
  test.setTimeout(240_000);
  const feeWallet = new Wallet(keyOf(ROLES.fee)).address;
  const feeBal = await usdgOf(feeWallet);
  expect(feeBal).toBeGreaterThan(0n); // the investor test above paid both fees on-chain

  // the summary the UI uses matches the chain exactly
  await page.goto("/explore");
  await expect
    .poll(async () => page.evaluate(async () => (await (await fetch("/api/vault/summary", { cache: "no-store" })).json()).totals?.feesToTreasury ?? null), { timeout: 30_000 })
    .toBe(feeBal.toString());

  // Discover: the deployed vault is pinned first and tagged on-chain
  const tag = page.getByTestId("onchain-vault-tag");
  await expect(tag).toBeVisible({ timeout: 30_000 });
  const row = page.locator("tr", { has: tag });
  await expect(row).toContainText("Covar Vault");
  await expect(row).toContainText("@covar");
  await row.getByRole("link", { name: "Covar Vault" }).click();

  // agent page: chain-backed record + the real Invest panel
  await expect(page).toHaveURL(/\/agents\/covar-vault$/, { timeout: 60_000 });
  const activity = page.getByTestId("vault-activity");
  await expect(activity).toContainText("On-chain record", { timeout: 30_000 });
  await expect(activity.getByTestId("vault-event").filter({ hasText: "Claimed" })).toHaveCount(1);
  await expect(activity.getByTestId("vault-event").filter({ hasText: "Deposit" })).toHaveCount(1);
  await expect(activity.getByTestId("vault-totals")).toContainText(`${(Number(feeBal) / 1e6).toFixed(4)} USDG`);
  await expect(page.getByTestId("invest-panel")).toBeVisible();
  await expect(page.getByText("Local test chain. Tokens here have no value.")).toBeVisible();

  // treasury: recorded fees = fee recipient balance, labelled as chain data
  await page.goto("/treasury");
  const t = page.getByTestId("treasury-onchain");
  await expect(t).toContainText("chain data", { timeout: 30_000 });
  await expect(t).toContainText(`${(Number(feeBal) / 1e6).toFixed(4)} USDG`);
  await expect(t).toContainText(feeWallet);
});

test("3.7 credits: sign in → USDG top-up in the wallet → server verifies on-chain → balance, ledger, treasury", async ({ page }) => {
  test.setTimeout(240_000);
  const investor = await installWallet(page, keyOf(ROLES.investor));
  const treasury = new Wallet(keyOf(ROLES.creditsTreasury)).address;
  const before = await usdgOf(treasury);

  await page.goto("/portfolio#credits");
  await page.getByRole("button", { name: /connect/i }).first().click(); // portfolio is wallet-gated
  const panel = page.getByTestId("credits-panel");
  await expect(panel).toContainText("metered", { timeout: 30_000 });
  await panel.getByRole("button", { name: "Sign in with wallet" }).click();
  await expect(page.getByTestId("credits-balance")).toHaveText("$0.0000", { timeout: 30_000 });

  // limits are enforced in the browser before any wallet prompt
  await panel.getByLabel("Top-up amount (USDG)").fill("0.5");
  await panel.getByRole("button", { name: "Top up with USDG" }).click();
  await expect(page.getByTestId("credits-msg")).toContainText("Minimum top-up is 1 USDG");

  await panel.getByLabel("Top-up amount (USDG)").fill("5");
  await panel.getByRole("button", { name: "Top up with USDG" }).click();
  await expect(page.getByTestId("credits-msg")).toContainText("Credited $5.00", { timeout: 60_000 });
  await expect(page.getByTestId("credits-balance")).toHaveText("$5.0000");
  expect((await usdgOf(treasury)) - before).toBe(5_000_000n); // the USDG really moved

  const entry = page.getByTestId("credit-entry").first();
  await expect(entry).toContainText("Top-up");
  await expect(entry).toContainText("+$5.0000");

  // the server credited it to this wallet only, and once
  const api = await page.evaluate(async () => (await fetch("/api/credits", { cache: "no-store" })).json());
  expect(api.owner).toBe(investor.address.toLowerCase());
  const hash = api.entries[0].txHash as string;
  const again = await page.evaluate(async (h) => (await fetch("/api/credits/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: h }) })).json(), hash);
  expect(again.creditedUsd).toBe(0);
  expect(again.balanceUsd).toBe(5);

  // Studio shows the server balance, not a local number
  await page.goto("/studio");
  await expect(page.getByText("$5.00").first()).toBeVisible({ timeout: 20_000 });

  // treasury: recorded credit sales from the ledger
  await page.goto("/treasury");
  const t = page.getByTestId("treasury-credits");
  await expect(t).toContainText("ledger data", { timeout: 20_000 });
  await expect(t).toContainText("$5.00");
  await expect(t).toContainText("1 top-up · 1 wallet");
});
