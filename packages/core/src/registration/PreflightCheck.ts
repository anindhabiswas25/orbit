import { ChainClient } from '../chain/ChainClient'
import { FUJI_FAUCET_AVAX, FUJI_FAUCET_USDC } from '../chain/FujiAddresses'
import { ethers } from 'ethers'

const MIN_AVAX_FOR_GAS = 0.05
const MIN_USDC_FOR_STAKE = 5.0

export interface PreflightResult {
  ok: boolean
  wallet: string
  avax: number
  usdc: number
  errors: string[]
  warnings: string[]
}

export class PreflightCheck {
  static async run(client: ChainClient, agentName?: string, agentType?: 'scout' | 'executor'): Promise<PreflightResult> {
    const result: PreflightResult = {
      ok: true,
      wallet: client.wallet.address,
      avax: 0,
      usdc: 0,
      errors: [],
      warnings: [],
    }

    // Check network first
    try {
      await client.verifyNetwork()
    } catch (err: any) {
      result.errors.push(err.message)
      result.ok = false
      return result // No point checking balances on the wrong network
    }

    // Check balances
    const { avax, usdc } = await client.getBalances()
    result.avax = avax
    result.usdc = usdc

    if (avax < MIN_AVAX_FOR_GAS) {
      result.errors.push(
        `Insufficient AVAX for gas. Have ${avax.toFixed(4)} AVAX, need >= ${MIN_AVAX_FOR_GAS}.\n` +
          `Get free testnet AVAX: ${FUJI_FAUCET_AVAX}`
      )
      result.ok = false
    } else if (avax < 0.1) {
      result.warnings.push(
        `Low AVAX balance (${avax.toFixed(4)}). Top up soon to avoid gas failures.`
      )
    }

    if (agentType !== 'scout' && usdc < MIN_USDC_FOR_STAKE) {
      result.errors.push(
        `Insufficient USDC for stake. Have ${usdc.toFixed(2)} USDC, need >= 5.00.\n` +
          `Get free testnet USDC: ${FUJI_FAUCET_USDC}`
      )
      result.ok = false
    }

    // Check if already registered
    if (agentName) {
      try {
        const agent = await client.contracts.registry.getAgent(client.wallet.address)
        if (agent.wallet && agent.wallet !== ethers.ZeroAddress) {
          result.errors.push(
            `Wallet ${client.wallet.address} is already registered as an agent.\n` +
              `Use orbit import to load an existing registration, or use a different wallet.`
          )
          result.ok = false
        }
      } catch {
        /* registry call failed — non-fatal for preflight */
      }
    }

    return result
  }
}
