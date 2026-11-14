import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * CovarStockRouter — registry, fee, 0x-call validation, on-chain minimums,
 * refunds of unused input, and "holds nothing between calls".
 * The 0x AllowanceHolder + Settler pair is replaced by MockAllowanceHolder; the
 * calldata shape (exec(operator, token, amount, target, data)) is the real one.
 */
const U = (n: number | string) => ethers.parseUnits(String(n), 6);
const S = (n: number | string) => ethers.parseUnits(String(n), 18);
const EXEC = new ethers.Interface(["function exec(address operator,address token,uint256 amount,address target,bytes data)"]);
const coder = ethers.AbiCoder.defaultAbiCoder();

/** 0x-shaped calldata: sell `amount` of `sellToken`, mock pays `buyAmount` of `buyToken` and pulls `pull`. */
function swapData(sellToken: string, amount: bigint, buyToken: string, buyAmount: bigint, pull = amount) {
  const inner = coder.encode(["address", "uint256", "uint256"], [buyToken, buyAmount, pull]);
  const settler = "0xE8852602f84e04e284286d8Db01a41Edd0CCEFb0";
  return EXEC.encodeFunctionData("exec", [settler, sellToken, amount, settler, inner]);
}

async function deploy(feeBps = 15) {
  const [owner, alice, feeTo, stranger] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDG");
  const usdg = await Token.deploy();
  const nvda = await Token.deploy(); // decimals are irrelevant to the router
  const tsla = await Token.deploy();
  const AH = await ethers.getContractFactory("MockAllowanceHolder");
  const ah = await AH.deploy();
  const Router = await ethers.getContractFactory("CovarStockRouter");
  const router = await Router.deploy(await usdg.getAddress(), await ah.getAddress(), feeTo.address, feeBps);
  await router.setStockSupported(await nvda.getAddress(), true);

  // market-maker inventory sits in the mock, never in the router
  await usdg.mint(await ah.getAddress(), U(1_000_000));
  await nvda.mint(await ah.getAddress(), S(1_000_000));
  await tsla.mint(await ah.getAddress(), S(1_000_000));
  await usdg.mint(alice.address, U(1_000));
  await nvda.mint(alice.address, S(10));
  await usdg.connect(alice).approve(await router.getAddress(), ethers.MaxUint256);
  await nvda.connect(alice).approve(await router.getAddress(), ethers.MaxUint256);
  await tsla.connect(alice).approve(await router.getAddress(), ethers.MaxUint256);
  const a = {
    usdg: await usdg.getAddress(),
    nvda: await nvda.getAddress(),
    tsla: await tsla.getAddress(),
    ah: await ah.getAddress(),
    router: await router.getAddress(),
  };
  return { router, usdg, nvda, tsla, ah, owner, alice, feeTo, stranger, a };
}

async function routerHoldsNothing(c: Awaited<ReturnType<typeof deploy>>) {
  expect(await c.usdg.balanceOf(c.a.router)).to.equal(0n);
  expect(await c.nvda.balanceOf(c.a.router)).to.equal(0n);
  expect(await c.usdg.allowance(c.a.router, c.a.ah)).to.equal(0n);
  expect(await c.nvda.allowance(c.a.router, c.a.ah)).to.equal(0n);
}

