const { ethers } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Deployer:', deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'AVAX');

  // Also check orchestrator
  const orcAddr = '0x1a965c90dB06887944AAA3B72f62De04db9aFf20';
  const orcBal = await ethers.provider.getBalance(orcAddr);
  console.log('Orchestrator:', orcAddr);
  console.log('Balance:', ethers.formatEther(orcBal), 'AVAX');
}

main().catch(err => { console.error(err); process.exit(1); });
