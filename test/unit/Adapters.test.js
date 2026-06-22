const { expect }            = require('chai');
const { ethers }            = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

const SECONDS_PER_YEAR = 31_536_000;

describe('Adapters (MockPool)', () => {

  async function deployFixture() {
    const [owner, vault, stranger] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory('MockERC20');
    const usdc = await USDC.deploy('USD Coin', 'USDC', 6);

    const MockPoolA = await ethers.getContractFactory('MockPoolA');
    const MockPoolB = await ethers.getContractFactory('MockPoolB');

    const mockA = await MockPoolA.deploy(vault.address, await usdc.getAddress(), 500);
    const mockB = await MockPoolB.deploy(vault.address, await usdc.getAddress(), 480);

    // Mint USDC to vault for deposit tests
    await usdc.mint(vault.address, ethers.parseUnits('1000', 6));

    return { mockA, mockB, usdc, owner, vault, stranger };
  }

  describe('MockPoolA', () => {
    describe('getAPY()', () => {
      it('returns initial APY (500 bps = 5.00%)', async () => {
        const { mockA } = await loadFixture(deployFixture);
        expect(await mockA.getAPY()).to.equal(500);
      });

      it('setAPY updates APY correctly', async () => {
        const { mockA } = await loadFixture(deployFixture);
        await mockA.setAPY(1800);
        expect(await mockA.getAPY()).to.equal(1800);
      });

      it('only owner can call setAPY', async () => {
        const { mockA, stranger } = await loadFixture(deployFixture);
        await expect(mockA.connect(stranger).setAPY(1800)).to.be.revertedWith('MockPoolA: only owner');
      });

      it('setAPY reverts above 50000 bps', async () => {
        const { mockA } = await loadFixture(deployFixture);
        await expect(mockA.setAPY(50_001)).to.be.revertedWith('MockPoolA: APY capped at 500%');
      });

      it('emits APYUpdated event', async () => {
        const { mockA, owner } = await loadFixture(deployFixture);
        await expect(mockA.setAPY(1800))
          .to.emit(mockA, 'APYUpdated')
          .withArgs(500, 1800, owner.address);
      });
    });

    describe('deposit()', () => {
      it('only vault can deposit', async () => {
        const { mockA, usdc, stranger } = await loadFixture(deployFixture);
        await usdc.mint(stranger.address, ethers.parseUnits('10', 6));
        await usdc.connect(stranger).approve(await mockA.getAddress(), ethers.parseUnits('10', 6));
        await expect(
          mockA.connect(stranger).deposit(ethers.parseUnits('10', 6))
        ).to.be.revertedWith('MockPoolA: only vault');
      });

      it('vault can deposit and balance increases', async () => {
        const { mockA, usdc, vault } = await loadFixture(deployFixture);
        const amount = ethers.parseUnits('100', 6);
        await usdc.connect(vault).approve(await mockA.getAddress(), amount);
        await mockA.connect(vault).deposit(amount);
        expect(await mockA.getBalance()).to.equal(amount);
      });
    });

    describe('withdraw()', () => {
      it('only vault can withdraw', async () => {
        const { mockA, usdc, vault, stranger } = await loadFixture(deployFixture);
        await usdc.connect(vault).approve(await mockA.getAddress(), ethers.parseUnits('100', 6));
        await mockA.connect(vault).deposit(ethers.parseUnits('100', 6));
        await expect(
          mockA.connect(stranger).withdraw(ethers.parseUnits('100', 6))
        ).to.be.revertedWith('MockPoolA: only vault');
      });

      it('vault can withdraw deposited amount', async () => {
        const { mockA, usdc, vault } = await loadFixture(deployFixture);
        const amount = ethers.parseUnits('100', 6);
        await usdc.connect(vault).approve(await mockA.getAddress(), amount);
        await mockA.connect(vault).deposit(amount);
        const balBefore = await usdc.balanceOf(vault.address);
        await mockA.connect(vault).withdraw(amount);
        const balAfter = await usdc.balanceOf(vault.address);
        expect(balAfter - balBefore).to.equal(amount);
        expect(await mockA.getBalance()).to.equal(0);
      });

      it('reverts if insufficient balance', async () => {
        const { mockA, vault } = await loadFixture(deployFixture);
        await expect(
          mockA.connect(vault).withdraw(ethers.parseUnits('100', 6))
        ).to.be.revertedWith('MockPoolA: insufficient balance');
      });
    });

    describe('protocolName()', () => {
      it('returns "MockPoolA"', async () => {
        const { mockA } = await loadFixture(deployFixture);
        expect(await mockA.protocolName()).to.equal('MockPoolA');
      });
    });

    describe('creditYield()', () => {
      it('owner can credit simulated yield, growing the balance', async () => {
        const { mockA, usdc, vault, owner } = await loadFixture(deployFixture);
        const principal = ethers.parseUnits('100', 6);
        await usdc.connect(vault).approve(await mockA.getAddress(), principal);
        await mockA.connect(vault).deposit(principal);

        const yieldAmt = ethers.parseUnits('7', 6);
        await usdc.mint(owner.address, yieldAmt);
        await usdc.connect(owner).approve(await mockA.getAddress(), yieldAmt);
        await mockA.connect(owner).creditYield(yieldAmt);

        expect(await mockA.getBalance()).to.equal(ethers.parseUnits('107', 6));
      });

      it('only owner can call creditYield', async () => {
        const { mockA, usdc, stranger } = await loadFixture(deployFixture);
        await usdc.mint(stranger.address, ethers.parseUnits('5', 6));
        await usdc.connect(stranger).approve(await mockA.getAddress(), ethers.parseUnits('5', 6));
        await expect(
          mockA.connect(stranger).creditYield(ethers.parseUnits('5', 6))
        ).to.be.revertedWith('MockPoolA: only owner');
      });
    });

    describe('time-based yield accrual', () => {
      // Deposit `principal`, fund `reserve`, set `apyBps`. Returns the fixture.
      async function setupAccrual(apyBps, principal, reserve) {
        const fx = await loadFixture(deployFixture);
        const { mockA, usdc, vault, owner } = fx;
        const p = ethers.parseUnits(String(principal), 6);
        const r = ethers.parseUnits(String(reserve), 6);
        await usdc.connect(vault).approve(await mockA.getAddress(), p);
        await mockA.connect(vault).deposit(p);
        await usdc.mint(owner.address, r);
        await usdc.connect(owner).approve(await mockA.getAddress(), r);
        await mockA.connect(owner).fundYieldReserve(r);
        await mockA.connect(owner).setAPY(apyBps);
        return fx;
      }

      it('getBalance grows over time at the set APY', async () => {
        const { mockA } = await setupAccrual(1000, 100, 100); // 10% APY, 100 principal, 100 reserve
        await time.increase(SECONDS_PER_YEAR);
        // 10% of 100 over a year ≈ 10 USDC → ~110
        expect(await mockA.getBalance()).to.be.closeTo(
          ethers.parseUnits('110', 6), ethers.parseUnits('0.01', 6)
        );
      });

      it('accrual is capped by the funded reserve', async () => {
        const { mockA, usdc, vault } = await setupAccrual(50_000, 100, 5); // 500% APY but only 5 USDC reserve
        await time.increase(SECONDS_PER_YEAR);
        // Raw yield would be 500 USDC, capped at the 5 USDC reserve → 105
        expect(await mockA.getBalance()).to.equal(ethers.parseUnits('105', 6));
        // Realize the accrual via a state-changing call → reserve drains to 0.
        await usdc.connect(vault).approve(await mockA.getAddress(), ethers.parseUnits('1', 6));
        await mockA.connect(vault).deposit(ethers.parseUnits('1', 6)); // triggers _accrue
        expect(await mockA.getReserve()).to.equal(0);
      });

      it('vault can withdraw principal + accrued yield (solvent)', async () => {
        const { mockA, usdc, vault } = await setupAccrual(1000, 100, 100);
        await time.increase(SECONDS_PER_YEAR);
        const owed = await mockA.getBalance();
        expect(owed).to.be.gt(ethers.parseUnits('109', 6));
        const before = await usdc.balanceOf(vault.address);
        await mockA.connect(vault).withdraw(owed);
        const after = await usdc.balanceOf(vault.address);
        expect(after - before).to.equal(owed);
        // Residual balance is ~0 (a couple seconds of extra accrual at most)
        expect(await mockA.getBalance()).to.be.lt(ethers.parseUnits('0.001', 6));
      });

      it('fundYieldReserve is owner-only', async () => {
        const { mockA, usdc, stranger } = await loadFixture(deployFixture);
        await usdc.mint(stranger.address, ethers.parseUnits('5', 6));
        await usdc.connect(stranger).approve(await mockA.getAddress(), ethers.parseUnits('5', 6));
        await expect(
          mockA.connect(stranger).fundYieldReserve(ethers.parseUnits('5', 6))
        ).to.be.revertedWith('MockPoolA: only owner');
      });

      it('does not accrue without a funded reserve', async () => {
        const { mockA, usdc, vault } = await loadFixture(deployFixture);
        await usdc.connect(vault).approve(await mockA.getAddress(), ethers.parseUnits('100', 6));
        await mockA.connect(vault).deposit(ethers.parseUnits('100', 6));
        await time.increase(SECONDS_PER_YEAR);
        expect(await mockA.getBalance()).to.equal(ethers.parseUnits('100', 6));
      });
    });
  });

  describe('MockPoolB', () => {
    it('returns initial APY (480 bps = 4.80%)', async () => {
      const { mockB } = await loadFixture(deployFixture);
      expect(await mockB.getAPY()).to.equal(480);
    });

    it('protocolName() returns "MockPoolB"', async () => {
      const { mockB } = await loadFixture(deployFixture);
      expect(await mockB.protocolName()).to.equal('MockPoolB');
    });

    it('deposit and withdraw work correctly', async () => {
      const { mockB, usdc, vault } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits('50', 6);
      await usdc.connect(vault).approve(await mockB.getAddress(), amount);
      await mockB.connect(vault).deposit(amount);
      expect(await mockB.getBalance()).to.equal(amount);
      await mockB.connect(vault).withdraw(amount);
      expect(await mockB.getBalance()).to.equal(0);
    });
  });
});
