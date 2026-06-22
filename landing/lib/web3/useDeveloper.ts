'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from 'wagmi'
import { api, type Agent } from './api'
import {
  ADDRESSES,
  PAYMENT_LEDGER_ABI,
  AGENT_REGISTRY_ABI,
  USDC_ABI,
} from './contracts'

const LEDGER = ADDRESSES.PaymentLedger as `0x${string}`
const REGISTRY = ADDRESSES.AgentRegistry as `0x${string}`
const USDC = ADDRESSES.USDC as `0x${string}`

const sameAddr = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()

/* --------------------------------------------------------------------------
 * Agents owned by the connected developer wallet.
 * The backend already returns `developerWallet` on every agent, so ownership
 * is a client-side filter. Returns the full set too (for the leaderboard).
 * ------------------------------------------------------------------------ */
export function useDeveloperAgents() {
  const { address } = useAccount()
  const [all, setAll] = useState<Agent[]>([])
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const a = await api.agents()
      setAll(a)
      setOffline(false)
    } catch {
      setOffline(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 10_000)
    return () => clearInterval(t)
  }, [refresh])

  const mine = useMemo(
    () => all.filter((a) => sameAddr(a.developerWallet, address)),
    [all, address],
  )

  return {
    address,
    all,
    mine,
    scouts: all.filter((a) => a.type === 'Scout'),
    executors: all.filter((a) => a.type === 'Executor'),
    myWallets: useMemo(
      () => new Set(mine.map((a) => a.wallet.toLowerCase())),
      [mine],
    ),
    offline,
    loading,
    refresh,
  }
}

/* --------------------------------------------------------------------------
 * On-chain earnings for the connected developer wallet, read from PaymentLedger.
 * There is no per-dev index on-chain, so we read every settled job id and
 * filter by devWallet client-side. paymentTxHash gives the payout tx link.
 * ------------------------------------------------------------------------ */
export interface Settlement {
  jobId: number
  agentWallet: string
  devWallet: string
  amount: bigint
  paymentTxHash: string
  settledAt: number
  llmReasoning: string
  agentType: number
}

export function useDeveloperEarnings() {
  const { address } = useAccount()

  const totalQuery = useReadContract({
    address: LEDGER,
    abi: PAYMENT_LEDGER_ABI,
    functionName: 'getTotalEarnedBy',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!address, refetchInterval: 15_000 },
  })

  const countQuery = useReadContract({
    address: LEDGER,
    abi: PAYMENT_LEDGER_ABI,
    functionName: 'getTotalSettled',
    query: { refetchInterval: 15_000 },
  })

  const total = (totalQuery.data as bigint | undefined) ?? 0n
  const totalSettled = Number((countQuery.data as bigint | undefined) ?? 0n)

  // PaymentLedger keys settlements by jobId, and job ids are sparse (40, 60,
  // 165, …) — NOT a 0..n index. So first read the list of settled job ids, then
  // fetch each settlement by its real id. (Indexing by position returns empty
  // zero-structs, which is why the payouts table previously rendered blank.)
  const idsQuery = useReadContract({
    address: LEDGER,
    abi: PAYMENT_LEDGER_ABI,
    functionName: 'getSettledJobIds',
    args: [0n, BigInt(totalSettled)],
    query: { enabled: totalSettled > 0, refetchInterval: 15_000 },
  })
  const jobIds = useMemo(
    () => [...((idsQuery.data as readonly bigint[] | undefined) ?? [])],
    [idsQuery.data],
  )

  // Fan out getSettlement(jobId) for every settled job, then filter to mine.
  const settlementCalls = useMemo(
    () =>
      jobIds.map((id) => ({
        address: LEDGER,
        abi: PAYMENT_LEDGER_ABI,
        functionName: 'getSettlement' as const,
        args: [id] as const,
      })),
    [jobIds],
  )

  const settlementsQuery = useReadContracts({
    allowFailure: true,
    contracts: settlementCalls,
    query: { enabled: jobIds.length > 0, refetchInterval: 15_000 },
  })

  const mine: Settlement[] = useMemo(() => {
    const rows = (settlementsQuery.data ?? [])
      .map((r) => r.result as unknown)
      .filter(Boolean)
      .map((s: any) => ({
        jobId: Number(s.jobId),
        agentWallet: s.agentWallet as string,
        devWallet: s.devWallet as string,
        amount: s.amount as bigint,
        paymentTxHash: s.paymentTxHash as string,
        settledAt: Number(s.settledAt) * 1000,
        llmReasoning: s.llmReasoning as string,
        agentType: Number(s.agentType),
      }))
      .filter((s) => sameAddr(s.devWallet, address))
    rows.sort((a, b) => b.settledAt - a.settledAt)
    return rows
  }, [settlementsQuery.data, address])

  return {
    address,
    total, // bigint, 6-decimal USDC — all-time earned by this dev
    totalSettled, // global count of settled jobs (whole protocol)
    settlements: mine,
    loading:
      totalQuery.isLoading ||
      countQuery.isLoading ||
      idsQuery.isLoading ||
      settlementsQuery.isLoading,
  }
}

/* --------------------------------------------------------------------------
 * In-browser agent registration. Executors must approve MIN_STAKE USDC to the
 * AgentRegistry before register() (Scouts need no stake). Mirrors the
 * approve→write flow used on the Deposit page.
 * ------------------------------------------------------------------------ */
export type RegisterStage =
  | 'idle'
  | 'approving'
  | 'registering'
  | 'success'
  | 'error'

export const MIN_STAKE = 5_000_000n // 5 USDC (6 decimals); mirrors AgentRegistry.MIN_STAKE
export const MAX_FEE_BPS = 500

export function useRegisterAgent() {
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const [stage, setStage] = useState<RegisterStage>('idle')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [error, setError] = useState<string | null>(null)

  const allowanceQuery = useReadContract({
    address: USDC,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: [
      address ?? '0x0000000000000000000000000000000000000000',
      REGISTRY,
    ],
    query: { enabled: !!address },
  })

  async function waitForHash(hash: `0x${string}`) {
    const { waitForTransactionReceipt } = await import('wagmi/actions')
    const { config } = await import('@/lib/web3/wagmi')
    await waitForTransactionReceipt(config, { hash })
  }

  const register = useCallback(
    async (params: {
      isExecutor: boolean
      endpoint: string
      feeBps: number
      developerWallet: string
    }) => {
      setError(null)
      setTxHash(undefined)
      try {
        if (params.isExecutor) {
          const allowance = (allowanceQuery.data as bigint | undefined) ?? 0n
          if (allowance < MIN_STAKE) {
            setStage('approving')
            const approveHash = await writeContractAsync({
              address: USDC,
              abi: USDC_ABI,
              functionName: 'approve',
              args: [REGISTRY, MIN_STAKE],
            })
            await waitForHash(approveHash)
          }
        }

        setStage('registering')
        const regHash = await writeContractAsync({
          address: REGISTRY,
          abi: AGENT_REGISTRY_ABI,
          functionName: 'register',
          args: [
            params.isExecutor ? 1 : 0,
            params.endpoint,
            BigInt(params.isExecutor ? params.feeBps : 0),
            params.developerWallet as `0x${string}`,
          ],
        })
        setTxHash(regHash)
        await waitForHash(regHash)
        setStage('success')
      } catch (err: any) {
        setError(err?.shortMessage || err?.message || 'Rejected or reverted.')
        setStage('error')
      }
    },
    [allowanceQuery.data, writeContractAsync],
  )

  return { register, stage, txHash, error, reset: () => setStage('idle') }
}
