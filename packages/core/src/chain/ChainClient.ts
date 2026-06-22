import { ethers } from 'ethers'
import { ContractLoader, OrbitContracts } from './ContractLoader'
import { FUJI_RPC_URL, FUJI_CHAIN_ID } from './FujiAddresses'
import { UserError } from '../errors'

export class ChainClient {
  public provider: ethers.JsonRpcProvider
  public wallet: ethers.Wallet
  public contracts: OrbitContracts

  constructor(privateKey: string, rpcUrl: string = FUJI_RPC_URL) {
    // cacheTimeout:-1 disables ethers' 250ms request-dedup cache, which otherwise
    // serves a stale pending nonce for back-to-back txs (e.g. scout posts
    // updateBestProtocol then completeScoutJob) on fast chains → NONCE_EXPIRED.
    // batchMaxCount:1 sends one RPC call at a time — publicnode is load-balanced
    // and returns inconsistent nonce/mempool state when calls are batched.
    this.provider = new ethers.JsonRpcProvider(rpcUrl || FUJI_RPC_URL, undefined, {
      cacheTimeout: -1,
      batchMaxCount: 1,
    })
    this.wallet = new ethers.Wallet(privateKey, this.provider)
    this.contracts = ContractLoader.load(this.wallet)
  }

  /** Verify the provider is connected to Fuji. */
  async verifyNetwork(): Promise<void> {
    const network = await this.provider.getNetwork()
    if (network.chainId !== BigInt(FUJI_CHAIN_ID)) {
      throw new UserError(
        `Wrong network. Connected to chain ${network.chainId}, expected Fuji (${FUJI_CHAIN_ID}).\n` +
          `Check your RPC URL.`
      )
    }
  }

  /** Get AVAX and USDC balances for the wallet. */
  async getBalances(): Promise<{ avax: number; usdc: number }> {
    const [avaxRaw, usdcRaw] = await Promise.all([
      this.provider.getBalance(this.wallet.address),
      this.contracts.usdc.balanceOf(this.wallet.address),
    ])
    return {
      avax: parseFloat(ethers.formatEther(avaxRaw)),
      usdc: Number(usdcRaw) / 1e6,
    }
  }

  /** Approve USDC spend. Used before register(). */
  async approveUSDC(spender: string, amount: bigint): Promise<ethers.TransactionReceipt> {
    const tx = await this.contracts.usdc.approve(spender, amount)
    return tx.wait() as Promise<ethers.TransactionReceipt>
  }
}
