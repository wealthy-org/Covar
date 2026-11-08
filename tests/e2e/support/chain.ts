/**
 * Local chain fixture for the investor E2E (tests/e2e/invest.spec.ts).
 *
 * Deploys MockUSDG + CovarVault v2 on a FRESH Hardhat node from the deployer's
 * nonce 0, so the addresses are deterministic and can be baked into the dev
 * server's NEXT_PUBLIC_* env before it starts:
 *   MockUSDG   0x5FbDB2315678afecb367f032d93F642f64180aa3
 *   CovarVault 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
 * Hardhat's public dev mnemonic — local chain only, never funded anywhere real.
 */
import fs from "node:fs";
import path from "node:path";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, Wallet, type Contract } from "ethers";

export const RPC = process.env.E2E_RPC ?? "http://127.0.0.1:8545";
export const USDG_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const VAULT_ADDR = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const MNEMONIC = "test test test test test test test test test test test junk";
export const keyOf = (i: number) => HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).privateKey;
export const ROLES = { owner: 0, operator: 1, fee: 2, investor: 3, trading: 4, creditsTreasury: 5 } as const;

const art = (n: string) => JSON.parse(fs.readFileSync(path.join("artifacts", "contracts", `${n}.sol`, `${n}.json`), "utf8"));

export async function deployFixture() {
  const provider = new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  const owner = new Wallet(keyOf(ROLES.owner), provider);
  if ((await provider.getTransactionCount(owner.address)) !== 0) {
    const code = await provider.getCode(VAULT_ADDR);
    if (code !== "0x") return { provider, reused: true };
    throw new Error("deployer has sent transactions already — start a fresh Hardhat node");
  }
  const operator = new Wallet(keyOf(ROLES.operator), provider);
  const fee = new Wallet(keyOf(ROLES.fee));
  const investor = new Wallet(keyOf(ROLES.investor));
  const u = art("MockUSDG");
  const usdg = (await new ContractFactory(u.abi, u.bytecode, owner).deploy()) as Contract;
  await usdg.waitForDeployment();
  const v = art("CovarVault");
  const vault = (await new ContractFactory(v.abi, v.bytecode, owner).deploy(USDG_ADDR, fee.address, operator.address)) as Contract;
  await vault.waitForDeployment();
  if ((await vault.getAddress()) !== VAULT_ADDR || (await usdg.getAddress()) !== USDG_ADDR) throw new Error("unexpected deployment addresses");
  await (await usdg.mint(investor.address, 500_000_000n)).wait(); // 500 USDG
  await (await (vault.connect(operator) as Contract).reportNav(0n)).wait(); // opens deposits
  return { provider, reused: false };
}

if (require.main === module) {
  deployFixture()
    .then((r) => console.log(r.reused ? `fixture already deployed at ${VAULT_ADDR}` : `deployed MockUSDG ${USDG_ADDR} · CovarVault ${VAULT_ADDR}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
