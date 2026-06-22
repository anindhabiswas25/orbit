'use client'

import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import {
  ADDRESSES,
  VAULT_ABI,
  USDC_ABI,
  REGISTRY_ABI,
} from './contracts'

const VAULT = ADDRESSES.YieldVault as `0x${string}`
const USDC = ADDRESSES.USDC as `0x${string}`
const REGISTRY = ADDRESSES.YieldRegistry as `0x${string}`

/** Reads the connected user's position + global vault/registry state. */
export function useVault() {
  const { address } = useAccount()

  const userQueries = useReadContracts({
    allowFailure: true,
    query: { enabled: !!address, refetchInterval: 12_000 },
    contracts: [
      {
        address: USDC,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [address ?? '0x0000000000000000000000000000000000000000'],
      },
      {
        address: USDC,
        abi: USDC_ABI,
        functionName: 'allowance',
        args: [
          address ?? '0x0000000000000000000000000000000000000000',
          VAULT,
        ],
      },
      {
        address: VAULT,
        abi: VAULT_ABI,
        functionName: 'getUserBalance',
        args: [address ?? '0x0000000000000000000000000000000000000000'],
      },
      {
        address: VAULT,
        abi: VAULT_ABI,
        functionName: 'getUserShares',
        args: [address ?? '0x0000000000000000000000000000000000000000'],
      },
    ],
  })

  const globalQueries = useReadContracts({
    allowFailure: true,
    query: { refetchInterval: 12_000 },
    contracts: [
      { address: VAULT, abi: VAULT_ABI, functionName: 'getVaultBalance' },
      { address: REGISTRY, abi: REGISTRY_ABI, functionName: 'activeProtocol' },
      { address: REGISTRY, abi: REGISTRY_ABI, functionName: 'activeAPY' },
      { address: REGISTRY, abi: REGISTRY_ABI, functionName: 'bestProtocol' },
      { address: REGISTRY, abi: REGISTRY_ABI, functionName: 'bestAPY' },
    ],
  })

  const u = userQueries.data
  const g = globalQueries.data

  return {
    address,
    walletUSDC: u?.[0]?.result as bigint | undefined,
    allowance: u?.[1]?.result as bigint | undefined,
    userBalance: u?.[2]?.result as bigint | undefined,
    userShares: u?.[3]?.result as bigint | undefined,
    vaultBalance: g?.[0]?.result as bigint | undefined,
    activeProtocol: g?.[1]?.result as string | undefined,
    activeAPY: g?.[2]?.result as bigint | undefined,
    bestProtocol: g?.[3]?.result as string | undefined,
    bestAPY: g?.[4]?.result as bigint | undefined,
    isLoading: userQueries.isLoading || globalQueries.isLoading,
    refetch: () => {
      userQueries.refetch()
      globalQueries.refetch()
    },
  }
}

/** Maps a protocol address to a friendly name. */
export function protocolName(addr?: string): string {
  if (!addr) return 'Unknown'
  const a = addr.toLowerCase()
  if (a === ADDRESSES.AaveAdapter.toLowerCase()) return 'Aave V3'
  if (a === ADDRESSES.BenqiAdapter.toLowerCase()) return 'Benqi'
  if (a === ADDRESSES.MockPoolA.toLowerCase()) return 'Mock Pool A'
  if (a === ADDRESSES.MockPoolB.toLowerCase()) return 'Mock Pool B'
  if (a === '0x0000000000000000000000000000000000000000') return 'Idle'
  return 'Adapter'
}
