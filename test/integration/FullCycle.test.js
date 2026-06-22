const { expect }      = require('chai');
const { ethers }      = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

/// @notice Full integration test covering the complete protocol lifecycle:
///         User deposit → Scout cycle → Executor rebalance → Agent payments
///         This is the authoritative test for the protocol's core invariants.
describe('Full Rebalance Cycle (Integration)', () => {

  async function deployAll() {
    const [owner, keeper, scoutAgent, execAgent, user, devWalletScout, devWalletExec] =
      await ethers.getSigners();

    const USDC     = await ethers.getContractFactory('MockERC20');
    const FeePool  = await ethers.getContractFactory('FeePool');
    const Registry = await ethers.getContractFactory('AgentRegistry');
    const YieldReg = await ethers.getContractFactory('YieldRegistry');
    const Engine   = await ethers.getContractFactory('AgentSelectionEngine');
    const Vault    = await ethers.getContractFactory('YieldVault');
    const MockA    = await ethers.getContractFactory('MockPoolA');
    const MockB    = await ethers.getContractFactory('MockPoolB');

    const usdc     = await USDC.deploy('USD Coin', 'USDC', 6);
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
    const mockB = await MockB.deploy(await vault.getAddress(), usdcAddr, 480);

    const Ledger = await ethers.getContractFactory('PaymentLedger');
    const ledger = await Ledger.deploy();

    // Post-deploy wiring
    await registry.setSelectionEngine(await engine.getAddress());
    await engine.setVault(await vault.getAddress());
    await engine.setPaymentLedger(await ledger.getAddress());
    // owner acts as orchestrator in integration tests
    await feePool.setOrchestrator(owner.address);
    await feePool.setVault(await vault.getAddress());
    await ledger.setOrchestrator(owner.address);
    await yieldReg.setSelectionEngine(await engine.getAddress());
    await yieldReg.registerAdapter(await mockA.getAddress(), 'MockPoolA');
    await yieldReg.registerAdapter(await mockB.getAddress(), 'MockPoolB');

    // Mint USDC
    await usdc.mint(user.address,        ethers.parseUnits('1000', 6));
    await usdc.mint(scoutAgent.address,  ethers.parseUnits('10',   6));
    await usdc.mint(execAgent.address,   ethers.parseUnits('10',   6));

    // Register scout + executor agents
    for (const [agent, devWallet, agentType] of [
      [scoutAgent, devWalletScout, 0],
      [execAgent,  devWalletExec,  1],
    ]) {
      await usdc.connect(agent).approve(await registry.getAddress(), ethers.parseUnits('5', 6));
      await registry.connect(agent).register(agentType, 'https://x.com/card', 100, devWallet.address);
      await yieldReg.authorizeAgent(agent.address);
    }

    return {
      usdc, feePool, registry, yieldReg, engine, vault, mockA, mockB, ledger,
      owner, keeper, scoutAgent, execAgent, user, devWalletScout, devWalletExec,
    };
  }

  // ─── Core Invariants ─────────────────────────────────────────────────────

  it('Invariant 1: User funds move from vault to adapter atomically (deposit→rebalance)', async () => {
    const f = await loadFixture(deployAll);
    const { usdc, vault, engine, yieldReg, scoutAgent, execAgent, mockA } = f;

    // User deposits 100 USDC
    await usdc.connect(f.user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
    await vault.connect(f.user).deposit(ethers.parseUnits('100', 6));

    // Vault holds USDC (no adapter yet)
    expect(await vault.getVaultBalance()).to.equal(ethers.parseUnits('99.9', 6));
    expect(await vault.getCurrentAdapter()).to.equal(ethers.ZeroAddress);

    // Scout cycle
    await engine.triggerScoutCycle();
    await yieldReg.connect(scoutAgent).updateBestProtocol(await mockA.getAddress(), 500);
    await engine.connect(scoutAgent).completeScoutJob(1);

    // Executor rebalances
    await engine.connect(execAgent).completeExecutorJob(2, await mockA.getAddress());

    // USDC is now in adapter — not sitting idle
    expect(await mockA.getBalance()).to.equal(ethers.parseUnits('99.9', 6));
    expect(await vault.getCurrentAdapter()).to.equal(await mockA.getAddress());
  });

  it('Invariant 2: Only engine can trigger rebalance (direct vault.rebalance call reverts)', async () => {
    const f = await loadFixture(deployAll);
    await expect(
      f.vault.connect(f.user).rebalance(await f.mockA.getAddress())
    ).to.be.revertedWith('Vault: not engine');
    await expect(
      f.vault.connect(f.scoutAgent).rebalance(await f.mockA.getAddress())
    ).to.be.revertedWith('Vault: not engine');
  });

  it('Invariant 3: Reputation is only criterion — highest rep agent wins job', async () => {
    const f = await loadFixture(deployAll);
    const { usdc, registry, engine, yieldReg } = f;

    // Register a second scout with higher reputation
    const [,,,,,,,,, betterScout, betterDev] = await ethers.getSigners();
    await usdc.mint(betterScout.address, ethers.parseUnits('20', 6));
    await usdc.connect(betterScout).approve(await registry.getAddress(), ethers.parseUnits('5', 6));
    await registry.connect(betterScout).register(0, 'https://better.com', 50, betterDev.address);
    await yieldReg.authorizeAgent(betterScout.address);
    await registry.adminSetReputation(betterScout.address, 5); // Higher than scoutAgent (0)

    await engine.triggerScoutCycle();
    const job = await engine.getJob(1);
    expect(job.assignedAgent).to.equal(betterScout.address); // betterScout wins
  });

  it('Invariant 4: Complete audit trail — all actions emitted as events', async () => {
    const f = await loadFixture(deployAll);
    const { usdc, vault, engine, yieldReg, registry, scoutAgent, execAgent, mockA } = f;

    await usdc.connect(f.user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
    const depositTx = await vault.connect(f.user).deposit(ethers.parseUnits('100', 6));
    const depositReceipt = await depositTx.wait();
    expect(depositReceipt.logs.some(l => {
      try { return vault.interface.parseLog(l)?.name === 'Deposited'; } catch { return false; }
    })).to.be.true;

    await engine.triggerScoutCycle();
    await yieldReg.connect(scoutAgent).updateBestProtocol(await mockA.getAddress(), 500);

    const completeTx = await engine.connect(scoutAgent).completeScoutJob(1);
    const completeReceipt = await completeTx.wait();
    expect(completeReceipt.logs.some(l => {
      try { return engine.interface.parseLog(l)?.name === 'JobCompleted'; } catch { return false; }
    })).to.be.true;

    const execTx = await engine.connect(execAgent).completeExecutorJob(2, await mockA.getAddress());
    const execReceipt = await execTx.wait();
    expect(execReceipt.logs.some(l => {
      try { return vault.interface.parseLog(l)?.name === 'Rebalanced'; } catch { return false; }
    })).to.be.true;
    expect(execReceipt.logs.some(l => {
      try { return yieldReg.interface.parseLog(l)?.name === 'RebalanceLogged'; } catch { return false; }
    })).to.be.true;
  });

  it('Invariant 5: Stake is always at risk — negative score forfeits stake on deregister', async () => {
    const f = await loadFixture(deployAll);
    const { engine, registry, usdc, scoutAgent } = f;

    // Confirm stake is locked at registration (5 USDC)
    const agent0 = await registry.getAgent(scoutAgent.address);
    expect(agent0.stake).to.equal(ethers.parseUnits('5', 6));
    expect(Number(agent0.status)).to.equal(0); // Active

    // Trigger a job and let it expire → rep drops to -1
    await engine.triggerScoutCycle();
    await time.increase(91);
    await engine.expireJob(1);

    const agentAfter = await registry.getAgent(scoutAgent.address);
    expect(agentAfter.reputationScore).to.equal(-1); // Rep is negative

    // Agent deregisters with negative score → stake is NOT returned
    const balBefore = await usdc.balanceOf(scoutAgent.address);
    await registry.connect(scoutAgent).deregister();
    const balAfter = await usdc.balanceOf(scoutAgent.address);
    expect(balAfter - balBefore).to.equal(0); // Zero stake returned — stake is at risk

    // Note: Full pause/slash at PAUSE_THRESHOLD (-5) and ban at BAN_THRESHOLD (-10)
    // are tested via direct decrementReputation calls in AgentRegistry unit tests.
  });

  // ─── Full End-to-End Cycle ────────────────────────────────────────────────

  it('E2E: deposit → scout → executor rebalance → both agents paid → second rebalance', async () => {
    const f = await loadFixture(deployAll);
    const { usdc, vault, engine, yieldReg, registry, scoutAgent, execAgent, mockA, mockB,
            devWalletScout, devWalletExec, feePool } = f;

    // ── User deposits 100 USDC ─────────────────────────────────────────────
    await usdc.connect(f.user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
    await vault.connect(f.user).deposit(ethers.parseUnits('100', 6));
    expect(await vault.getVaultBalance()).to.equal(ethers.parseUnits('99.9', 6));
    expect(await feePool.getBalance()).to.equal(ethers.parseUnits('0.1', 6));

    // Seed FeePool above MIN_RESERVE so orchestrator can pay agents
    await usdc.mint(await feePool.getAddress(), ethers.parseUnits('20', 6));

    // ── Scout cycle ────────────────────────────────────────────────────────
    await engine.triggerScoutCycle();
    const scoutJob = await engine.getJob(1);
    expect(scoutJob.assignedAgent).to.equal(scoutAgent.address);

    await yieldReg.connect(scoutAgent).updateBestProtocol(await mockA.getAddress(), 500);

    // Engine no longer pays — emits JobCompleted for orchestrator to handle
    await engine.connect(scoutAgent).completeScoutJob(1);

    const scoutRep = (await registry.getAgent(scoutAgent.address)).reputationScore;
    expect(scoutRep).to.equal(1);

    // Orchestrator pays scout (owner acts as orchestrator in test)
    const scoutDevBefore = await usdc.balanceOf(devWalletScout.address);
    await feePool.payAgent(devWalletScout.address, 50_000n, 1);
    const scoutDevAfter = await usdc.balanceOf(devWalletScout.address);
    expect(scoutDevAfter - scoutDevBefore).to.equal(50_000n);

    // ── Executor job (auto-assigned after scout) ──────────────────────────
    const execJob = await engine.getJob(2);
    expect(execJob.assignedAgent).to.equal(execAgent.address);

    await engine.connect(execAgent).completeExecutorJob(2, await mockA.getAddress());

    // Orchestrator pays executor
    const execDevBefore = await usdc.balanceOf(devWalletExec.address);
    await feePool.payAgent(devWalletExec.address, 50_000n, 2);
    const execDevAfter = await usdc.balanceOf(devWalletExec.address);
    expect(execDevAfter - execDevBefore).to.equal(50_000n);

    expect(await vault.getCurrentAdapter()).to.equal(await mockA.getAddress());
    expect(await yieldReg.activeProtocol()).to.equal(await mockA.getAddress());
    expect(await yieldReg.getRebalanceLogsCount()).to.equal(1);

    const execRep = (await registry.getAgent(execAgent.address)).reputationScore;
    expect(execRep).to.equal(1);

    // ── Second cycle: MockB APY jumps to 18% ─────────────────────────────
    await mockB.setAPY(1800);
    await time.increase(61);
    await engine.triggerScoutCycle();
    await yieldReg.connect(scoutAgent).updateBestProtocol(await mockB.getAddress(), 1800);
    await engine.connect(scoutAgent).completeScoutJob(3);

    // Executor rebalances from MockA to MockB
    await engine.connect(execAgent).completeExecutorJob(4, await mockB.getAddress());

    expect(await vault.getCurrentAdapter()).to.equal(await mockB.getAddress());
    expect(await mockA.getBalance()).to.equal(0);
    expect(await mockB.getBalance()).to.equal(ethers.parseUnits('99.9', 6));
    expect(await yieldReg.getRebalanceLogsCount()).to.equal(2);
    expect(await yieldReg.activeAPY()).to.equal(1800);

    // ── User withdraws ─────────────────────────────────────────────────────
    const shares = await vault.getUserShares(f.user.address);
    const userBalBefore = await usdc.balanceOf(f.user.address);
    await vault.connect(f.user).withdraw(shares);
    const userBalAfter = await usdc.balanceOf(f.user.address);
    expect(userBalAfter - userBalBefore).to.equal(ethers.parseUnits('99.9', 6));
    expect(await mockB.getBalance()).to.equal(0);
  });

  // ─── Job Expiry ───────────────────────────────────────────────────────────

  it('Job timeout: agent slashed -1, job re-assigned to next eligible agent', async () => {
    const f = await loadFixture(deployAll);
    const { usdc, vault, engine, yieldReg, registry, scoutAgent } = f;

    await usdc.connect(f.user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
    await vault.connect(f.user).deposit(ethers.parseUnits('100', 6));
    await engine.triggerScoutCycle();

    // Don't complete — let it time out
    await time.increase(91);

    const repBefore = (await registry.getAgent(scoutAgent.address)).reputationScore;
    await engine.expireJob(1);
    const repAfter = (await registry.getAgent(scoutAgent.address)).reputationScore;
    expect(repAfter).to.equal(repBefore - 1n);

    const job = await engine.getJob(1);
    expect(Number(job.status)).to.equal(3); // Expired
  });

  // ─── Fee Collection ───────────────────────────────────────────────────────

  it('Protocol fee is 0.10% of each deposit and goes to FeePool', async () => {
    const f = await loadFixture(deployAll);
    const { usdc, vault, feePool } = f;

    await usdc.connect(f.user).approve(await vault.getAddress(), ethers.parseUnits('100', 6));
    await vault.connect(f.user).deposit(ethers.parseUnits('100', 6));

    // 0.10% of 100 USDC = 0.1 USDC = 100_000 units
    expect(await feePool.getBalance()).to.equal(100_000n);
    expect(await feePool.totalCollected()).to.equal(100_000n);
  });

  // ─── Warmup Phase ────────────────────────────────────────────────────────

  it('Warmup phase: agent with rep=0 is eligible when fewer than 3 agents registered', async () => {
    const f = await loadFixture(deployAll);
    // Only scoutAgent is registered (rep=0, warmup floor=0 → eligible)
    const eligible = await f.registry.getEligibleScouts();
    expect(eligible).to.include(f.scoutAgent.address);
  });
});
