const { expect }      = require('chai');
const { ethers }      = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

describe('AgentRegistry', () => {

  async function deployFixture() {
    const [owner, engine, agentA, agentB, agentC, devWallet] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory('MockERC20');
    const usdc = await USDC.deploy('USD Coin', 'USDC', 6);

    for (const acct of [agentA, agentB, agentC]) {
      await usdc.mint(acct.address, ethers.parseUnits('100', 6));
    }

    const Registry = await ethers.getContractFactory('AgentRegistry');
    const registry = await Registry.deploy(await usdc.getAddress());
    await registry.setSelectionEngine(engine.address);

    return { registry, usdc, owner, engine, agentA, agentB, agentC, devWallet };
  }

  async function register(registry, usdc, agentSigner, devWallet, agentType = 0) {
    await usdc.connect(agentSigner).approve(
      await registry.getAddress(), ethers.parseUnits('5', 6)
    );
    return registry.connect(agentSigner).register(
      agentType,
      'https://agent.example.com/card',
      50,
      devWallet.address
    );
  }

  // ─── Registration ────────────────────────────────────────────────────────

  describe('Registration', () => {
    it('locks MIN_STAKE (5 USDC) from caller on register()', async () => {
      const { registry, usdc, agentA, devWallet } = await loadFixture(deployFixture);
      const before = await usdc.balanceOf(agentA.address);
      await register(registry, usdc, agentA, devWallet);
      const after = await usdc.balanceOf(agentA.address);
      expect(before - after).to.equal(ethers.parseUnits('5', 6));
    });

    it('stores agent data correctly after register()', async () => {
      const { registry, usdc, agentA, devWallet } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      const agent = await registry.getAgent(agentA.address);
      expect(agent.wallet).to.equal(agentA.address);
      expect(agent.developerWallet).to.equal(devWallet.address);
      expect(agent.agentType).to.equal(0); // Scout
      expect(agent.status).to.equal(0);    // Active
      expect(agent.fee).to.equal(50);
      expect(agent.stake).to.equal(ethers.parseUnits('5', 6));
      expect(agent.reputationScore).to.equal(0);
    });

    it('adds scout to scoutAgents list', async () => {
      const { registry, usdc, agentA, devWallet } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet, 0);
      const scouts = await registry.getAllScouts();
      expect(scouts).to.include(agentA.address);
    });

    it('adds executor to executorAgents list', async () => {
      const { registry, usdc, agentA, devWallet } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet, 1);
      const executors = await registry.getAllExecutors();
      expect(executors).to.include(agentA.address);
    });

    it('reverts if stake not approved', async () => {
      const { registry, agentA, devWallet } = await loadFixture(deployFixture);
      await expect(
        registry.connect(agentA).register(0, 'https://x.com/card', 50, devWallet.address)
      ).to.be.reverted;
    });

    it('reverts if fee exceeds MAX_FEE_BPS (500)', async () => {
      const { registry, usdc, agentA, devWallet } = await loadFixture(deployFixture);
      await usdc.connect(agentA).approve(await registry.getAddress(), ethers.parseUnits('5', 6));
      await expect(
        registry.connect(agentA).register(0, 'https://x.com/card', 501, devWallet.address)
      ).to.be.revertedWith('Registry: fee exceeds max');
    });

    it('reverts if wallet already registered', async () => {
      const { registry, usdc, agentA, devWallet } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      await usdc.connect(agentA).approve(await registry.getAddress(), ethers.parseUnits('5', 6));
      await expect(
        registry.connect(agentA).register(0, 'https://x.com/card', 50, devWallet.address)
      ).to.be.revertedWith('Registry: already registered');
    });

    it('reverts if endpoint too short', async () => {
      const { registry, usdc, agentA, devWallet } = await loadFixture(deployFixture);
      await usdc.connect(agentA).approve(await registry.getAddress(), ethers.parseUnits('5', 6));
      await expect(
        registry.connect(agentA).register(0, 'https://', 50, devWallet.address)
      ).to.be.revertedWith('Registry: endpoint too short');
    });

    it('reverts if developerWallet is zero', async () => {
      const { registry, usdc, agentA } = await loadFixture(deployFixture);
      await usdc.connect(agentA).approve(await registry.getAddress(), ethers.parseUnits('5', 6));
      await expect(
        registry.connect(agentA).register(0, 'https://x.com/card', 50, ethers.ZeroAddress)
      ).to.be.revertedWith('Registry: zero dev wallet');
    });

    it('reverts for banned wallets', async () => {
      const { registry, usdc, agentA, devWallet, engine } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      // Drive score to -10 (ban threshold) via decrementReputation
      for (let i = 0; i < 5; i++) {
        await registry.connect(engine).decrementReputation(agentA.address, 2);
      }
      expect((await registry.getAgent(agentA.address)).status).to.equal(3); // Banned
      expect(await registry.bannedWallets(agentA.address)).to.be.true;
      await usdc.mint(agentA.address, ethers.parseUnits('10', 6));
      await usdc.connect(agentA).approve(await registry.getAddress(), ethers.parseUnits('5', 6));
      await expect(
        registry.connect(agentA).register(0, 'https://x.com/card', 50, devWallet.address)
      ).to.be.revertedWith('Registry: wallet banned');
    });
  });

  // ─── Reputation ──────────────────────────────────────────────────────────

  describe('Reputation', () => {
    it('only engine can call incrementReputation()', async () => {
      const { registry, usdc, agentA, agentB, devWallet } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      await expect(
        registry.connect(agentB).incrementReputation(agentA.address)
      ).to.be.revertedWith('Registry: not engine');
    });

    it('increments score and jobsCompleted on incrementReputation()', async () => {
      const { registry, usdc, agentA, devWallet, engine } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      await registry.connect(engine).incrementReputation(agentA.address);
      const a = await registry.getAgent(agentA.address);
      expect(a.reputationScore).to.equal(1);
      expect(a.jobsCompleted).to.equal(1);
    });

    it('decrements score and jobsFailed on decrementReputation()', async () => {
      const { registry, usdc, agentA, devWallet, engine } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      await registry.connect(engine).decrementReputation(agentA.address, 1);
      const a = await registry.getAgent(agentA.address);
      expect(a.reputationScore).to.equal(-1);
      expect(a.jobsFailed).to.equal(1);
    });

    it('pauses agent and slashes 1 USDC at PAUSE_THRESHOLD (-5)', async () => {
      const { registry, usdc, agentA, devWallet, engine, owner } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      const ownerBefore = await usdc.balanceOf(owner.address);
      // 3 × penalty=2 → score = -6 ≤ -5
      for (let i = 0; i < 3; i++) {
        await registry.connect(engine).decrementReputation(agentA.address, 2);
      }
      const a = await registry.getAgent(agentA.address);
      expect(a.status).to.equal(1);  // Paused
      expect(a.stake).to.equal(ethers.parseUnits('4', 6)); // 1 USDC slashed
      const ownerAfter = await usdc.balanceOf(owner.address);
      expect(ownerAfter - ownerBefore).to.equal(ethers.parseUnits('1', 6));
    });

    it('bans agent and slashes remaining stake at BAN_THRESHOLD (-10)', async () => {
      const { registry, usdc, agentA, devWallet, engine } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      // 5 × penalty=2 → score = -10
      for (let i = 0; i < 5; i++) {
        await registry.connect(engine).decrementReputation(agentA.address, 2);
      }
      const a = await registry.getAgent(agentA.address);
      expect(a.status).to.equal(3); // Banned
      expect(a.stake).to.equal(0);
      expect(await registry.bannedWallets(agentA.address)).to.be.true;
    });
  });

  // ─── Eligible Agent Sorting ───────────────────────────────────────────────

  describe('Eligible Agent Sorting', () => {
    it('returns scouts sorted by reputation descending', async () => {
      const { registry, usdc, agentA, agentB, agentC, devWallet, engine } =
        await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet, 0);
      await register(registry, usdc, agentB, devWallet, 0);
      await register(registry, usdc, agentC, devWallet, 0);
      // A=5, B=3, C=1
      for (let i = 0; i < 5; i++) await registry.connect(engine).incrementReputation(agentA.address);
      for (let i = 0; i < 3; i++) await registry.connect(engine).incrementReputation(agentB.address);
      for (let i = 0; i < 1; i++) await registry.connect(engine).incrementReputation(agentC.address);
      const eligible = await registry.getEligibleScouts();
      expect(eligible[0]).to.equal(agentA.address);
      expect(eligible[1]).to.equal(agentB.address);
      expect(eligible[2]).to.equal(agentC.address);
    });

    it('uses warmup floor (0) when fewer than 3 agents registered', async () => {
      const { registry, usdc, agentA, devWallet } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet, 0);
      const eligible = await registry.getEligibleScouts();
      expect(eligible).to.include(agentA.address);
    });

    it('excludes paused agents from eligible list', async () => {
      const { registry, usdc, agentA, agentB, devWallet, engine } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet, 0);
      await register(registry, usdc, agentB, devWallet, 0);
      // Pause agentA (score ≤ -5)
      for (let i = 0; i < 3; i++) {
        await registry.connect(engine).decrementReputation(agentA.address, 2);
      }
      const eligible = await registry.getEligibleScouts();
      expect(eligible).to.not.include(agentA.address);
      expect(eligible).to.include(agentB.address);
    });

    it('returns empty list when no eligible agents exist', async () => {
      const { registry } = await loadFixture(deployFixture);
      const eligible = await registry.getEligibleScouts();
      expect(eligible.length).to.equal(0);
    });
  });

  // ─── Deregistration ──────────────────────────────────────────────────────

  describe('Deregistration', () => {
    it('returns full stake when score >= 0', async () => {
      const { registry, usdc, agentA, devWallet } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      const before = await usdc.balanceOf(agentA.address);
      await registry.connect(agentA).deregister();
      const after = await usdc.balanceOf(agentA.address);
      expect(after - before).to.equal(ethers.parseUnits('5', 6));
    });

    it('returns zero stake when score < 0', async () => {
      const { registry, usdc, agentA, devWallet, engine } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      await registry.connect(engine).decrementReputation(agentA.address, 2);
      const before = await usdc.balanceOf(agentA.address);
      await registry.connect(agentA).deregister();
      const after = await usdc.balanceOf(agentA.address);
      expect(after - before).to.equal(0);
    });

    it('sets status to Deregistered', async () => {
      const { registry, usdc, agentA, devWallet } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      await registry.connect(agentA).deregister();
      const agent = await registry.getAgent(agentA.address);
      expect(agent.status).to.equal(2); // Deregistered
    });
  });

  // ─── Admin ───────────────────────────────────────────────────────────────

  describe('Admin', () => {
    it('owner can set selection engine', async () => {
      const { registry, engine } = await loadFixture(deployFixture);
      expect(await registry.selectionEngine()).to.equal(engine.address);
    });

    it('non-owner cannot set selection engine', async () => {
      const { registry, agentA, engine } = await loadFixture(deployFixture);
      await expect(
        registry.connect(agentA).setSelectionEngine(engine.address)
      ).to.be.revertedWith('Registry: not owner');
    });

    it('adminSetReputation sets reputation directly (demo only)', async () => {
      const { registry, usdc, agentA, devWallet, owner } = await loadFixture(deployFixture);
      await register(registry, usdc, agentA, devWallet);
      await registry.connect(owner).adminSetReputation(agentA.address, 10);
      const a = await registry.getAgent(agentA.address);
      expect(a.reputationScore).to.equal(10);
    });
  });
});
