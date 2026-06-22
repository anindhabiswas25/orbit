const { expect }      = require('chai');
const { ethers }      = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

describe('PaymentLedger', () => {

  async function deployFixture() {
    const [owner, orchestrator, stranger, devWallet, agentWallet] = await ethers.getSigners();

    const Ledger = await ethers.getContractFactory('PaymentLedger');
    const ledger = await Ledger.deploy();

    await ledger.setOrchestrator(orchestrator.address);

    return { ledger, owner, orchestrator, stranger, devWallet, agentWallet };
  }

  describe('settle()', () => {
    it('records settlement correctly', async () => {
      const { ledger, orchestrator, devWallet, agentWallet } = await loadFixture(deployFixture);
      const txHash = ethers.keccak256(ethers.toUtf8Bytes('test-tx'));

      await ledger.connect(orchestrator).settle(
        1, agentWallet.address, devWallet.address, 100_000, txHash, 'Scout verified correctly', 0
      );

      const s = await ledger.getSettlement(1);
      expect(s.jobId).to.equal(1);
      expect(s.agentWallet).to.equal(agentWallet.address);
      expect(s.devWallet).to.equal(devWallet.address);
      expect(s.amount).to.equal(100_000);
      expect(s.paymentTxHash).to.equal(txHash);
      expect(s.settledAt).to.be.gt(0);
      expect(s.llmReasoning).to.equal('Scout verified correctly');
      expect(s.agentType).to.equal(0);
    });

    it('isPaid returns true after settlement', async () => {
      const { ledger, orchestrator, devWallet, agentWallet } = await loadFixture(deployFixture);
      const txHash = ethers.keccak256(ethers.toUtf8Bytes('test'));

      expect(await ledger.isPaid(1)).to.equal(false);
      await ledger.connect(orchestrator).settle(
        1, agentWallet.address, devWallet.address, 100_000, txHash, 'Approved', 0
      );
      expect(await ledger.isPaid(1)).to.equal(true);
    });

    it('reverts on double settlement', async () => {
      const { ledger, orchestrator, devWallet, agentWallet } = await loadFixture(deployFixture);
      const txHash = ethers.keccak256(ethers.toUtf8Bytes('test'));

      await ledger.connect(orchestrator).settle(
        1, agentWallet.address, devWallet.address, 100_000, txHash, 'Approved', 0
      );
      await expect(
        ledger.connect(orchestrator).settle(
          1, agentWallet.address, devWallet.address, 100_000, txHash, 'Duplicate', 0
        )
      ).to.be.revertedWith('Ledger: job already settled');
    });

    it('only orchestrator can settle', async () => {
      const { ledger, stranger, devWallet, agentWallet } = await loadFixture(deployFixture);
      const txHash = ethers.keccak256(ethers.toUtf8Bytes('test'));

      await expect(
        ledger.connect(stranger).settle(
          1, agentWallet.address, devWallet.address, 100_000, txHash, 'Should fail', 0
        )
      ).to.be.revertedWith('Ledger: not orchestrator');
    });

    it('reverts on zero devWallet', async () => {
      const { ledger, orchestrator, agentWallet } = await loadFixture(deployFixture);
      const txHash = ethers.keccak256(ethers.toUtf8Bytes('test'));

      await expect(
        ledger.connect(orchestrator).settle(
          1, agentWallet.address, ethers.ZeroAddress, 100_000, txHash, 'Bad wallet', 0
        )
      ).to.be.revertedWith('Ledger: zero devWallet');
    });

    it('reverts on zero amount', async () => {
      const { ledger, orchestrator, devWallet, agentWallet } = await loadFixture(deployFixture);
      const txHash = ethers.keccak256(ethers.toUtf8Bytes('test'));

      await expect(
        ledger.connect(orchestrator).settle(
          1, agentWallet.address, devWallet.address, 0, txHash, 'Zero amount', 0
        )
      ).to.be.revertedWith('Ledger: zero amount');
    });
  });

  describe('Views', () => {
    it('getTotalSettled increments', async () => {
      const { ledger, orchestrator, devWallet, agentWallet } = await loadFixture(deployFixture);
      const txHash = ethers.keccak256(ethers.toUtf8Bytes('test'));

      expect(await ledger.getTotalSettled()).to.equal(0);

      await ledger.connect(orchestrator).settle(
        1, agentWallet.address, devWallet.address, 100_000, txHash, 'Job 1', 0
      );
      expect(await ledger.getTotalSettled()).to.equal(1);

      await ledger.connect(orchestrator).settle(
        2, agentWallet.address, devWallet.address, 50_000, txHash, 'Job 2', 1
      );
      expect(await ledger.getTotalSettled()).to.equal(2);
    });

    it('getSettledJobIds pagination works', async () => {
      const { ledger, orchestrator, devWallet, agentWallet } = await loadFixture(deployFixture);
      const txHash = ethers.keccak256(ethers.toUtf8Bytes('test'));

      for (let i = 1; i <= 5; i++) {
        await ledger.connect(orchestrator).settle(
          i, agentWallet.address, devWallet.address, 100_000, txHash, `Job ${i}`, 0
        );
      }

      const page1 = await ledger.getSettledJobIds(0, 3);
      expect(page1.length).to.equal(3);
      expect(page1[0]).to.equal(1);
      expect(page1[2]).to.equal(3);

      const page2 = await ledger.getSettledJobIds(3, 10);
      expect(page2.length).to.equal(2);
      expect(page2[0]).to.equal(4);
      expect(page2[1]).to.equal(5);
    });

    it('getTotalEarnedBy accumulates correctly', async () => {
      const { ledger, orchestrator, devWallet, agentWallet } = await loadFixture(deployFixture);
      const txHash = ethers.keccak256(ethers.toUtf8Bytes('test'));

      await ledger.connect(orchestrator).settle(
        1, agentWallet.address, devWallet.address, 100_000, txHash, 'Job 1', 0
      );
      await ledger.connect(orchestrator).settle(
        2, agentWallet.address, devWallet.address, 50_000, txHash, 'Job 2', 0
      );

      expect(await ledger.getTotalEarnedBy(devWallet.address)).to.equal(150_000);
    });
  });

  describe('Access control', () => {
    it('only owner can set orchestrator', async () => {
      const { ledger, stranger, orchestrator } = await loadFixture(deployFixture);
      await expect(
        ledger.connect(stranger).setOrchestrator(orchestrator.address)
      ).to.be.revertedWith('Ledger: not owner');
    });

    it('rejects zero address orchestrator', async () => {
      const { ledger } = await loadFixture(deployFixture);
      await expect(
        ledger.setOrchestrator(ethers.ZeroAddress)
      ).to.be.revertedWith('Ledger: zero address');
    });
  });
});
