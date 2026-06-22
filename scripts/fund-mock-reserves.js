// Fund the MockPool yield reserves so time-based APY accrual can actually pay out.
// The pools only grow getBalance() up to the USDC reserve they hold.
// Run: npx hardhat run scripts/fund-mock-reserves.js --network fuji
//   RESERVE_USDC=10 npx hardhat run scripts/fund-mock-reserves.js --network fuji

const { ethers } = require('hardhat');
const ADDRESSES  = require('../deployed-addresses.json');

const ERC20 = [
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const reserveEach = ethers.parseUnits(process.env.RESERVE_USDC || '5', 6);

  const usdc = new ethers.Contract(ADDRESSES.USDC, ERC20, deployer);
  const MockPoolA = await ethers.getContractFactory('MockPoolA');
  const MockPoolB = await ethers.getContractFactory('MockPoolB');
  const pools = [
    { name: 'MockPoolA', c: MockPoolA.attach(ADDRESSES.MockPoolA) },
    { name: 'MockPoolB', c: MockPoolB.attach(ADDRESSES.MockPoolB) },
  ];

  console.log('═══════════════════════════════════════════════════════');
  console.log('  Fund MockPool Yield Reserves');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Deployer:     ${deployer.address}`);
  console.log(`  Reserve each: ${ethers.formatUnits(reserveEach, 6)} USDC`);
  const bal = await usdc.balanceOf(deployer.address);
  console.log(`  USDC balance: ${ethers.formatUnits(bal, 6)}`);
  console.log('');

  for (const { name, c } of pools) {
    process.stdout.write(`  ${name}: approve...`);
    await (await usdc.approve(await c.getAddress(), reserveEach)).wait();
    process.stdout.write(' fundYieldReserve...');
    await (await c.fundYieldReserve(reserveEach)).wait();
    const reserve = await c.getReserve();
    console.log(` ✓ reserve = ${ethers.formatUnits(reserve, 6)} USDC`);
  }

  console.log('');
  console.log('✓ Reserves funded. Pools will now accrue yield at their set APY,');
  console.log('  paying from these reserves, until exhausted.');
}

main().catch(err => { console.error(err); process.exit(1); });
