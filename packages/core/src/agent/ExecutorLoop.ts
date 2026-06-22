import { ethers } from 'ethers'
import { ChainClient } from '../chain/ChainClient'
import { AgentRunCallbacks, RebalanceEvent } from '../types'
import { ADAPTER_NAMES } from '../chain/FujiAddresses'
import { withRetry } from '../utils/retry'

const DEFAULT_THRESHOLD_BPS = 200 // 2% spread required to rebalance

function ts(): string {
  return new Date().toLocaleTimeString()
}

/**
 * ExecutorLoop — reads best vs. active protocol from YieldRegistry and either
 * rebalances or completes as a no-op.
 *
 * IMPORTANT: the agent never calls vault.rebalance() or yieldReg.logRebalance()
 * directly — those are engine-only. The engine performs the rebalance + log + pay
 * atomically inside completeExecutorJob(jobId, newAdapter). When no rebalance is
 * warranted the agent calls completeExecutorJobNoOp(jobId).
 */
export class ExecutorLoop {
  static async execute(
    jobId: number,
    client: ChainClient,
    callbacks: AgentRunCallbacks
  ): Promise<void> {
    const startMs = Date.now()
    const { yieldReg, vault, engine } = client.contracts

    // ─── Step 1: Read state from chain ───────────────────────────────────────
    const [bestProtocol, bestAPYRaw, activeProtocol, activeAPYRaw, vaultBalance] = await Promise.all(
      [
        yieldReg.bestProtocol(),
        yieldReg.bestAPY(),
        yieldReg.activeProtocol(),
        yieldReg.activeAPY(),
        vault.getVaultBalance().catch(() => 0n),
      ]
    )

    const bestAPY = Number(bestAPYRaw)
    const currentAPY = Number(activeAPYRaw)
    const spread = bestAPY - currentAPY
    const isFirst = activeProtocol === ethers.ZeroAddress
    const alreadyOnBest =
      !isFirst && (bestProtocol as string).toLowerCase() === (activeProtocol as string).toLowerCase()

    callbacks.onLog?.(
      `[${ts()}] Job #${jobId} — spread: ${(spread / 100).toFixed(2)}% | best: ` +
        `${ADAPTER_NAMES[(bestProtocol as string)?.toLowerCase()] ?? 'unknown'}`
    )

    // ─── Step 2: Decide ──────────────────────────────────────────────────────
    const completeNoOp = async (reason: string) => {
      callbacks.onLog?.(`[${ts()}] ${reason} — completing as no-op`)
      const tx = await withRetry(() => engine.completeExecutorJobNoOp(jobId), {
        maxAttempts: 2,
        baseDelayMs: 1000,
        label: 'completeExecutorJobNoOp',
      })
      await tx.wait()
      callbacks.onJobCompleted?.({
        jobId,
        type: 'Executor',
        payment: 0.0004,
        elapsedMs: Date.now() - startMs,
      })
    }

    if (alreadyOnBest) {
      await completeNoOp('Already on best protocol')
      return
    }
    if (!isFirst && spread < DEFAULT_THRESHOLD_BPS) {
      await completeNoOp(`Spread ${(spread / 100).toFixed(2)}% below threshold`)
      return
    }

    // ─── Step 3: Rebalance (engine does it atomically) ───────────────────────
    callbacks.onLog?.(
      `[${ts()}] Rebalancing: ${ADAPTER_NAMES[(activeProtocol as string)?.toLowerCase()] ?? 'none'} ` +
        `→ ${ADAPTER_NAMES[(bestProtocol as string)?.toLowerCase()] ?? bestProtocol}`
    )

    const completeTx = await withRetry(() => engine.completeExecutorJob(jobId, bestProtocol), {
      maxAttempts: 2,
      baseDelayMs: 2000,
      label: 'completeExecutorJob',
    })
    const completeReceipt = await completeTx.wait()

    const rebalanceEv: RebalanceEvent = {
      fromProtocol: activeProtocol,
      fromName: ADAPTER_NAMES[(activeProtocol as string)?.toLowerCase()] ?? 'none',
      toProtocol: bestProtocol,
      toName: ADAPTER_NAMES[(bestProtocol as string)?.toLowerCase()] ?? 'unknown',
      fromAPY: currentAPY,
      toAPY: bestAPY,
      gain: spread,
      gainFormatted: `+${(spread / 100).toFixed(2)}%`,
      amount: Number(vaultBalance) / 1e6,
      timestamp: new Date(),
      executorAgent: client.wallet.address,
    }

    callbacks.onRebalance?.(rebalanceEv)
    callbacks.onJobCompleted?.({
      jobId,
      type: 'Executor',
      payment: 0.0004,
      elapsedMs: Date.now() - startMs,
    })
    callbacks.onLog?.(
      `[${ts()}] Rebalance complete ✓ gain: ${rebalanceEv.gainFormatted} ` +
        `tx: ${completeReceipt.hash.slice(0, 12)}...`
    )
  }
}
