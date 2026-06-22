const { expect }      = require('chai');
const { ethers }      = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

describe('AgentSelectionEngine', () => {

  async function deployAll() {
    const [owner, keeper, scoutA, scoutB, execA, user, devWalletS, devWalletE] =
      await ethers.getSigners();

    const USDC     = await ethers.getContractFactory('MockERC20');
    const FeePool  = await ethers.getContractFactory('FeePool');
    const Registry = await ethers.getContractFactory('AgentRegistry');
    const YieldReg = await ethers.getContractFactory('YieldRegistry');
    const Engine   = await ethers.getContractFactory('AgentSelectionEngine');
    const Vault    = await ethers.getContractFactory('YieldVault');
    const MockA    = await ethers.getContractFactory('MockPoolA');

    const usdc    = await USDC.deploy('USD Coin', 'USDC', 6);
    const usdcAddr = await usdc.getAddress();

    const feePool  = await FeePool.deploy(usdcAddr);
    const registry = await Registry.deploy(usdcAddr);
    const yieldReg = await YieldReg.deploy();
    const engine   = await Engine.deploy(
      await registry.getAddress(),
      await yieldReg.getAddress(),
      await feePool.getAddress()
    );
    const vault = await Vault.deploy(usdcAddr, await engine.getAddress(), await feePool.getAddress());
    const mockA = await MockA.deploy(await vault.getAddress(), usdcAddr, 500);

    // Post-deploy wiring
    await registry.setSelectionEngine(await engine.getAddress());
    await engine.setVault(await vault.getAddress());
    // Engine no longer calls FeePool.payAgent — set deployer as orchestrator for tests
    await feePool.setOrchestrator(owner.address);
    await feePool.setVault(await vault.getAddress());
    await yieldReg.setSelectionEngine(await engine.getAddress());
    await yieldReg.registerAdapter(await mockA.getAddress(), 'MockPoolA');

    // Mint and distribute USDC
    await usdc.mint(user.address,   ethers.parseUnits('1000', 6));
    await usdc.mint(scoutA.address, ethers.parseUnits('20',   6));
    await usdc.mint(scoutB.address, ethers.parseUnits('20',   6));
    await usdc.mint(execA.address,  ethers.parseUnits('20',   6));

    // Register agents
    for (const [agent, devWallet, agentType] of [
      [scoutA, devWalletS, 0],
      [execA,  devWalletE, 1],
    ]) {
      await usdc.connect(agent).approve(await registry.getAddress(), ethers.parseUnits('5', 6));
      await registry.connect(agent).register(agentType, 'https://x.com/card', 50, devWallet.address);
      await yieldReg.authorizeAgent(agent.address);
    }

    // Deposit 100 USDC from user
    await usdc.connect(user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
    await vault.connect(user).deposit(ethers.parseUnits('100', 6));

    return {
      usdc, feePool, registry, yieldReg, engine, vault, mockA,
      owner, keeper, scoutA, scoutB, execA, user, devWalletS, devWalletE,
    };
  }

  // ─── Scout Cycle ─────────────────────────────────────────────────────────

  describe('triggerScoutCycle()', () => {
    it('creates a scout job and assigns it to eligible agent', async () => {
      const { engine, scoutA } = await loadFixture(deployAll);
      await engine.triggerScoutCycle();
      const job = await engine.getJob(1);
      expect(job.assignedAgent).to.equal(scoutA.address);
      expect(Number(job.jobType)).to.equal(0); // Scout
      expect(Number(job.status)).to.equal(0);  // Pending
    });

    it('reverts if called too soon after last scout', async () => {
      const { engine } = await loadFixture(deployAll);
      await engine.triggerScoutCycle();
      await expect(engine.triggerScoutCycle()).to.be.revertedWith('Engine: too soon since last scout');
    });

    it('allows re-trigger after SCOUT_INTERVAL seconds', async () => {
      const { engine } = await loadFixture(deployAll);
      await engine.triggerScoutCycle();
      await time.increase(61);
      await expect(engine.triggerScoutCycle()).to.not.be.reverted;
    });

    it('emits JobAssigned event', async () => {
      const { engine, scoutA } = await loadFixture(deployAll);
      const tx = await engine.triggerScoutCycle();
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return engine.interface.parseLog(l)?.name === 'JobAssigned'; } catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });
  });

  // ─── Scout Job Completion ─────────────────────────────────────────────────

  describe('completeScoutJob()', () => {
    it('rejects wrong agent calling completeScoutJob()', async () => {
      const { engine, scoutB } = await loadFixture(deployAll);
      await engine.triggerScoutCycle();
      await expect(engine.connect(scoutB).completeScoutJob(1))
        .to.be.revertedWith('Engine: not your job');
    });

    it('fails job with -2 penalty if no result posted to YieldRegistry', async () => {
      const { engine, scoutA, registry } = await loadFixture(deployAll);
      await engine.triggerScoutCycle();
      const repBefore = (await registry.getAgent(scoutA.address)).reputationScore;
      await engine.connect(scoutA).completeScoutJob(1);
      const job = await engine.getJob(1);
      expect(Number(job.status)).to.equal(2); // Failed
      const repAfter = (await registry.getAgent(scoutA.address)).reputationScore;
      expect(repAfter).to.equal(repBefore - 2n);
    });

    it('completes scout job successfully with valid YieldRegistry result', async () => {
      const { engine, scoutA, yieldReg, registry, mockA, devWalletS, usdc, feePool } =
        await loadFixture(deployAll);
      await engine.triggerScoutCycle();

      // Scout posts result
      const mockAAddr = await mockA.getAddress();
      await yieldReg.connect(scoutA).updateBestProtocol(mockAAddr, 500);

      // Seed FeePool
      const USDC = await ethers.getContractFactory('MockERC20');
      await usdc.mint(await feePool.getAddress(), ethers.parseUnits('10', 6));
      // Note: FeePool.deposit is onlyVault — we directly mint to simulate funding
      // In real flow, vault.deposit() triggers feePool.deposit() automatically

      const repBefore = (await registry.getAgent(scoutA.address)).reputationScore;
      await engine.connect(scoutA).completeScoutJob(1);
      const repAfter = (await registry.getAgent(scoutA.address)).reputationScore;
      expect(repAfter).to.equal(repBefore + 1n);

      const job = await engine.getJob(1);
      expect(Number(job.status)).to.equal(1); // Completed
    });

    it('auto-assigns executor job after scout completes', async () => {
      const { engine, scoutA, yieldReg, mockA, execA } = await loadFixture(deployAll);
      await engine.triggerScoutCycle();
      await yieldReg.connect(scoutA).updateBestProtocol(await mockA.getAddress(), 500);
      await engine.connect(scoutA).completeScoutJob(1);
      const execJob = await engine.getJob(2);
      expect(execJob.assignedAgent).to.equal(execA.address);
      expect(Number(execJob.jobType)).to.equal(1); // Executor
    });
  });

  // ─── Executor Job Completion ──────────────────────────────────────────────

  describe('completeExecutorJob() — with rebalance', () => {
    async function triggerExecutorJob(f) {
      await f.engine.triggerScoutCycle();
      await f.yieldReg.connect(f.scoutA).updateBestProtocol(await f.mockA.getAddress(), 500);
      await f.engine.connect(f.scoutA).completeScoutJob(1);
      // execJob is job #2
    }

    it('executor completes job with rebalance and vault moves to adapter', async () => {
      const f = await loadFixture(deployAll);
      await triggerExecutorJob(f);
      const mockAAddr = await f.mockA.getAddress();
      await f.engine.connect(f.execA).completeExecutorJob(2, mockAAddr);
      expect(await f.vault.getCurrentAdapter()).to.equal(mockAAddr);
      expect(await f.mockA.getBalance()).to.be.gt(0);
    });

    it('executor gets reputation +1 on completion', async () => {
      const f = await loadFixture(deployAll);
      await triggerExecutorJob(f);
      const repBefore = (await f.registry.getAgent(f.execA.address)).reputationScore;
      await f.engine.connect(f.execA).completeExecutorJob(2, await f.mockA.getAddress());
      const repAfter = (await f.registry.getAgent(f.execA.address)).reputationScore;
      expect(repAfter).to.equal(repBefore + 1n);
    });

    it('reverts if newAdapter is not best protocol', async () => {
      const f = await loadFixture(deployAll);
      await triggerExecutorJob(f);
      // Deploy a second mock pool but don't post it as best
      const MockB = await ethers.getContractFactory('MockPoolB');
      const mockB = await MockB.deploy(await f.vault.getAddress(), await f.usdc.getAddress(), 480);
      await f.yieldReg.registerAdapter(await mockB.getAddress(), 'MockPoolB');
      await expect(
        f.engine.connect(f.execA).completeExecutorJob(2, await mockB.getAddress())
      ).to.be.revertedWith('Engine: newAdapter is not best protocol');
    });

    it('reverts if adapter is not registered', async () => {
      const f = await loadFixture(deployAll);
      await triggerExecutorJob(f);
      await expect(
        f.engine.connect(f.execA).completeExecutorJob(2, ethers.ZeroAddress)
      ).to.be.revertedWith('Engine: zero adapter');
    });
  });

  describe('completeExecutorJobNoOp()', () => {
    it('executor can complete no-op job (no rebalance)', async () => {
      const f = await loadFixture(deployAll);
      await f.engine.triggerScoutCycle();
      await f.yieldReg.connect(f.scoutA).updateBestProtocol(await f.mockA.getAddress(), 500);
      await f.engine.connect(f.scoutA).completeScoutJob(1);
      const repBefore = (await f.registry.getAgent(f.execA.address)).reputationScore;
      await f.engine.connect(f.execA).completeExecutorJobNoOp(2);
      const repAfter = (await f.registry.getAgent(f.execA.address)).reputationScore;
      expect(repAfter).to.equal(repBefore + 1n);
      const job = await f.engine.getJob(2);
      expect(Number(job.status)).to.equal(1); // Completed
    });
  });

  // ─── Job Expiry ───────────────────────────────────────────────────────────

  describe('expireJob()', () => {
    it('expires timed-out job and slashes -1 rep from agent', async () => {
      const { engine, scoutA, registry } = await loadFixture(deployAll);
      await engine.triggerScoutCycle();
      await time.increase(91); // Past 90s deadline
      const repBefore = (await registry.getAgent(scoutA.address)).reputationScore;
      await engine.expireJob(1);
      const job = await engine.getJob(1);
      expect(Number(job.status)).to.equal(3); // Expired
      const repAfter = (await registry.getAgent(scoutA.address)).reputationScore;
      expect(repAfter).to.equal(repBefore - 1n);
    });

    it('reverts if deadline not yet passed', async () => {
      const { engine } = await loadFixture(deployAll);
      await engine.triggerScoutCycle();
      await expect(engine.expireJob(1)).to.be.revertedWith('Engine: deadline not passed');
    });

    it('reverts if job is not pending', async () => {
      const { engine, scoutA, yieldReg, mockA } = await loadFixture(deployAll);
      await engine.triggerScoutCycle();
      await yieldReg.connect(scoutA).updateBestProtocol(await mockA.getAddress(), 500);
      await engine.connect(scoutA).completeScoutJob(1);
      await time.increase(91);
      await expect(engine.expireJob(1)).to.be.revertedWith('Engine: job not pending');
    });

    it('re-assigns job after expiry', async () => {
      const { engine, scoutA, scoutB, registry, usdc, yieldReg } = await loadFixture(deployAll);

      // Register scoutB too
      await usdc.connect(scoutB).approve(await registry.getAddress(), ethers.parseUnits('5', 6));
      await registry.connect(scoutB).register(0, 'https://b.com/card', 30, scoutB.address);
      await yieldReg.authorizeAgent(scoutB.address);

      await engine.triggerScoutCycle(); // Assigns to scoutA (rotation=0 → picks idx 0)
      await time.increase(91);
      await engine.expireJob(1); // Slashes scoutA → re-assigns via _assignJob

      // A new job (#2) is created and assigned to an eligible agent
      const newJob = await engine.getJob(2);
      expect(Number(newJob.status)).to.equal(0); // Pending
      expect(newJob.assignedAgent).to.not.equal(ethers.ZeroAddress);
    });
  });

  // ─── Access Control ───────────────────────────────────────────────────────

  describe('Access control', () => {
    it('only owner can set vault', async () => {
      const { engine, scoutA, vault } = await loadFixture(deployAll);
      await expect(
        engine.connect(scoutA).setVault(await vault.getAddress())
      ).to.be.revertedWith('Engine: not owner');
    });
  });
});
