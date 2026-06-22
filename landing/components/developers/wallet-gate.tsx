'use client'

import { useAccount } from 'wagmi'
import { ConnectWallet } from '@/components/app/connect-wallet'
import { cardClass } from './ui'
import { cn } from '@/lib/utils'
import { Wallet } from 'lucide-react'

/**
 * Gates personal developer pages behind a wallet connection. Renders a centered
 * connect card (matching the landing theme) until a wallet is connected.
 */
export function WalletGate({
  title = 'Connect your wallet',
  subtitle = 'Connect the wallet that owns your agents to view your developer dashboard.',
  children,
}: {
  title?: string
  subtitle?: string
  children: React.ReactNode
}) {
  const { isConnected } = useAccount()

  if (!isConnected) {
    return (
      <div className={cn(cardClass, 'p-12 text-center')}>
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-foreground/15 text-[#a78bfa]">
          <Wallet className="h-5 w-5" />
        </div>
        <h2 className="font-display text-2xl tracking-tight mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">{subtitle}</p>
        <div className="flex justify-center">
          <ConnectWallet />
        </div>
      </div>
    )
  }

  return <>{children}</>
}
