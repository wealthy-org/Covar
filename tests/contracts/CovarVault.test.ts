import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * CovarVault acceptance suite (brief §10 invariants, §15 functional criteria).
 * These run on the local EVM. The same suite must pass against testnet 46630
 * before any mainnet deployment is considered.
 */
const USDG = (n: number | string) => ethers.parseUnits(String(n), 6);

async function deploy(opts: { launchLimits?: boolean } = {}) {
  const [owner, operator, alice, bob, feeRecipient] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDG");
  const token = await Token.deploy();
  await token.waitForDeployment();

  const Vault = await ethers.getContractFactory("CovarVault");
  const vault = await Vault.deploy(await token.getAddress(), feeRecipient.address, operator.address);
  await vault.waitForDeployment();

  for (const who of [alice, bob]) {
    await token.mint(who.address, USDG(10_000));
    await token.connect(who).approve(await vault.getAddress(), ethers.MaxUint256);
  }
  await token.mint(feeRecipient.address, 0);
  // Most behaviour tests use 1,000 USDG deposits; the launch-limit tests keep the defaults.
  if (!opts.launchLimits) await vault.setLimits(USDG(1_000_000), USDG(100_000));

  return { vault, token, owner, operator, alice, bob, feeRecipient };
}

describe("CovarVault", () => {
  it("stores authority, asset and decimals", async () => {
    const { vault, token, owner, operator, feeRecipient } = await deploy();
    expect(await vault.owner()).to.equal(owner.address);
    expect(await vault.operator()).to.equal(operator.address);
    expect(await vault.asset()).to.equal(await token.getAddress());
    expect(await vault.feeRecipient()).to.equal(feeRecipient.address);
    expect(await vault.assetDecimals()).to.equal(6);
    expect(await vault.shareDecimals()).to.equal(6);
  });

  it("refuses deposits before a NAV is reported (no stale pricing)", async () => {
    const { vault, alice } = await deploy();
    await expect(vault.connect(alice).deposit(USDG(100))).to.be.revertedWithCustomError(vault, "StaleNav");
  });

  it("charges 1% + 0.10 USDG on deposit and mints shares at NAV", async () => {
    const { vault, token, operator, alice, feeRecipient } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));

    const before = await token.balanceOf(feeRecipient.address);
    await expect(vault.connect(alice).deposit(USDG(1000)))
      .to.emit(vault, "Deposit")
      .withArgs(alice.address, USDG(1000), USDG(10.1), USDG(989.9));

    expect((await token.balanceOf(feeRecipient.address)) - before).to.equal(USDG(10.1));
    // first deposit: 1 share per unit of net assets
    expect(await vault.balanceOf(alice.address)).to.equal(USDG(989.9));
    expect(await vault.reportedAssets()).to.equal(USDG(989.9));
  });

  it("enforces the minimum deposit", async () => {
    const { vault, operator, alice } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));
    await expect(vault.connect(alice).deposit(USDG(5))).to.be.revertedWithCustomError(vault, "BelowMinimum");
  });

  it("mints the second depositor fewer shares after a positive NAV report", async () => {
    const { vault, operator, alice, bob } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));
    await vault.connect(alice).deposit(USDG(1000)); // 989.9 shares
    await vault.connect(operator).reportNav(USDG(1_089.9)); // +10.1% on net assets
    const nav = await vault.navPerShare();
    expect(nav).to.be.greaterThan(ethers.parseUnits("1.1", 18));

    await vault.connect(bob).deposit(USDG(1000));
    const bobShares = await vault.balanceOf(bob.address);
    expect(bobShares).to.be.lessThan(USDG(989.9)); // later entry buys fewer shares at a higher NAV
  });

  it("rejects a NAV report that jumps more than the deviation cap", async () => {
    const { vault, operator } = await deploy();
    await vault.connect(operator).reportNav(USDG(1000));
    await expect(vault.connect(operator).reportNav(USDG(1300))).to.be.revertedWithCustomError(vault, "NavJumpTooLarge");
    await vault.connect(operator).reportNav(USDG(1100)); // inside 20%
    expect(await vault.reportedAssets()).to.equal(USDG(1100));
  });

  it("rejects a stale NAV after the freshness window", async () => {
    const { vault, operator, alice } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));
    await time.increase(7 * 60 * 60); // 7h > 6h max age
    await expect(vault.connect(alice).deposit(USDG(100))).to.be.revertedWithCustomError(vault, "StaleNav");
  });

  it("only operator or owner can report NAV or move withdrawal state", async () => {
    const { vault, alice } = await deploy();
    await expect(vault.connect(alice).reportNav(USDG(1))).to.be.revertedWithCustomError(vault, "NotOperator");
    await expect(vault.connect(alice).markPositionsClosed(alice.address)).to.be.revertedWithCustomError(vault, "NotOperator");
    await expect(vault.connect(alice).settleWithdrawal(alice.address, USDG(1))).to.be.revertedWithCustomError(vault, "NotOperator");
  });

  it("escrows shares on withdrawal request", async () => {
    const { vault, operator, alice } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));
    await vault.connect(alice).deposit(USDG(1000));
    await expect(vault.connect(alice).requestWithdrawal(USDG(400)))
      .to.emit(vault, "WithdrawalRequested");
    expect(await vault.balanceOf(alice.address)).to.equal(USDG(589.9));
    const req = await vault.requests(alice.address);
    expect(req.state).to.equal(1); // ClosingPositions
    expect(req.investor).to.equal(alice.address);
  });

  it("cannot claim before settlement, and cannot double-request", async () => {
    const { vault, operator, alice } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));
    await vault.connect(alice).deposit(USDG(1000));
    await vault.connect(alice).requestWithdrawal(USDG(400));
    await expect(vault.connect(alice).claim()).to.be.revertedWithCustomError(vault, "NoRequest");
    await expect(vault.connect(alice).requestWithdrawal(USDG(10))).to.be.revertedWithCustomError(vault, "WrongState");
  });

  it("settlement cannot promise funds the vault does not hold", async () => {
    const { vault, operator, alice } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));
    await vault.connect(alice).deposit(USDG(1000));
    await vault.connect(alice).requestWithdrawal(USDG(400));
    await vault.connect(operator).markPositionsClosed(alice.address);
    await expect(
      vault.connect(operator).settleWithdrawal(alice.address, USDG(5_000))
    ).to.be.revertedWithCustomError(vault, "InsufficientLiquidity");
  });

  it("completes the full investor path: deposit → request → close → settle → claim", async () => {
    const { vault, token, operator, alice } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));

    await vault.connect(alice).deposit(USDG(1000));
    await vault.connect(alice).requestWithdrawal(USDG(500));
    await vault.connect(operator).markPositionsClosed(alice.address);

    // operator pushed realised proceeds into the vault before settling
    await token.mint(await vault.getAddress(), USDG(520));
    await vault.connect(operator).settleWithdrawal(alice.address, USDG(520));

    const req = await vault.requests(alice.address);
    expect(req.state).to.equal(3); // Claimable
    // withdrawal fee 1% + 0.10 USDG applies to the settled amount
    expect(req.settledAssets).to.equal(USDG(520) - USDG(5.2) - USDG(0.1));

    const before = await token.balanceOf(alice.address);
    await vault.connect(alice).claim();
    expect((await token.balanceOf(alice.address)) - before).to.equal(req.settledAssets);
    expect((await vault.requests(alice.address)).state).to.equal(4); // Claimed
    await expect(vault.connect(alice).claim()).to.be.revertedWithCustomError(vault, "NoRequest");
  });

  it("pays the claim to the investor, never to an operator or creator address", async () => {
    const { vault, token, operator, alice, owner } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));
    await vault.connect(alice).deposit(USDG(500));
    await vault.connect(alice).requestWithdrawal(USDG(100));
    await vault.connect(operator).markPositionsClosed(alice.address);
    await token.mint(await vault.getAddress(), USDG(100));
    await vault.connect(operator).settleWithdrawal(alice.address, USDG(100));

    const ownerBefore = await token.balanceOf(owner.address);
    const operatorBefore = await token.balanceOf(operator.address);
    await vault.connect(alice).claim();
    expect(await token.balanceOf(owner.address)).to.equal(ownerBefore);
    expect(await token.balanceOf(operator.address)).to.equal(operatorBefore);
  });

  it("pause blocks new deposits but never blocks claims", async () => {
    const { vault, token, operator, owner, alice } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));
    await vault.connect(alice).deposit(USDG(500));
    await vault.connect(alice).requestWithdrawal(USDG(100));
    await vault.connect(operator).markPositionsClosed(alice.address);
    await token.mint(await vault.getAddress(), USDG(100));
    await vault.connect(operator).settleWithdrawal(alice.address, USDG(100));

    await vault.connect(owner).pause(true, true);
    await expect(vault.connect(alice).deposit(USDG(50))).to.be.revertedWithCustomError(vault, "Paused_");
    await vault.connect(alice).claim(); // exit path stays open
    expect((await vault.requests(alice.address)).state).to.equal(4);
  });

  it("caps fee changes so an owner mistake cannot set an arbitrary fee", async () => {
    const { vault, owner } = await deploy();
    await expect(vault.connect(owner).setFees(600, 0, 100, USDG(0.1))).to.be.revertedWith("fee cap 5%");
    await expect(vault.connect(owner).setFees(0, USDG(11), 100, USDG(0.1))).to.be.revertedWith("flat cap 10 USDG");
    await vault.connect(owner).setFees(50, USDG(0.1), 100, USDG(0.1));
    expect(await vault.depositFeeBps()).to.equal(50);
  });

  it("restricts admin actions to the single owner", async () => {
    const { vault, alice, owner, operator } = await deploy();
    await expect(vault.connect(alice).pause(true, false)).to.be.revertedWithCustomError(vault, "NotOwner");
    await expect(vault.connect(alice).setOperator(alice.address)).to.be.revertedWithCustomError(vault, "NotOwner");
    await expect(vault.connect(alice).transferOwnership(alice.address)).to.be.revertedWithCustomError(vault, "NotOwner");

    await vault.connect(owner).setOperator(alice.address);
    expect(await vault.operator()).to.equal(alice.address);
    await vault.connect(owner).transferOwnership(alice.address);
    expect(await vault.owner()).to.equal(alice.address);
    // previous operator lost its authority
    await expect(vault.connect(operator).reportNav(USDG(1))).to.be.revertedWithCustomError(vault, "NotOperator");
  });

  it("bounds the NAV risk parameters", async () => {
    const { vault, owner } = await deploy();
    await expect(vault.connect(owner).setNavRisk(60, 1_000)).to.be.revertedWith("age bounds");
    await expect(vault.connect(owner).setNavRisk(3_600, 6_000)).to.be.revertedWith("change cap 50%");
    await vault.connect(owner).setNavRisk(3_600, 3_000);
    expect(await vault.maxNavAge()).to.equal(3_600);
  });

  it("previews a deposit with the same fee maths the contract uses", async () => {
    const { vault, operator } = await deploy();
    await vault.connect(operator).reportNav(USDG(0));
    const [net, shares] = await vault.previewDeposit(USDG(250));
    expect(net).to.equal(USDG(250) - USDG(2.5) - USDG(0.1));
    expect(shares).to.equal(net);
  });

  // ------------------------------------------------------------- v2: launch limits
  describe("v2 launch limits", () => {
    it("ships with 1,000 USDG TVL cap and 100 USDG per-deposit cap", async () => {
      const { vault } = await deploy({ launchLimits: true });
      expect(await vault.maxTotalAssets()).to.equal(USDG(1000));
      expect(await vault.maxDepositPerTx()).to.equal(USDG(100));
    });

    it("rejects a single deposit above the per-deposit cap", async () => {
      const { vault, operator, alice } = await deploy({ launchLimits: true });
      await vault.connect(operator).reportNav(0);
      await expect(vault.connect(alice).deposit(USDG(100.01))).to.be.revertedWithCustomError(vault, "DepositTooLarge");
      await expect(vault.connect(alice).deposit(USDG(100))).to.emit(vault, "Deposit");
    });

    it("rejects the deposit that would push reported assets over the TVL cap", async () => {
      const { vault, operator, alice, bob } = await deploy({ launchLimits: true });
      await vault.connect(operator).reportNav(0);
      for (let i = 0; i < 10; i++) await vault.connect(i % 2 ? bob : alice).deposit(USDG(100)); // 10 × 98.9 = 989
      expect(await vault.reportedAssets()).to.equal(USDG(989));
      await expect(vault.connect(alice).deposit(USDG(20))).to.be.revertedWithCustomError(vault, "CapExceeded"); // +19.7
      await expect(vault.connect(alice).deposit(USDG(11))).to.emit(vault, "Deposit"); // +10.79 → 999.79
    });

    it("lets only the owner change limits, within sane bounds", async () => {
      const { vault, operator } = await deploy({ launchLimits: true });
      await expect(vault.connect(operator).setLimits(USDG(5000), USDG(500))).to.be.revertedWithCustomError(vault, "NotOwner");
      await expect(vault.setLimits(USDG(5000), USDG(5))).to.be.revertedWith("deposit cap < minimum");
      await expect(vault.setLimits(USDG(50), USDG(100))).to.be.revertedWith("tvl cap < deposit cap");
      await expect(vault.setLimits(USDG(5000), USDG(500))).to.emit(vault, "LimitsChanged").withArgs(USDG(5000), USDG(500));
    });
  });

  // ------------------------------------------------------ v2: trading capital path
  describe("v2 trading account", () => {
    it("allocates only to the owner-set trading account, never elsewhere", async () => {
      const { vault, token, operator, alice, bob } = await deploy();
      await vault.connect(operator).reportNav(0);
      await vault.connect(alice).deposit(USDG(1000));
      await expect(vault.connect(operator).allocateToVenue(USDG(100))).to.be.revertedWithCustomError(vault, "NoTradingAccount");
      await expect(vault.connect(operator).setTradingAccount(bob.address)).to.be.revertedWithCustomError(vault, "NotOwner");
      await expect(vault.setTradingAccount(bob.address)).to.emit(vault, "TradingAccountChanged");
      await expect(vault.connect(alice).allocateToVenue(USDG(100))).to.be.revertedWithCustomError(vault, "NotOperator");

      const before = await token.balanceOf(bob.address);
      await expect(vault.connect(operator).allocateToVenue(USDG(600))).to.emit(vault, "AllocatedToVenue").withArgs(bob.address, USDG(600));
      expect((await token.balanceOf(bob.address)) - before).to.equal(USDG(600));
      expect(await vault.totalAllocated()).to.equal(USDG(600));
      // NAV is unchanged by an allocation: capital moved, it did not disappear
      expect(await vault.reportedAssets()).to.equal(USDG(989.9));
    });

    it("blocks allocation in close-only mode", async () => {
      const { vault, operator, alice, bob } = await deploy();
      await vault.connect(operator).reportNav(0);
      await vault.connect(alice).deposit(USDG(1000));
      await vault.setTradingAccount(bob.address);
      await vault.pause(false, true);
      await expect(vault.connect(operator).allocateToVenue(USDG(10))).to.be.revertedWithCustomError(vault, "CloseOnly_");
    });

    it("reserves settled claims: they can be neither allocated nor used for another settlement", async () => {
      const { vault, token, operator, alice, bob, owner } = await deploy();
      await vault.connect(operator).reportNav(0);
      await vault.connect(alice).deposit(USDG(1000)); // 989.9
      await vault.connect(bob).deposit(USDG(1000)); // 989.9 → vault holds 1979.8
      await vault.setTradingAccount(owner.address);

      // alice exits fully: 989.9 settled, 979.90 reserved for her claim
      await vault.connect(alice).requestWithdrawal(USDG(989.9));
      await vault.connect(operator).markPositionsClosed(alice.address);
      await vault.connect(operator).settleWithdrawal(alice.address, USDG(989.9));
      const reserved = await vault.reservedForClaims();
      expect(reserved).to.equal(USDG(979.901));
      const free = await vault.availableLiquidity();
      expect(free).to.equal((await token.balanceOf(await vault.getAddress())) - reserved);

      // the operator cannot ship alice's money to the venue
      await expect(vault.connect(operator).allocateToVenue(free + 1n)).to.be.revertedWithCustomError(vault, "InsufficientLiquidity");
      await vault.connect(operator).allocateToVenue(free); // everything that is free goes out

      // bob's settlement cannot be funded from alice's reserve
      await vault.connect(bob).requestWithdrawal(USDG(989.9));
      await vault.connect(operator).markPositionsClosed(bob.address);
      await expect(vault.connect(operator).settleWithdrawal(bob.address, USDG(989.9))).to.be.revertedWithCustomError(
        vault,
        "InsufficientLiquidity",
      );

      // alice can still claim in full, and the reserve drops to zero
      await expect(vault.connect(alice).claim()).to.emit(vault, "WithdrawalClaimed").withArgs(alice.address, reserved);
      expect(await vault.reservedForClaims()).to.equal(0);

      // venue returns capital → bob settles
      await token.connect(owner).transfer(await vault.getAddress(), USDG(989.9));
      await vault.connect(operator).settleWithdrawal(bob.address, USDG(989.9));
      await vault.connect(bob).claim();
      expect(await vault.reservedForClaims()).to.equal(0);
    });
  });
});

