/**
 * Opt-in: HARDHAT_FORK_URL=https://rpc.mainnet.chain.robinhood.com pnpm test:contracts
 * Checks that the OFFICIAL NVDA and USDG tokens can be held and moved by the router
 * contract (no contract-recipient restriction) and that the approve path works on
 * the real tokens. A full swap needs a live 0x quote (taker = router) and is the
 * first on-chain proof run, not a unit test.
 */
import { expect } from "chai";
import { ethers, network } from "hardhat";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", AH = "0x0000000000001fF3684f28c67538d4D072C22734";
const HOLDER = "0x5CF7db17B8444504B0b2C2Cfe71e3E8351505464"; // had 1.5 NVDA + 101 USDG
const forked = !!process.env.HARDHAT_FORK_URL;
(forked ? describe : describe.skip)("CovarStockRouter on a Robinhood mainnet fork (HARDHAT_FORK_URL)", () => {
  it("NVDA and USDG move into and out of the router contract", async () => {

    const [owner] = await ethers.getSigners();
    const R = await ethers.getContractFactory("CovarStockRouter");
    const r = await R.deploy(USDG, AH, owner.address, 15);
    await r.setStockSupported(NVDA, true);
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [HOLDER] });
    await network.provider.send("hardhat_setBalance", [HOLDER, "0x56BC75E2D63100000"]);
    const h = await ethers.getSigner(HOLDER);
    const erc = ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)"];
    const nvda = new ethers.Contract(NVDA, erc, h), usdg = new ethers.Contract(USDG, erc, h);
    await (await nvda.transfer(await r.getAddress(), ethers.parseUnits("0.1", 18))).wait();
    await (await usdg.transfer(await r.getAddress(), ethers.parseUnits("1", 6))).wait();
    expect(await nvda.balanceOf(await r.getAddress())).to.equal(ethers.parseUnits("0.1", 18));
    await r.sweep(NVDA, HOLDER); await r.sweep(USDG, HOLDER);
    expect(await nvda.balanceOf(await r.getAddress())).to.equal(0n);
    // router -> AllowanceHolder approve path works on the real tokens (exec with junk data must fail as BadSwapData, not on approve)
    await nvda.approve(await r.getAddress(), ethers.MaxUint256);
    await expect(r.connect(h).sellStock(NVDA, ethers.parseUnits("0.1", 18), 1, "0x2213bc0b")).to.be.revertedWithCustomError(r, "BadSwapData");
  });
});
