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

async function installWallet(page: Page, key: string) {
  const provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  const wallet = new Wallet(key, provider);
  await page.exposeFunction("__covarWallet", async (method: string, params: unknown[]) => {
    try {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return { result: [wallet.address] };
        case "eth_chainId":
          return { result: "0x7a69" };
        case "wallet_switchEthereumChain":
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
    w.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        const r = await w.__covarWallet(method, params ?? []);
        if (r.error) throw Object.assign(new Error(r.error.message), r.error);
        return r.result;
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
  });
  return wallet;
}

const usdgOf = async (addr: string) => {
  const provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  return (await new Contract(USDG_ADDR, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(addr)) as bigint;
};

test("investor: SIWE sign-in → approve → deposit → withdraw → operator settles → claim", async ({ page }) => {
  test.setTimeout(240_000);
  const investor = await installWallet(page, keyOf(ROLES.investor));
  const before = await usdgOf(investor.address);

  await page.goto("/portfolio");
  await page.getByRole("button", { name: /connect/i }).first().click();

  // Sign-In with Ethereum from the wallet menu
  await page.locator("button.nav-btn[title^='Wallet']").first().click();
  const siwe = page.getByTestId("siwe-panel");
  await siwe.getByRole("button", { name: "Sign in with Ethereum" }).click();
  await expect(siwe.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(siwe).toContainText(investor.address.slice(0, 8).toLowerCase(), { ignoreCase: true });
  await page.keyboard.press("Escape");

  const panel = page.getByTestId("invest-panel");
  await expect(panel).toContainText("Invest · on-chain");
  await expect(panel).toContainText("500", { timeout: 20_000 }); // wallet USDG balance read from the chain

  // guards before any wallet prompt
  await panel.getByLabel("Deposit amount").fill("5");
  await expect(panel.getByRole("alert")).toContainText("Minimum deposit is 10");
  await panel.getByLabel("Deposit amount").fill("150");
  await expect(panel.getByRole("alert")).toContainText("Per-deposit limit is 100");

  await panel.getByLabel("Deposit amount").fill("100");
  await expect(panel).toContainText("Fee 1.1 · invested 98.9");
  await panel.getByRole("button", { name: /Step 1 of 2 · Approve/ }).click();
  await expect(page.getByTestId("invest-msg")).toContainText("confirmed", { timeout: 30_000 });
  await panel.getByRole("button", { name: "Step 2 of 2 · Deposit" }).click();
  await expect(page.getByTestId("invest-msg")).toContainText("Deposit 100 USDG: confirmed", { timeout: 30_000 });
  await expect(panel).toContainText("98.9 ≈ 98.9", { timeout: 20_000 });
  expect(before - (await usdgOf(investor.address))).toBe(100_000_000n);

  // withdrawal request
  await panel.getByRole("tab", { name: "Withdraw" }).click();
  await panel.getByRole("button", { name: "Max" }).click();
  await expect(panel).toContainText("97.81 after the withdrawal fee"); // 98.9 − (0.989 + 0.1) = 97.811
  await panel.getByRole("button", { name: "Request withdrawal" }).click();
  await expect(page.getByTestId("invest-msg")).toContainText("confirmed", { timeout: 30_000 });
  await expect(page.getByTestId("invest-request")).toContainText("Closing positions", { timeout: 20_000 });

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
  const panel2 = page.getByTestId("invest-panel");
  const claim = panel2.getByRole("button", { name: /^Claim 97\.81/ });
  await expect(claim).toBeVisible({ timeout: 30_000 });
  await claim.click();
  await expect(page.getByTestId("invest-msg")).toContainText("Claim: confirmed", { timeout: 30_000 });
  expect(before - (await usdgOf(investor.address))).toBe(100_000_000n - 97_811_000n); // only the two fees are gone

  // ledger rows carry the real tx hashes and are stored under this wallet's account
  const state = await page.evaluate(async () => (await fetch("/api/state", { cache: "no-store" })).json());
  expect(state.owner).toBe(investor.address.toLowerCase());
  await expect
    .poll(async () => {
      const s = await page.evaluate(async () => (await fetch("/api/state", { cache: "no-store" })).json());
      return (s.state?.portfolio?.ledger ?? []).filter((l: { txHash?: string }) => /^0x[0-9a-f]{64}$/.test(l.txHash ?? "")).map((l: { kind: string }) => l.kind).sort().join(",");
    }, { timeout: 20_000 })
    .toBe("deposit,withdrawal_claim,withdrawal_request");
});

test("owner console v2: caps, limits and trading account from the browser", async ({ page }) => {
  test.setTimeout(120_000);
  await installWallet(page, keyOf(ROLES.owner));
  await page.goto(`/chain/console`);
  // an already-authorised wallet is picked up silently (eth_accounts) — no connect click needed
  await expect(page.getByTestId("console-role").first()).toContainText(/owner/i, { timeout: 20_000 });
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
  test.setTimeout(120_000);
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
  await expect(page).toHaveURL(/\/agents\/covar-vault$/);
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
  test.setTimeout(120_000);
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
