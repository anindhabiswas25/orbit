import { ethers } from 'ethers'
import { ChainClient } from '../chain/ChainClient'
import { FUJI_ADDRESSES } from '../chain/FujiAddresses'
import { AgentType } from '../types'
import { ChainError } from '../errors'

const MIN_STAKE = ethers.parseUnits('5', 6) // 5 USDC
const AGENT_TYPE_MAP = { scout: 0, executor: 1 } as const

export interface RegisterParams {
  type: AgentType
  endpoint: string
  fee: number // basis points
  developerWallet: string
}

export interface RegisterResult {
  approveTx: string
  registerTx: string
  wallet: string
}

export interface ImportResult {
  wallet: string
  type: AgentType
  reputation: number
  status: string
  stake: number
  jobsCompleted: number
}

const TYPE_MAP: Record<number, AgentType> = { 0: 'scout', 1: 'executor' }
const STATUS_MAP: Record<number, string> = {
  0: 'active',
  1: 'paused',
  2: 'deregistered',
  3: 'banned',
}

export class Registrar {
  /**
   * Execute on-chain agent registration.
   *   Step 1: approve AgentRegistry to spend 5 USDC
   *   Step 2: call AgentRegistry.register()
   * Both steps emit progress via onStep so the UI can update.
   */
  static async register(
    client: ChainClient,
    params: RegisterParams,
    onStep?: (step: 'approving' | 'registering' | 'done', txHash?: string) => void
  ): Promise<RegisterResult> {
    try {
      let approveHash = ''
      if (params.type === 'executor') {
        onStep?.('approving')
        const approveTx = await client.contracts.usdc.approve(FUJI_ADDRESSES.AgentRegistry, MIN_STAKE)
        const approveReceipt = await approveTx.wait()
        approveHash = approveReceipt.hash
      }

      onStep?.('registering', approveHash || undefined)
      const registerTx = await client.contracts.registry.register(
        AGENT_TYPE_MAP[params.type],
        params.endpoint,
        params.type === 'scout' ? 0 : params.fee,
        params.developerWallet
      )
      const registerReceipt = await registerTx.wait()
      onStep?.('done', registerReceipt.hash)

      return {
        approveTx: approveHash,
        registerTx: registerReceipt.hash,
        wallet: client.wallet.address,
      }
    } catch (err: any) {
      throw new ChainError(err.shortMessage || err.reason || err.message, err.transactionHash)
    }
  }

  /**
   * Verify an existing wallet is registered and return its current on-chain status.
   * Used by orbit import to validate before saving credentials.
   */
  static async verifyExisting(client: ChainClient): Promise<ImportResult> {
    const raw = await client.contracts.registry.getAgent(client.wallet.address)

    if (!raw.wallet || raw.wallet === ethers.ZeroAddress) {
      throw new ChainError(
        `Wallet ${client.wallet.address} is not registered on Orbit.\n` +
          `Run orbit setup to register a new agent.`
      )
    }

    return {
      wallet: raw.wallet,
      type: TYPE_MAP[Number(raw.agentType)]!,
      reputation: Number(raw.reputationScore),
      status: STATUS_MAP[Number(raw.status)]!,
      stake: Number(raw.stake) / 1e6,
      jobsCompleted: Number(raw.jobsCompleted),
    }
  }

  /** True if the wallet is already authorized to post results to YieldRegistry. */
  static async isScoutAuthorized(client: ChainClient, wallet?: string): Promise<boolean> {
    return client.contracts.yieldReg.authorizedAgents(wallet ?? client.wallet.address)
  }

  /**
   * Authorize a scout in YieldRegistry so it can call updateBestProtocol().
   * This is an owner-only action, so it must be signed with the registry owner
   * key — NOT the scout's own key. Returns the tx hash, or null if already
   * authorized.
   * @throws ChainError if the provided key is not the registry owner.
   */
  static async authorizeScout(
    ownerPrivateKey: string,
    scoutWallet: string,
    rpcUrl?: string
  ): Promise<string | null> {
    try {
      const owner = new ChainClient(ownerPrivateKey, rpcUrl)
      const yieldReg = owner.contracts.yieldReg

      const already = await yieldReg.authorizedAgents(scoutWallet)
      if (already) return null

      const registryOwner: string = await yieldReg.owner()
      if (registryOwner.toLowerCase() !== owner.wallet.address.toLowerCase()) {
        throw new ChainError(
          `The provided owner key (${owner.wallet.address}) is not the YieldRegistry owner ` +
            `(${registryOwner}). Scout authorization must be signed by the owner.`
        )
      }

      const tx = await yieldReg.authorizeAgent(scoutWallet)
      const receipt = await tx.wait()
      return receipt.hash
    } catch (err: any) {
      if (err instanceof ChainError) throw err
      throw new ChainError(err.shortMessage || err.reason || err.message, err.transactionHash)
    }
  }

  /** Deregister agent on-chain and reclaim stake if reputation >= 0. */
  static async deregister(
    client: ChainClient,
    onStep?: (step: 'deregistering' | 'done', txHash?: string) => void
  ): Promise<string> {
    try {
      onStep?.('deregistering')
      const tx = await client.contracts.registry.deregister()
      const receipt = await tx.wait()
      onStep?.('done', receipt.hash)
      return receipt.hash
    } catch (err: any) {
      throw new ChainError(err.shortMessage || err.reason || err.message, err.transactionHash)
    }
  }
}
