const { expect }      = require('chai');
const { ethers }      = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

describe('FeePool', () => {

  async function deployFixture() {
    const [owner, orchestrator, vault, stranger, devWallet] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory('MockERC20');
    const usdc = await USDC.deploy('USD Coin', 'USDC', 6);

    const FeePool = await ethers.getContractFactory('FeePool');
    const feePool = await FeePool.deploy(await usdc.getAddress());

    await feePool.setOrchestrator(orchestrator.address);
    await feePool.setVault(vault.address);

    // Seed vault with some USDC to deposit
    await usdc.mint(vault.address, ethers.parseUnits('1000', 6));

    return { feePool, usdc, owner, orchestrator, vault, stranger, devWallet };
  }

  describe('deposit()', () => {
    it('only vault can call deposit()', async () => {
      const { feePool, usdc, stranger } = await loadFixture(deployFixture);
      await usdc.mint(stranger.address, ethers.parseUnits('10', 6));
      await usdc.connect(stranger).approve(await feePool.getAddress(), ethers.parseUnits('10', 6));
      await expect(
        feePool.connect(stranger).deposit(ethers.parseUnits('10', 6))
      ).to.be.revertedWith('FeePool: not vault');
    });

    it('vault can deposit and pool balance increases', async () => {
      const { feePool, usdc, vault } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits('5', 6);
      await usdc.connect(vault).approve(await feePool.getAddress(), amount);
      await feePool.connect(vault).deposit(amount);
      expect(await feePool.getBalance()).to.equal(amount);
      expect(await feePool.totalCollected()).to.equal(amount);
    });
  });

  describe('payAgent()', () => {
    async function seedPool(feePool, usdc, vault, amount) {
      await usdc.connect(vault).approve(await feePool.getAddress(), amount);
      await feePool.connect(vault).deposit(amount);
    }

    it('only orchestrator can call payAgent()', async () => {
      const { feePool, usdc, vault, stranger, devWallet } = await loadFixture(deployFixture);
      await seedPool(feePool, usdc, vault, ethers.parseUnits('50', 6));
      await expect(
        feePool.connect(stranger).payAgent(devWallet.address, ethers.parseUnits('1', 6), 1)
      ).to.be.revertedWith('FeePool: not orchestrator');
    });

    it('orchestrator pays agent and balance decreases', async () => {
      const { feePool, usdc, vault, orchestrator, devWallet } = await loadFixture(deployFixture);
      await seedPool(feePool, usdc, vault, ethers.parseUnits('50', 6));
      const balBefore = await usdc.balanceOf(devWallet.address);
      await feePool.connect(orchestrator).payAgent(devWallet.address, ethers.parseUnits('1', 6), 1);
      const balAfter = await usdc.balanceOf(devWallet.address);
      expect(balAfter - balBefore).to.equal(ethers.parseUnits('1', 6));
      expect(await feePool.totalPaidOut()).to.equal(ethers.parseUnits('1', 6));
    });

    it('reverts if pool has insufficient balance', async () => {
      const { feePool, orchestrator, devWallet } = await loadFixture(deployFixture);
      await expect(
        feePool.connect(orchestrator).payAgent(devWallet.address, ethers.parseUnits('1', 6), 1)
      ).to.be.revertedWith('FeePool: insufficient balance');
    });

    it('reverts on zero amount', async () => {
      const { feePool, orchestrator, devWallet } = await loadFixture(deployFixture);
      await expect(
        feePool.connect(orchestrator).payAgent(devWallet.address, 0, 1)
      ).to.be.revertedWith('FeePool: zero amount');
    });

    it('reverts if payment would breach minimum reserve', async () => {
      const { feePool, usdc, vault, orchestrator, devWallet } = await loadFixture(deployFixture);
      // Seed pool with 15 USDC (MIN_RESERVE = 10 USDC)
      await seedPool(feePool, usdc, vault, ethers.parseUnits('15', 6));
      // Try to pay 6 USDC — would leave 9 USDC < MIN_RESERVE
      await expect(
        feePool.connect(orchestrator).payAgent(devWallet.address, ethers.parseUnits('6', 6), 1)
      ).to.be.revertedWith('FeePool: would breach minimum reserve');
    });

    it('allows payment that keeps balance at minimum reserve', async () => {
      const { feePool, usdc, vault, orchestrator, devWallet } = await loadFixture(deployFixture);
      await seedPool(feePool, usdc, vault, ethers.parseUnits('15', 6));
      // Pay 5 USDC — leaves 10 USDC = MIN_RESERVE
      await expect(
        feePool.connect(orchestrator).payAgent(devWallet.address, ethers.parseUnits('5', 6), 1)
      ).to.not.be.reverted;
    });
  });

  describe('isAboveReserve()', () => {
    it('returns true when balance exceeds reserve', async () => {
      const { feePool, usdc, vault } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits('20', 6);
      await usdc.connect(vault).approve(await feePool.getAddress(), amount);
      await feePool.connect(vault).deposit(amount);
      expect(await feePool.isAboveReserve()).to.equal(true);
    });

    it('returns false when balance is at or below reserve', async () => {
      const { feePool } = await loadFixture(deployFixture);
      expect(await feePool.isAboveReserve()).to.equal(false);
    });
  });

  describe('Access control', () => {
    it('non-owner cannot set orchestrator', async () => {
      const { feePool, stranger, orchestrator } = await loadFixture(deployFixture);
      await expect(
        feePool.connect(stranger).setOrchestrator(orchestrator.address)
      ).to.be.revertedWith('FeePool: not owner');
    });

    it('non-owner cannot set vault', async () => {
      const { feePool, stranger, vault } = await loadFixture(deployFixture);
      await expect(
        feePool.connect(stranger).setVault(vault.address)
      ).to.be.revertedWith('FeePool: not owner');
    });
  });
});
