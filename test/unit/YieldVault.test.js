const { expect }      = require('chai');
const { ethers }      = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

describe('YieldVault', () => {

  async function deployFixture() {
    const [owner, engine, user, user2, stranger] = await ethers.getSigners();

    const USDC     = await ethers.getContractFactory('MockERC20');
    const FeePool  = await ethers.getContractFactory('FeePool');
    const MockPoolA = await ethers.getContractFactory('MockPoolA');

    const usdc = await USDC.deploy('USD Coin', 'USDC', 6);

    // Deploy FeePool with a dummy vault address initially — will wire after vault deploy
    const feePool = await FeePool.deploy(await usdc.getAddress());

    // We need engine address before vault to satisfy vault constructor
    // Use `engine` signer address as mock engine
    const vault = await (await ethers.getContractFactory('YieldVault')).deploy(
      await usdc.getAddress(),
      engine.address,
      await feePool.getAddress()
    );

    // Wire FeePool
    await feePool.setVault(await vault.getAddress());
    await feePool.setOrchestrator(engine.address);

    // Deploy a mock adapter
    const mockPoolA = await MockPoolA.deploy(await vault.getAddress(), await usdc.getAddress(), 500);

    // Mint USDC to users
    await usdc.mint(user.address,  ethers.parseUnits('1000', 6));
    await usdc.mint(user2.address, ethers.parseUnits('1000', 6));

    return { vault, feePool, usdc, mockPoolA, owner, engine, user, user2, stranger };
  }

  describe('deposit()', () => {
    it('mints shares proportional to deposit', async () => {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits('100', 6);
      await usdc.connect(user).approve(await vault.getAddress(), amount);
      await vault.connect(user).deposit(amount);
      // Net = 99.9 USDC (0.1% fee), first deposit → shares = net units
      const shares = await vault.getUserShares(user.address);
      expect(shares).to.equal(ethers.parseUnits('99.9', 6));
    });

    it('collects 0.10% protocol fee to FeePool', async () => {
      const { vault, feePool, usdc, user } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits('100', 6);
      await usdc.connect(user).approve(await vault.getAddress(), amount);
      await vault.connect(user).deposit(amount);
      const poolBalance = await feePool.getBalance();
      expect(poolBalance).to.equal(ethers.parseUnits('0.1', 6)); // 0.10%
    });

    it('updates vault balance and totalShares correctly', async () => {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      expect(await vault.getVaultBalance()).to.equal(ethers.parseUnits('99.9', 6));
      expect(await vault.totalAssets()).to.equal(ethers.parseUnits('99.9', 6));
      expect(await vault.getTotalShares()).to.equal(ethers.parseUnits('99.9', 6));
    });

    it('two users get proportional shares', async () => {
      const { vault, usdc, user, user2 } = await loadFixture(deployFixture);
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      await usdc.connect(user2).approve(await vault.getAddress(), ethers.parseUnits('200', 6));
      await vault.connect(user2).deposit(ethers.parseUnits('200', 6));
      const sharesA = await vault.getUserShares(user.address);
      const sharesB = await vault.getUserShares(user2.address);
      // B deposited 2x A so should have ~2x shares
      expect(sharesB).to.be.closeTo(sharesA * 2n, ethers.parseUnits('0.01', 6));
    });

    it('reverts if deposit below minimum (1 USDC)', async () => {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('0.5', 6));
      await expect(
        vault.connect(user).deposit(ethers.parseUnits('0.5', 6))
      ).to.be.revertedWith('Vault: minimum deposit 1 USDC');
    });

    it('deploys USDC to active adapter immediately on deposit', async () => {
      const { vault, usdc, mockPoolA, engine, user } = await loadFixture(deployFixture);
      // First deposit to set up vault
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      // Engine rebalances to adapter
      await vault.connect(engine).rebalance(await mockPoolA.getAddress());
      // Second deposit should go directly to adapter
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('50', 6));
      await vault.connect(user).deposit(ethers.parseUnits('50', 6));
      const adapterBalance = await mockPoolA.getBalance();
      expect(adapterBalance).to.be.gt(0);
    });
  });

  describe('withdraw()', () => {
    it('user can withdraw proportional USDC by shares', async () => {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      const shares = await vault.getUserShares(user.address);
      const balBefore = await usdc.balanceOf(user.address);
      await vault.connect(user).withdraw(shares);
      const balAfter = await usdc.balanceOf(user.address);
      // Should get back ~99.9 USDC (net after fee)
      expect(balAfter - balBefore).to.equal(ethers.parseUnits('99.9', 6));
    });

    it('reverts if shares exceed balance', async () => {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      const shares = await vault.getUserShares(user.address);
      await expect(
        vault.connect(user).withdraw(shares + 1n)
      ).to.be.revertedWith('Vault: insufficient shares');
    });

    it('reverts on zero shares', async () => {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(vault.connect(user).withdraw(0)).to.be.revertedWith('Vault: zero shares');
    });

    it('pulls USDC from active adapter on withdraw', async () => {
      const { vault, usdc, mockPoolA, engine, user } = await loadFixture(deployFixture);
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      await vault.connect(engine).rebalance(await mockPoolA.getAddress());
      expect(await mockPoolA.getBalance()).to.be.gt(0);
      const shares = await vault.getUserShares(user.address);
      await vault.connect(user).withdraw(shares);
      expect(await mockPoolA.getBalance()).to.equal(0);
    });
  });

  describe('rebalance()', () => {
    it('only engine can call rebalance()', async () => {
      const { vault, mockPoolA, user } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).rebalance(await mockPoolA.getAddress())
      ).to.be.revertedWith('Vault: not engine');
    });

    it('engine can rebalance to a new adapter', async () => {
      const { vault, usdc, mockPoolA, engine, user } = await loadFixture(deployFixture);
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      await vault.connect(engine).rebalance(await mockPoolA.getAddress());
      expect(await vault.getCurrentAdapter()).to.equal(await mockPoolA.getAddress());
      expect(await mockPoolA.getBalance()).to.equal(ethers.parseUnits('99.9', 6));
    });

    it('reverts if already on same adapter', async () => {
      const { vault, usdc, mockPoolA, engine, user } = await loadFixture(deployFixture);
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      await vault.connect(engine).rebalance(await mockPoolA.getAddress());
      await expect(
        vault.connect(engine).rebalance(await mockPoolA.getAddress())
      ).to.be.revertedWith('Vault: already in this protocol');
    });

    it('reverts on zero adapter address', async () => {
      const { vault, engine } = await loadFixture(deployFixture);
      await expect(
        vault.connect(engine).rebalance(ethers.ZeroAddress)
      ).to.be.revertedWith('Vault: zero adapter');
    });
  });

  describe('setPolicy()', () => {
    it('user can set yield policy', async () => {
      const { vault, user } = await loadFixture(deployFixture);
      await vault.connect(user).setPolicy(200);
      const policy = await vault.userPolicy(user.address);
      expect(policy.threshold).to.equal(200);
      expect(policy.active).to.be.true;
    });

    it('reverts on zero threshold', async () => {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(vault.connect(user).setPolicy(0)).to.be.revertedWith('Vault: invalid threshold');
    });

    it('reverts on threshold above 5000', async () => {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(vault.connect(user).setPolicy(5001)).to.be.revertedWith('Vault: invalid threshold');
    });
  });

  describe('getUserBalance()', () => {
    it('returns correct USDC value for user shares', async () => {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      const balance = await vault.getUserBalance(user.address);
      expect(balance).to.equal(ethers.parseUnits('99.9', 6));
    });

    it('returns 0 when no shares', async () => {
      const { vault, stranger } = await loadFixture(deployFixture);
      expect(await vault.getUserBalance(stranger.address)).to.equal(0);
    });
  });

  describe('yield passthrough (live-asset valuation)', () => {
    it('reflects adapter yield in getUserBalance and pays it out on withdraw', async () => {
      const { vault, usdc, mockPoolA, owner, engine, user } = await loadFixture(deployFixture);

      // Deposit 100 USDC (net 99.9) and deploy it to the adapter.
      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      await vault.connect(engine).rebalance(await mockPoolA.getAddress());

      // Simulate 10 USDC of accrued interest in the adapter.
      await usdc.mint(owner.address, ethers.parseUnits('10', 6));
      await usdc.connect(owner).approve(await mockPoolA.getAddress(), ethers.parseUnits('10', 6));
      await mockPoolA.connect(owner).creditYield(ethers.parseUnits('10', 6));

      // Live valuation: user's balance is now principal + yield.
      expect(await vault.totalAssets()).to.equal(ethers.parseUnits('109.9', 6));
      expect(await vault.getUserBalance(user.address)).to.equal(ethers.parseUnits('109.9', 6));

      // Withdraw everything → user receives principal + yield.
      const shares    = await vault.getUserShares(user.address);
      const balBefore = await usdc.balanceOf(user.address);
      await vault.connect(user).withdraw(shares);
      const balAfter  = await usdc.balanceOf(user.address);
      expect(balAfter - balBefore).to.equal(ethers.parseUnits('109.9', 6));
      expect(await mockPoolA.getBalance()).to.equal(0);
    });

    it('carries accrued yield across a rebalance (nothing stranded)', async () => {
      const { vault, usdc, mockPoolA, owner, engine, user } = await loadFixture(deployFixture);
      const MockPoolB = await ethers.getContractFactory('MockPoolB');
      const mockPoolB = await MockPoolB.deploy(await vault.getAddress(), await usdc.getAddress(), 800);

      await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
      await vault.connect(user).deposit(ethers.parseUnits('100', 6));
      await vault.connect(engine).rebalance(await mockPoolA.getAddress());

      // Accrue 10 USDC on pool A, then move to pool B.
      await usdc.mint(owner.address, ethers.parseUnits('10', 6));
      await usdc.connect(owner).approve(await mockPoolA.getAddress(), ethers.parseUnits('10', 6));
      await mockPoolA.connect(owner).creditYield(ethers.parseUnits('10', 6));

      await vault.connect(engine).rebalance(await mockPoolB.getAddress());

      // Full principal + yield moved to B; nothing left in A.
      expect(await mockPoolA.getBalance()).to.equal(0);
      expect(await mockPoolB.getBalance()).to.equal(ethers.parseUnits('109.9', 6));
      expect(await vault.totalAssets()).to.equal(ethers.parseUnits('109.9', 6));
    });
  });
});
