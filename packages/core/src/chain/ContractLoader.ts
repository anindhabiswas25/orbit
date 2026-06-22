import { ethers } from 'ethers'
import { FUJI_ADDRESSES } from './FujiAddresses'
import {
  AGENT_REGISTRY_ABI,
  AGENT_SELECTION_ENGINE_ABI,
  YIELD_REGISTRY_ABI,
  YIELD_VAULT_ABI,
  YIELD_ADAPTER_ABI,
  ERC20_ABI,
} from './abis'

export interface OrbitContracts {
  registry: ethers.Contract
  engine: ethers.Contract
  yieldReg: ethers.Contract
  vault: ethers.Contract
  usdc: ethers.Contract
  adapters: {
    aave: ethers.Contract
    benqi: ethers.Contract
    mockA: ethers.Contract
    mockB: ethers.Contract
  }
}

export class ContractLoader {
  static load(signerOrProvider: ethers.Signer | ethers.Provider): OrbitContracts {
    const c = (addr: string, abi: ethers.InterfaceAbi) =>
      new ethers.Contract(addr, abi, signerOrProvider)

    return {
      registry: c(FUJI_ADDRESSES.AgentRegistry, AGENT_REGISTRY_ABI),
      engine: c(FUJI_ADDRESSES.AgentSelectionEngine, AGENT_SELECTION_ENGINE_ABI),
      yieldReg: c(FUJI_ADDRESSES.YieldRegistry, YIELD_REGISTRY_ABI),
      vault: c(FUJI_ADDRESSES.YieldVault, YIELD_VAULT_ABI),
      usdc: c(FUJI_ADDRESSES.USDC, ERC20_ABI),
      adapters: {
        aave: c(FUJI_ADDRESSES.AaveAdapter, YIELD_ADAPTER_ABI),
        benqi: c(FUJI_ADDRESSES.BenqiAdapter, YIELD_ADAPTER_ABI),
        mockA: c(FUJI_ADDRESSES.MockPoolA, YIELD_ADAPTER_ABI),
        mockB: c(FUJI_ADDRESSES.MockPoolB, YIELD_ADAPTER_ABI),
      },
    }
  }
}
