const { expect }      = require('chai');
const { ethers }      = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

describe('YieldRegistry', () => {

  async function deployFixture() {
    const [owner, engine, scoutAgent, executorAgent, stranger, mockAdapterA, mockAdapterB] =
      await ethers.getSigners();

    const YieldRegistry = await ethers.getContractFactory('YieldRegistry');
    const yieldReg = await YieldRegistry.deploy();

    // Set engine
    await yieldReg.setSelectionEngine(engine.address);

    // Register adapters
    await yieldReg.registerAdapter(mockAdapterA.address, 'MockA');
    await yieldReg.registerAdapter(mockAdapterB.address, 'MockB');

    // Authorize agents
    await yieldReg.authorizeAgent(scoutAgent.address);
    await yieldReg.authorizeAgent(executorAgent.address);

    return { yieldReg, owner, engine, scoutAgent, executorAgent, stranger, mockAdapterA, mockAdapterB };
  }

  describe('Admin', () => {
    it('registers adapters correctly', async () => {
      const { yieldReg, mockAdapterA } = await loadFixture(deployFixture);
      expect(await yieldReg.isAdapter(mockAdapterA.address)).to.be.true;
      const adapters = await yieldReg.getAdapters();
      expect(adapters).to.include(mockAdapterA.address);
    });

    it('reverts on duplicate adapter registration', async () => {
      const { yieldReg, mockAdapterA } = await loadFixture(deployFixture);
      await expect(
        yieldReg.registerAdapter(mockAdapterA.address, 'Duplicate')
      ).to.be.revertedWith('Registry: already registered');
    });

    it('authorizes agents correctly', async () => {
      const { yieldReg, scoutAgent } = await loadFixture(deployFixture);
      expect(await yieldReg.authorizedAgents(scoutAgent.address)).to.be.true;
    });

    it('non-owner cannot register adapter', async () => {
      const { yieldReg, stranger } = await loadFixture(deployFixture);
      await expect(
        yieldReg.connect(stranger).registerAdapter(stranger.address, 'BadPool')
      ).to.be.revertedWith('Registry: not owner');
    });
  });

  describe('updateBestProtocol()', () => {
    it('authorized scout can update best protocol', async () => {
      const { yieldReg, scoutAgent, mockAdapterA } = await loadFixture(deployFixture);
      await yieldReg.connect(scoutAgent).updateBestProtocol(mockAdapterA.address, 620);
      expect(await yieldReg.bestProtocol()).to.equal(mockAdapterA.address);
      expect(await yieldReg.bestAPY()).to.equal(620);
    });

    it('reverts for unknown adapter', async () => {
      const { yieldReg, scoutAgent, stranger } = await loadFixture(deployFixture);
      await expect(
        yieldReg.connect(scoutAgent).updateBestProtocol(stranger.address, 620)
      ).to.be.revertedWith('Registry: unknown adapter');
    });

    it('reverts for zero APY', async () => {
      const { yieldReg, scoutAgent, mockAdapterA } = await loadFixture(deployFixture);
      await expect(
        yieldReg.connect(scoutAgent).updateBestProtocol(mockAdapterA.address, 0)
      ).to.be.revertedWith('Registry: APY must be positive');
    });

    it('unauthorized agent cannot call updateBestProtocol()', async () => {
      const { yieldReg, stranger, mockAdapterA } = await loadFixture(deployFixture);
      await expect(
        yieldReg.connect(stranger).updateBestProtocol(mockAdapterA.address, 620)
      ).to.be.revertedWith('Registry: not authorized agent');
    });

    it('updates lastUpdated timestamp', async () => {
      const { yieldReg, scoutAgent, mockAdapterA } = await loadFixture(deployFixture);
      const before = await ethers.provider.getBlock('latest');
      await yieldReg.connect(scoutAgent).updateBestProtocol(mockAdapterA.address, 620);
      const lastUpdated = await yieldReg.lastUpdated();
      expect(lastUpdated).to.be.gte(before.timestamp);
    });
  });

  describe('logRebalance()', () => {
    it('authorized executor can log rebalance', async () => {
      const { yieldReg, executorAgent, mockAdapterA, mockAdapterB } = await loadFixture(deployFixture);
      await yieldReg.connect(executorAgent).logRebalance(
        mockAdapterA.address, mockAdapterB.address, 500, 620, ethers.parseUnits('100', 6)
      );
      expect(await yieldReg.activeProtocol()).to.equal(mockAdapterB.address);
      expect(await yieldReg.activeAPY()).to.equal(620);
      expect(await yieldReg.getRebalanceLogsCount()).to.equal(1);
    });

    it('engine can log rebalance', async () => {
      const { yieldReg, engine, mockAdapterA, mockAdapterB } = await loadFixture(deployFixture);
      await yieldReg.connect(engine).logRebalance(
        mockAdapterA.address, mockAdapterB.address, 500, 620, ethers.parseUnits('100', 6)
      );
      expect(await yieldReg.activeProtocol()).to.equal(mockAdapterB.address);
    });

    it('stranger cannot log rebalance', async () => {
      const { yieldReg, stranger, mockAdapterA, mockAdapterB } = await loadFixture(deployFixture);
      await expect(
        yieldReg.connect(stranger).logRebalance(
          mockAdapterA.address, mockAdapterB.address, 500, 620, ethers.parseUnits('100', 6)
        )
      ).to.be.revertedWith('Registry: not engine or agent');
    });

    it('reverts if toProtocol is not a registered adapter', async () => {
      const { yieldReg, executorAgent, mockAdapterA, stranger } = await loadFixture(deployFixture);
      await expect(
        yieldReg.connect(executorAgent).logRebalance(
          mockAdapterA.address, stranger.address, 500, 620, ethers.parseUnits('100', 6)
        )
      ).to.be.revertedWith('Registry: target not registered adapter');
    });

    it('appends to rebalanceLogs array', async () => {
      const { yieldReg, executorAgent, mockAdapterA, mockAdapterB } = await loadFixture(deployFixture);
      await yieldReg.connect(executorAgent).logRebalance(
        mockAdapterA.address, mockAdapterB.address, 500, 620, 100_000_000n
      );
      await yieldReg.connect(executorAgent).logRebalance(
        mockAdapterB.address, mockAdapterA.address, 620, 500, 100_000_000n
      );
      expect(await yieldReg.getRebalanceLogsCount()).to.equal(2);
      const logs = await yieldReg.getRebalanceLogs(0, 2);
      expect(logs[0].fromProtocol).to.equal(mockAdapterA.address);
      expect(logs[1].fromProtocol).to.equal(mockAdapterB.address);
    });
  });

  describe('getRebalanceLogs() pagination', () => {
    it('returns correct slice with from and count', async () => {
      const { yieldReg, executorAgent, mockAdapterA, mockAdapterB } = await loadFixture(deployFixture);
      for (let i = 0; i < 5; i++) {
        await yieldReg.connect(executorAgent).logRebalance(
          mockAdapterA.address, mockAdapterB.address, i * 100, (i + 1) * 100, 1_000_000n
        );
      }
      const logs = await yieldReg.getRebalanceLogs(2, 2);
      expect(logs.length).to.equal(2);
      expect(logs[0].fromAPY).to.equal(200);
    });
  });
});
