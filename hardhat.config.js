require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
    },
  },
  networks: {
    fuji: {
      url:      process.env.FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
      accounts: [process.env.DEPLOYER_PRIVATE_KEY].filter(Boolean),
      chainId:  43113,
      gasPrice: 'auto',
      timeout:  60000,
    },
    hardhat: {
      chainId: 31337,
    },
  },
  etherscan: {
    apiKey: {
      avalancheFujiTestnet: process.env.SNOWTRACE_API_KEY || 'verifytoken',
    },
    customChains: [
      {
        network: 'avalancheFujiTestnet',
        chainId: 43113,
        urls: {
          apiURL:     'https://api-testnet.snowtrace.io/api',
          browserURL: 'https://testnet.snowtrace.io',
        },
      },
    ],
  },
  paths: {
    sources:   './contracts',
    tests:     './test',
    cache:     './cache',
    artifacts: './artifacts',
  },
};