describe("CovarStockRouter", () => {
  it("deploys with USDG, the fixed AllowanceHolder, owner and fee", async () => {
    const { router, owner, feeTo, a } = await deploy();
    expect(await router.usdg()).to.equal(a.usdg);
    expect(await router.allowanceHolder()).to.equal(a.ah);
    expect(await router.owner()).to.equal(owner.address);
    expect(await router.feeRecipient()).to.equal(feeTo.address);
    expect(await router.feeBps()).to.equal(15);
  });

  it("rejects a fee above 1% at deploy and on setFee", async () => {
    const [, , feeTo] = await ethers.getSigners();
    const Router = await ethers.getContractFactory("CovarStockRouter");
    await expect(Router.deploy(feeTo.address, feeTo.address, feeTo.address, 101)).to.be.revertedWithCustomError(Router, "FeeTooHigh");
    const { router } = await deploy();
    await expect(router.setFee(101, feeTo.address)).to.be.revertedWithCustomError(router, "FeeTooHigh");
    await expect(router.setFee(100, feeTo.address)).to.emit(router, "FeeSet").withArgs(100, feeTo.address);
  });

  it("buy: fee to Covar, stock to the buyer, StockPurchased, router keeps nothing", async () => {
    const c = await deploy(15);
    const { router, usdg, nvda, alice, feeTo, a } = c;
    const fee = (U(50) * 15n) / 10_000n; // 0.075 USDG
    const net = U(50) - fee;
    const out = S("0.30702");
    await expect(router.connect(alice).buyStock(a.nvda, U(50), out, swapData(a.usdg, net, a.nvda, out)))
      .to.emit(router, "StockPurchased")
      .withArgs(alice.address, a.nvda, U(50), out, fee);
    expect(await usdg.balanceOf(alice.address)).to.equal(U(950));
    expect(await nvda.balanceOf(alice.address)).to.equal(S(10) + out);
    expect(await usdg.balanceOf(feeTo.address)).to.equal(fee);
    await routerHoldsNothing(c);
  });

  it("sell: fee from the USDG out, net to the seller, StockSold", async () => {
    const c = await deploy(15);
    const { router, usdg, nvda, alice, feeTo, a } = c;
    const gross = U("81.045664");
    const fee = (gross * 15n) / 10_000n;
    await expect(router.connect(alice).sellStock(a.nvda, S("0.5"), gross - fee, swapData(a.nvda, S("0.5"), a.usdg, gross)))
      .to.emit(router, "StockSold")
      .withArgs(alice.address, a.nvda, S("0.5"), gross - fee, fee);
    expect(await nvda.balanceOf(alice.address)).to.equal(S("9.5"));
    expect(await usdg.balanceOf(alice.address)).to.equal(U(1_000) + gross - fee);
    expect(await usdg.balanceOf(feeTo.address)).to.equal(fee);
    await routerHoldsNothing(c);
  });

  it("enforces the caller's minimum on chain (buy and sell) and nothing moves", async () => {
    const { router, usdg, alice, a } = await deploy(0);
    await expect(router.connect(alice).buyStock(a.nvda, U(10), S(1), swapData(a.usdg, U(10), a.nvda, S("0.99"))))
      .to.be.revertedWithCustomError(router, "SlippageExceeded")
      .withArgs(S("0.99"), S(1));
    await expect(router.connect(alice).sellStock(a.nvda, S(1), U(160), swapData(a.nvda, S(1), a.usdg, U(159)))).to.be.revertedWithCustomError(router, "SlippageExceeded");
    expect(await usdg.balanceOf(alice.address)).to.equal(U(1_000));
  });

  it("refuses calldata that is not AllowanceHolder.exec for exactly this token and amount", async () => {
    const { router, alice, a } = await deploy(0);
    // wrong amount (more than the net being sold)
    await expect(router.connect(alice).buyStock(a.nvda, U(10), 1, swapData(a.usdg, U(11), a.nvda, S(1)))).to.be.revertedWithCustomError(router, "BadSwapData");
    // wrong token (tries to spend the router's NVDA allowance on a buy)
    await expect(router.connect(alice).buyStock(a.nvda, U(10), 1, swapData(a.nvda, U(10), a.nvda, S(1)))).to.be.revertedWithCustomError(router, "BadSwapData");
    // a different function altogether (e.g. a raw transferFrom)
    const transferFrom = new ethers.Interface(["function transferFrom(address,address,address,uint256)"]).encodeFunctionData("transferFrom", [a.usdg, alice.address, alice.address, U(10)]);
    await expect(router.connect(alice).buyStock(a.nvda, U(10), 1, transferFrom)).to.be.revertedWithCustomError(router, "BadSwapData");
    await expect(router.connect(alice).buyStock(a.nvda, U(10), 1, "0x")).to.be.revertedWithCustomError(router, "BadSwapData");
  });

  it("a failed 0x route reverts the whole buy (SwapFailed)", async () => {
    const { router, usdg, alice, a } = await deploy(15);
    await expect(router.connect(alice).buyStock(a.nvda, U(10), 1, swapData(a.usdg, U(10) - U("0.015"), ethers.ZeroAddress, 0n))).to.be.revertedWithCustomError(router, "SwapFailed");
    expect(await usdg.balanceOf(alice.address)).to.equal(U(1_000));
  });

  it("refunds input the route did not use", async () => {
    const c = await deploy(0);
    const { router, usdg, nvda, alice, a } = c;
    // route only takes 8 of 10 USDG
    await expect(router.connect(alice).buyStock(a.nvda, U(10), 1, swapData(a.usdg, U(10), a.nvda, S("0.05"), U(8))))
      .to.emit(router, "StockPurchased")
      .withArgs(alice.address, a.nvda, U(8), S("0.05"), 0);
    expect(await usdg.balanceOf(alice.address)).to.equal(U(992));
    // route only takes 0.4 of 0.5 NVDA
    await expect(router.connect(alice).sellStock(a.nvda, S("0.5"), 1, swapData(a.nvda, S("0.5"), a.usdg, U(64), S("0.4"))))
      .to.emit(router, "StockSold")
      .withArgs(alice.address, a.nvda, S("0.4"), U(64), 0);
    expect(await nvda.balanceOf(alice.address)).to.equal(S(10) + S("0.05") - S("0.4"));
    await routerHoldsNothing(c);
  });

  it("only registered stocks trade; a second stock (TSLA) is added without redeploying", async () => {
    const { router, tsla, alice, owner, a } = await deploy(0);
    await expect(router.connect(alice).buyStock(a.tsla, U(10), 1, swapData(a.usdg, U(10), a.tsla, S("0.02")))).to.be.revertedWithCustomError(router, "StockNotSupported");
    await expect(router.connect(owner).setStockSupported(a.tsla, true)).to.emit(router, "StockSupportedSet").withArgs(a.tsla, true);
    await router.connect(alice).buyStock(a.tsla, U(10), S("0.02"), swapData(a.usdg, U(10), a.tsla, S("0.02")));
    expect(await tsla.balanceOf(alice.address)).to.equal(S("0.02"));
    expect(await router.stockList()).to.deep.equal([a.nvda, a.tsla]);
    await router.setStockSupported(a.tsla, false);
    await expect(router.connect(alice).buyStock(a.tsla, U(10), 1, swapData(a.usdg, U(10), a.tsla, S("0.02")))).to.be.revertedWithCustomError(router, "StockNotSupported");
    expect(await router.stockList()).to.deep.equal([a.nvda, a.tsla]);
  });

  it("USDG itself can never be registered as a stock", async () => {
    const { router, a } = await deploy();
    await expect(router.setStockSupported(a.usdg, true)).to.be.revertedWithCustomError(router, "ZeroAddress");
  });

  it("admin functions are owner-only; ownership moves in two steps", async () => {
    const { router, stranger, owner, a } = await deploy();
    await expect(router.connect(stranger).setStockSupported(a.tsla, true)).to.be.revertedWithCustomError(router, "NotAuthorized");
    await expect(router.connect(stranger).setFee(0, stranger.address)).to.be.revertedWithCustomError(router, "NotAuthorized");
    await expect(router.connect(stranger).setPaused(true)).to.be.revertedWithCustomError(router, "NotAuthorized");
    await expect(router.connect(stranger).sweep(a.usdg, stranger.address)).to.be.revertedWithCustomError(router, "NotAuthorized");
    await router.transferOwnership(stranger.address);
    expect(await router.owner()).to.equal(owner.address);
    await expect(router.connect(owner).acceptOwnership()).to.be.revertedWithCustomError(router, "NotAuthorized");
    await router.connect(stranger).acceptOwnership();
    expect(await router.owner()).to.equal(stranger.address);
  });

  it("pause stops swaps", async () => {
    const { router, alice, a } = await deploy(0);
    await router.setPaused(true);
    await expect(router.connect(alice).buyStock(a.nvda, U(10), 1, swapData(a.usdg, U(10), a.nvda, S("0.06")))).to.be.revertedWithCustomError(router, "IsPaused");
    await router.setPaused(false);
    await router.connect(alice).buyStock(a.nvda, U(10), 1, swapData(a.usdg, U(10), a.nvda, S("0.06")));
  });

  it("blocks re-entry from inside the swap", async () => {
    const { router, ah, alice, a } = await deploy(0);
    const inner = router.interface.encodeFunctionData("buyStock", [a.nvda, U(1), 1, swapData(a.usdg, U(1), a.nvda, S("0.006"))]);
    await ah.setReenter(a.router, inner);
    await expect(router.connect(alice).buyStock(a.nvda, U(10), 1, swapData(a.usdg, U(10), a.nvda, S("0.06")))).to.be.revertedWithCustomError(router, "SwapFailed");
  });

  it("owner can rescue tokens sent to the router by mistake", async () => {
    const { router, usdg, owner, a } = await deploy();
    await usdg.mint(a.router, U(3));
    await expect(router.sweep(a.usdg, owner.address)).to.emit(router, "Swept").withArgs(a.usdg, owner.address, U(3));
    expect(await usdg.balanceOf(a.router)).to.equal(0n);
  });
});
