'use client'

import { useEffect, useState } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatCard } from '@/components/app/stat-card'
import { ConnectWallet } from '@/components/app/connect-wallet'
import { useVault, protocolName } from '@/lib/web3/useVault'
import { ADDRESSES, VAULT_ABI } from '@/lib/web3/contracts'
import { fmtUSDC, fmtShares, fmtAPY, numUSDC } from '@/lib/web3/format'
import { formatUnits, parseUnits } from 'viem'
import { ArrowUpFromLine, TrendingUp, Loader2, Wallet2 } from 'lucide-react'

const VAULT = ADDRESSES.YieldVault as `0x${string}`

export default function DashboardPage() {
  const { isConnected, address } = useAccount()
  const vault = useVault()

  // Principal tracked client-side per wallet (mirrors plan: "from events / client-side").
  const principal = usePrincipal(address)

  const currentValue = numUSDC(vault.userBalance)
  const yieldEarned = Math.max(0, currentValue - principal)
  const apyNum = vault.activeAPY ? Number(vault.activeAPY) / 100 : 0
  const projectedAnnual = (currentValue * apyNum) / 100

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3">
            Your Position
          </p>
          <h1 className="font-display text-5xl lg:text-6xl tracking-tight">
            Dashboard
          </h1>
        </div>
        {isConnected && (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-[#a78bfa]/30 text-[#c4b5fd] gap-1.5 py-1"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#a78bfa] shadow-[0_0_6px_#a78bfa]" />
              {protocolName(vault.activeProtocol)}
            </Badge>
            <Badge
              variant="outline"
              className="border-[#67e8f9]/30 text-[#a5f3fc] py-1"
            >
              {fmtAPY(vault.activeAPY)} APY
            </Badge>
          </div>
        )}
      </div>

      {!isConnected ? (
        <ConnectPrompt />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <StatCard
              label="Current Value"
              value={fmtUSDC(vault.userBalance)}
              sub="Principal + accrued yield"
              accent="pink"
            />
            <StatCard
              label="Principal"
              value={principal.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              sub="Net deposited (tracked locally)"
              accent="purple"
            />
            <StatCard
              label="Yield Earned"
              value={
                <span className="text-[#67e8f9]">
                  +
                  {yieldEarned.toLocaleString('en-US', {
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 4,
                  })}
                </span>
              }
              sub="Current − principal"
              accent="cyan"
            />
            <StatCard
              label="Your Shares"
              value={fmtShares(vault.userShares)}
              sub="Vault ownership units"
              accent="amber"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Position detail */}
            <div className="lg:col-span-2 rounded-xl border border-foreground/10 bg-card/60 backdrop-blur p-8">
              <h2 className="font-display text-2xl tracking-tight mb-6">
                Position detail
              </h2>
              <div className="space-y-1 divide-y divide-foreground/5">
                <DetailRow
                  label="Active protocol"
                  value={protocolName(vault.activeProtocol)}
                />
                <DetailRow label="Current APY" value={fmtAPY(vault.activeAPY)} />
                <DetailRow
                  label="Best signal"
                  value={`${protocolName(vault.bestProtocol)} · ${fmtAPY(
                    vault.bestAPY,
                  )}`}
                />
                <DetailRow
                  label="Projected annual yield"
                  value={
                    <span className="text-[#67e8f9]">
                      ~{projectedAnnual.toFixed(2)} USDC
                    </span>
                  }
                />
                <DetailRow
                  label="Vault TVL"
                  value={`${fmtUSDC(vault.vaultBalance)} USDC`}
                />
              </div>

              <div className="mt-8 flex items-center gap-3">
                <WithdrawDialog vault={vault} principalAddr={address} />
                <span className="text-xs text-muted-foreground">
                  No lock — withdraw any time.
                </span>
              </div>
            </div>

            {/* Yield card */}
            <div className="rounded-xl border border-foreground/10 bg-gradient-to-b from-card/80 to-card/40 backdrop-blur p-8 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-[#67e8f9]" />
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Yield earned
                </span>
              </div>
              <div className="font-display text-5xl tracking-tight text-[#67e8f9] tabular-nums mb-1">
                +{yieldEarned.toFixed(4)}
              </div>
              <p className="text-sm text-muted-foreground">USDC since deposit</p>

              <div className="mt-auto pt-8">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Yield accrues continuously as the active adapter compounds. The
                  withdraw flow realizes the full accrued balance for your shares.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function WithdrawDialog({
  vault,
  principalAddr,
}: {
  vault: ReturnType<typeof useVault>
  principalAddr?: string
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'all' | 'partial'>('all')
  const [shareInput, setShareInput] = useState('')
  const { writeContractAsync } = useWriteContract()
  const [busy, setBusy] = useState(false)

  const totalShares = vault.userShares ?? 0n
  const hasPosition = totalShares > 0n

  let withdrawShares = 0n
  try {
    withdrawShares =
      mode === 'all' ? totalShares : shareInput ? parseUnits(shareInput, 18) : 0n
  } catch {
    withdrawShares = 0n
  }
  const overflow = withdrawShares > totalShares
  const invalid = withdrawShares <= 0n || overflow

  // estimated USDC out = userBalance * (withdrawShares / totalShares)
  const userValue = numUSDC(vault.userBalance)
  const fraction =
    totalShares > 0n
      ? Number(formatUnits(withdrawShares, 18)) /
        Number(formatUnits(totalShares, 18))
      : 0
  const estOut = userValue * fraction

  async function handleWithdraw() {
    if (invalid) return
    setBusy(true)
    try {
      toast.info('Withdraw', { description: 'Confirm in your wallet.' })
      const hash = await writeContractAsync({
        address: VAULT,
        abi: VAULT_ABI,
        functionName: 'withdraw',
        args: [withdrawShares],
      })
      const { waitForTransactionReceipt } = await import('wagmi/actions')
      const { config } = await import('@/lib/web3/wagmi')
      await waitForTransactionReceipt(config, { hash })

      // adjust locally-tracked principal proportionally
      if (principalAddr) {
        const key = `orbit:principal:${principalAddr.toLowerCase()}`
        const prev = Number(localStorage.getItem(key) || '0')
        localStorage.setItem(key, String(Math.max(0, prev * (1 - fraction))))
        window.dispatchEvent(new Event('orbit:principal'))
      }

      toast.success('Withdrawal confirmed', {
        description: `~${estOut.toFixed(4)} USDC returned to your wallet.`,
      })
      setOpen(false)
      setShareInput('')
      vault.refetch()
    } catch (err: any) {
      toast.error('Withdrawal failed', {
        description: err?.shortMessage || err?.message || 'Rejected or reverted.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          disabled={!hasPosition}
          className="rounded-full h-11 px-6 bg-foreground text-background hover:bg-foreground/90"
        >
          <ArrowUpFromLine className="w-4 h-4" />
          Withdraw
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-tight">
            Withdraw from vault
          </DialogTitle>
          <DialogDescription>
            Redeem your shares for USDC at the current per-share value. No fees,
            no lock.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as 'all' | 'partial')}
          className="mt-2"
        >
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1">
              Withdraw all
            </TabsTrigger>
            <TabsTrigger value="partial" className="flex-1">
              Withdraw shares
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="pt-4">
            <div className="rounded-lg border border-foreground/10 bg-background/40 p-4 space-y-2 text-sm">
              <KV label="Shares" value={fmtShares(totalShares)} />
              <KV
                label="Estimated USDC out"
                value={`~${userValue.toFixed(4)}`}
                strong
              />
            </div>
          </TabsContent>

          <TabsContent value="partial" className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="shares">Shares to redeem</Label>
              <button
                type="button"
                onClick={() => setShareInput(formatUnits(totalShares, 18))}
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                MAX {fmtShares(totalShares)}
              </button>
            </div>
            <Input
              id="shares"
              inputMode="decimal"
              placeholder="0.0000"
              value={shareInput}
              onChange={(e) =>
                setShareInput(e.target.value.replace(/[^0-9.]/g, ''))
              }
              className="h-12 font-display text-lg tabular-nums"
            />
            {overflow && (
              <p className="text-xs text-destructive">
                Exceeds your share balance.
              </p>
            )}
            <div className="rounded-lg border border-foreground/10 bg-background/40 p-4">
              <KV
                label="Estimated USDC out"
                value={`~${estOut.toFixed(4)}`}
                strong
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button
            onClick={handleWithdraw}
            disabled={invalid || busy}
            className="w-full h-11 rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Withdrawing…
              </>
            ) : (
              <>
                <Wallet2 className="w-4 h-4" /> Confirm withdrawal
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function usePrincipal(address?: string): number {
  const [principal, setPrincipal] = useState(0)
  useEffect(() => {
    if (!address) {
      setPrincipal(0)
      return
    }
    const key = `orbit:principal:${address.toLowerCase()}`
    const read = () => setPrincipal(Number(localStorage.getItem(key) || '0'))
    read()
    window.addEventListener('orbit:principal', read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener('orbit:principal', read)
      window.removeEventListener('storage', read)
    }
  }, [address])
  return principal
}

function ConnectPrompt() {
  return (
    <div className="rounded-xl border border-foreground/10 bg-card/60 backdrop-blur p-12 text-center">
      <p className="text-muted-foreground mb-6">
        Connect your wallet on Avalanche Fuji to view your position.
      </p>
      <div className="flex justify-center">
        <ConnectWallet />
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-mono tabular-nums">{value}</span>
    </div>
  )
}

function KV({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono tabular-nums ${strong ? 'text-foreground' : 'text-foreground/80'}`}
      >
        {value}
      </span>
    </div>
  )
}
