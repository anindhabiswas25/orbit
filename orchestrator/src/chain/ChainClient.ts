import { ethers } from 'ethers'
import { CONFIG } from '../config'
import { Logger } from '../logger/Logger'
import * as fs from 'fs'
import * as path from 'path'

const log = new Logger('chain-client')

function loadABI(name: string): any[] {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'abis', `${name}.json`), 'utf8'))
}

export interface AdapterInfo {
  address: string
  name: string
  contract: ethers.Contract
}

export class ChainClient {
  public provider: ethers.JsonRpcProvider
  public wallet: ethers.Wallet
  public contracts: {
    engine: ethers.Contract
    registry: ethers.Contract
    yieldReg: ethers.Contract
    vault: ethers.Contract
    feePool: ethers.Contract
    ledger: ethers.Contract
  }
  public adapters: AdapterInfo[] = []

  constructor(privateKey: string, rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 })
    this.wallet = new ethers.Wallet(privateKey, this.provider)

    const { ADDRESSES } = CONFIG
    this.contracts = {
      engine:   new ethers.Contract(ADDRESSES.AgentSelectionEngine, loadABI('AgentSelectionEngine'), this.wallet),
      registry: new ethers.Contract(ADDRESSES.AgentRegistry, loadABI('AgentRegistry'), this.wallet),
      yieldReg: new ethers.Contract(ADDRESSES.YieldRegistry, loadABI('YieldRegistry'), this.wallet),
      vault:    new ethers.Contract(ADDRESSES.YieldVault, loadABI('YieldVault'), this.wallet),
      feePool:  new ethers.Contract(ADDRESSES.FeePool, loadABI('FeePool'), this.wallet),
      ledger:   new ethers.Contract(ADDRESSES.PaymentLedger, loadABI('PaymentLedger'), this.wallet),
    }
  }

  async verifyNetwork(): Promise<void> {
    const network = await this.provider.getNetwork()
    log.info(`Connected to network: ${network.name} (chainId: ${network.chainId})`)
    if (Number(network.chainId) !== CONFIG.CHAIN_ID && Number(network.chainId) !== 31337) {
      throw new Error(`Wrong network. Expected chainId ${CONFIG.CHAIN_ID}, got ${network.chainId}`)
    }
  }

  async initAdapters(): Promise<void> {
    const adapterABI = loadABI('IYieldAdapter')
    const addresses: string[] = await this.contracts.yieldReg.getAdapters()
    this.adapters = []

    for (const addr of addresses) {
      const contract = new ethers.Contract(addr, adapterABI, this.wallet)
      let name: string
      try {
        name = await this.contracts.yieldReg.adapterName(addr)
      } catch {
        name = addr.slice(0, 10)
      }
      this.adapters.push({ address: addr, name, contract })
    }

    log.info(`Loaded ${this.adapters.length} yield adapters`, {
      adapters: this.adapters.map(a => `${a.name} (${a.address.slice(0, 10)})`),
    })
  }

  async getAllAdapterAPYs(): Promise<Record<string, number>> {
    const results: Record<string, number> = {}
    await Promise.all(
      this.adapters.map(async (adapter) => {
        try {
          results[adapter.name] = Number(await adapter.contract.getAPY())
        } catch {
          results[adapter.name] = 0
        }
      })
    )
    return results
  }
}
