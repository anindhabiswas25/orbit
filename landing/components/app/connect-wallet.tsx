'use client'

import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { Button } from '@/components/ui/button'
import { FUJI_CHAIN_ID } from '@/lib/web3/wagmi'
import { Wallet, AlertTriangle, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Wallet connect / disconnect button. Styled to match the landing navbar's
 * "Launch app" pill: white pill at the top of the page, compact foreground pill
 * once the nav has scrolled into its glass state.
 */
export function ConnectWallet({ isScrolled = true }: { isScrolled?: boolean }) {
  const { address, isConnected, chainId } = useAccount()
  const { connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  // Mirrors the landing "Launch app" button styling exactly.
  const pill = cn(
    'rounded-full transition-all duration-500',
    isScrolled
      ? 'bg-foreground hover:bg-foreground/90 text-background px-4 h-8 text-xs'
      : 'bg-white hover:bg-white/90 text-black px-6 h-9 text-sm',
  )

  if (!isConnected) {
    return (
      <Button onClick={() => connect({ connector: injected() })} disabled={isPending} className={pill}>
        <Wallet className={isScrolled ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        {isPending ? 'Connecting…' : 'Connect Wallet'}
      </Button>
    )
  }

  if (chainId !== FUJI_CHAIN_ID) {
    return (
      <Button
        onClick={() => switchChain({ chainId: FUJI_CHAIN_ID })}
        disabled={isSwitching}
        className={cn(
          'rounded-full transition-all duration-500 bg-amber-400 hover:bg-amber-400/90 text-black',
          isScrolled ? 'h-8 px-4 text-xs' : 'h-9 px-6 text-sm',
        )}
      >
        <AlertTriangle className={isScrolled ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
        {isSwitching ? 'Switching…' : 'Switch to Fuji'}
      </Button>
    )
  }

  // Connected: a "Disconnect" pill (launch-app style); click disconnects.
  return (
    <Button onClick={() => disconnect()} className={pill} title={address}>
      <LogOut className={isScrolled ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      Disconnect
    </Button>
  )
}
