'use client'

import { useEffect, useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatCard } from '@/components/app/stat-card'
import { ConnectWallet } from '@/components/app/connect-wallet'
import { useVault, protocolName } from '@/lib/web3/useVault'
import {
  ADDRESSES,
  VAULT_ABI,
  USDC_ABI,
} from '@/lib/web3/contracts'
import { fmtUSDC, fmtAPY, parseUSDC, numUSDC } from '@/lib/web3/format'
import { ArrowDownToLine, ShieldCheck, Clock, Sparkles, Loader2 } from 'lucide-react'

const VAULT = ADDRESSES.YieldVault as `0x${string}`
const USDC = ADDRESSES.USDC as `0x${string}`
const FEE_BPS = 10 // 0.10%

export default function DepositPage() {
  const { isConnected } = useAccount()
  const vault = useVault()
  const [amount, setAmount] = useState('')

  const {
    writeContractAsync,
    isPending: isWriting,
  } = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [stage, setStage] = useState<'idle' | 'approving' | 'depositing'>('idle')

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  useEffect(() => {
    if (isSuccess && stage === 'depositing') {
      // Record net principal (after 0.10% fee) for client-side yield tracking.
      if (vault.address && parsed > 0n) {
        const net = numUSDC(parsed) * (1 - FEE_BPS / 10000)
        const key = `orbit:principal:${vault.address.toLowerCase()}`
        const prev = Number(localStorage.getItem(key) || '0')
        localStorage.setItem(key, String(prev + net))
        window.dispatchEvent(new Event('orbit:principal'))
      }
      toast.success('Deposit confirmed', {
        description: 'Your USDC is now earning yield in the vault.',
      })
      setStage('idle')
      setTxHash(undefined)
      setAmount('')
      vault.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, stage])

  const parsed = (() => {
    try {
      return amount ? parseUSDC(amount) : 0n
    } catch {
      return 0n
    }
  })()

  const walletNum = numUSDC(vault.walletUSDC)
  const insufficient = parsed > (vault.walletUSDC ?? 0n)
  const invalid = parsed <= 0n || insufficient
  const busy = isWriting || isConfirming || stage !== 'idle'
  const feeAmount = numUSDC(parsed) * (FEE_BPS / 10000)

  async function handleDeposit() {
    if (invalid) return
    try {
      // Step 1: approve if needed
      if ((vault.allowance ?? 0n) < parsed) {
        setStage('approving')
        toast.info('Approve USDC', {
          description: 'Confirm the allowance in your wallet.',
        })
        const approveHash = await writeContractAsync({
          address: USDC,
          abi: USDC_ABI,
          functionName: 'approve',
          args: [VAULT, parsed],
        })
        setTxHash(approveHash)
        // wait for approval to be mined before depositing
        await waitForHash(approveHash)
        toast.success('USDC approved')
      }

      // Step 2: deposit
      setStage('depositing')
      toast.info('Deposit', {
        description: 'Confirm the deposit in your wallet.',
      })
      const depositHash = await writeContractAsync({
        address: VAULT,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [parsed],
      })
      setTxHash(depositHash)
    } catch (err: any) {
      setStage('idle')
      setTxHash(undefined)
      toast.error('Transaction failed', {
        description: err?.shortMessage || err?.message || 'Rejected or reverted.',
      })
    }
  }

  return (
    <div className="space-y-10">
      <Header />

      {!isConnected ? (
        <ConnectPrompt />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <StatCard
              label="Wallet USDC"
              value={fmtUSDC(vault.walletUSDC)}
              sub="Available to deposit"
              accent="cyan"
            />
            <StatCard
              label="Vault TVL"
              value={fmtUSDC(vault.vaultBalance)}
              sub={`Active: ${protocolName(vault.activeProtocol)} · ${fmtAPY(
                vault.activeAPY,
              )} APY`}
              accent="purple"
            />
            <StatCard
              label="Your Position"
              value={fmtUSDC(vault.userBalance)}
              sub="Current value (principal + yield)"
              accent="pink"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Deposit form */}
            <div className="lg:col-span-3 rounded-xl border border-foreground/10 bg-card/60 backdrop-blur p-8">
              <h2 className="font-display text-2xl tracking-tight mb-1">
                Deposit USDC
              </h2>
              <p className="text-sm text-muted-foreground mb-8">
                Competing agents route your deposit to the best on-chain yield.
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="amount">Amount</Label>
                  <button
                    type="button"
                    onClick={() => setAmount(walletNum ? String(walletNum) : '')}
                    className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    MAX {fmtUSDC(vault.walletUSDC)}
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="h-14 text-2xl font-display tabular-nums pr-20"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                    USDC
                  </span>
                </div>
                {insufficient && (
                  <p className="text-xs text-destructive">
                    Insufficient wallet balance.
                  </p>
                )}
              </div>

              {parsed > 0n && (
                <div className="mt-6 space-y-2 rounded-lg border border-foreground/10 bg-background/40 p-4 text-sm">
                  <Row
                    label="Protocol fee (0.10%)"
                    value={`-${feeAmount.toFixed(4)} USDC`}
                  />
                  <Row
                    label="Net deposited"
                    value={`${(numUSDC(parsed) - feeAmount).toFixed(4)} USDC`}
                    strong
                  />
                </div>
              )}

              <Button
                onClick={handleDeposit}
                disabled={invalid || busy}
                className="mt-8 w-full h-12 rounded-full bg-foreground text-background hover:bg-foreground/90 text-base"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {stage === 'approving'
                      ? 'Approving USDC…'
                      : stage === 'depositing'
                        ? 'Depositing…'
                        : 'Confirming…'}
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="w-4 h-4" />
                    Approve &amp; Deposit
                  </>
                )}
              </Button>
            </div>

            {/* Explainer */}
            <div className="lg:col-span-2 space-y-4">
              <Explainer
                icon={<Sparkles className="w-4 h-4 text-[#fbbf24]" />}
                title="How yield is generated"
                body="Your USDC is deployed to the active adapter. On Aave V3, the adapter's aUSDC balance compounds block-by-block — that growth is your yield. On withdraw, the vault realizes the full accrued balance."
              />
              <Explainer
                icon={<Clock className="w-4 h-4 text-[#67e8f9]" />}
                title="No lock period"
                body="Withdraw any time. YieldVault.withdraw() has no time gate — your position is always liquid."
              />
              <Explainer
                icon={<ShieldCheck className="w-4 h-4 text-[#a78bfa]" />}
                title="0.10% protocol fee"
                body="A flat 0.10% fee on deposit funds the FeePool that pays the competing scout and executor agents. No management or withdrawal fees."
              />
            </div>
          </div>
        </>
      )}
    </div>
  )

  // local helper to await a tx receipt via polling the public client
  async function waitForHash(hash: `0x${string}`) {
    const { waitForTransactionReceipt } = await import('wagmi/actions')
    const { config } = await import('@/lib/web3/wagmi')
    await waitForTransactionReceipt(config, { hash })
  }
}

function Header() {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3">
        Vault · Avalanche Fuji
      </p>
      <h1 className="font-display text-5xl lg:text-6xl tracking-tight leading-[0.95]">
        Put your USDC
        <br />
        <span className="word-gradient">to work.</span>
      </h1>
    </div>
  )
}

function ConnectPrompt() {
  return (
    <div className="rounded-xl border border-foreground/10 bg-card/60 backdrop-blur p-12 text-center">
      <p className="text-muted-foreground mb-6">
        Connect your wallet on Avalanche Fuji to deposit.
      </p>
      <div className="flex justify-center">
        <ConnectWallet />
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono tabular-nums ${strong ? 'text-foreground' : 'text-foreground/80'}`}
      >
        {value}
      </span>
    </div>
  )
}

function Explainer({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="hover-lift rounded-xl border border-foreground/10 bg-card/40 backdrop-blur p-5">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  )
}
