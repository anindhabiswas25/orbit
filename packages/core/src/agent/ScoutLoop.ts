import { ChainClient } from '../chain/ChainClient'
import { AgentRunCallbacks } from '../types'
import { FUJI_ADDRESSES } from '../chain/FujiAddresses'
import { withRetry } from '../utils/retry'

const GAS_PENALTY_BPS = 5 // Effective APY = raw APY - 5 bps (gas cost adjustment)

interface AdapterResult {
  name: string
  address: string
  apy: number
  effectiveAPY: number
}

function ts(): string {
  return new Date().toLocaleTimeString()
}

/**
 * ScoutLoop — reads APYs from every adapter, picks the highest effective APY,
 * posts it to YieldRegistry, then confirms completion to the engine.
 */
export class ScoutLoop {
  static async execute(
    jobId: number,
    client: ChainClient,
    callbacks: AgentRunCallbacks
  ): Promise<void> {
    const startMs = Date.now()
    const { adapters, yieldReg, engine } = client.contracts

    // ─── Step 1: Read APY from all adapters ──────────────────────────────────
    callbacks.onLog?.(`[${ts()}] Job #${jobId} — reading APYs from all adapters`)

    const adapterEntries = [
      { name: 'AAVE V3', addr: FUJI_ADDRESSES.AaveAdapter, contract: adapters.aave },
      { name: 'Benqi', addr: FUJI_ADDRESSES.BenqiAdapter, contract: adapters.benqi },
      { name: 'MockPoolA', addr: FUJI_ADDRESSES.MockPoolA, contract: adapters.mockA },
      { name: 'MockPoolB', addr: FUJI_ADDRESSES.MockPoolB, contract: adapters.mockB },
    ]

    const results: AdapterResult[] = []

    for (const entry of adapterEntries) {
      try {
        const rawAPY = await withRetry(() => entry.contract.getAPY(), {
          maxAttempts: 3,
          baseDelayMs: 500,
          label: `getAPY(${entry.name})`,
        })
        const apy = Number(rawAPY)
        const effectiveAPY = Math.max(0, apy - GAS_PENALTY_BPS)
        callbacks.onLog?.(`[${ts()}]   ${entry.name}: ${(apy / 100).toFixed(2)}%`)
        results.push({ name: entry.name, address: entry.addr, apy, effectiveAPY })
      } catch (err: any) {
        callbacks.onLog?.(`[${ts()}]   ${entry.name}: unavailable (${err.message})`)
        // Protocol unavailable — exclude from selection (never throw here).
      }
    }

    const active = results.filter((r) => r.apy > 0)
    if (active.length === 0) {
      throw new Error('No adapters returned APY > 0. Cannot complete scout job.')
    }

    // ─── Step 2: Select winner ───────────────────────────────────────────────
    active.sort((a, b) => b.effectiveAPY - a.effectiveAPY)
    const winner = active[0]!

    callbacks.onLog?.(`[${ts()}] Winner: ${winner.name} @ ${(winner.apy / 100).toFixed(2)}%`)

    // ─── Step 3: Post to YieldRegistry ───────────────────────────────────────
    const regTx = await withRetry(() => yieldReg.updateBestProtocol(winner.address, winner.apy), {
      maxAttempts: 2,
      baseDelayMs: 1000,
      label: 'updateBestProtocol',
    })
    const regReceipt = await regTx.wait()
    callbacks.onLog?.(`[${ts()}] YieldRegistry updated — tx: ${regReceipt.hash.slice(0, 12)}...`)

    // ─── Step 4: Complete job ────────────────────────────────────────────────
    const completeTx = await withRetry(() => engine.completeScoutJob(jobId), {
      maxAttempts: 2,
      baseDelayMs: 1000,
      label: 'completeScoutJob',
    })
    const completeReceipt = await completeTx.wait()

    const elapsedMs = Date.now() - startMs
    callbacks.onJobCompleted?.({ jobId, type: 'Scout', payment: 0.0004, elapsedMs })
    callbacks.onLog?.(
      `[${ts()}] Job #${jobId} complete ✓ (${elapsedMs}ms) tx: ${completeReceipt.hash.slice(0, 12)}...`
    )
  }
}
