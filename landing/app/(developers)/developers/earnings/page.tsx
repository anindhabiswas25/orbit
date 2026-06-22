'use client'

import { useMemo } from 'react'
import { useDeveloperEarnings } from '@/lib/web3/useDeveloper'
import { fmtUSDC, numUSDC } from '@/lib/web3/format'
import {
  Stat,
  AddrLink,
  TxLink,
  SectionHeading,
  cardClass,
} from '@/components/developers/ui'
import { WalletGate } from '@/components/developers/wallet-gate'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Coins, Receipt, Wallet, Inbox } from 'lucide-react'

export default function EarningsPage() {
  const { total, settlements, totalSettled, loading } = useDeveloperEarnings()

  const avg = settlements.length
    ? numUSDC(total) / settlements.length
    : 0

  // Per-agent breakdown.
  const byAgent = useMemo(() => {
    const m = new Map<string, { wallet: string; total: bigint; count: number }>()
    for (const s of settlements) {
      const k = s.agentWallet.toLowerCase()
      const cur = m.get(k) ?? { wallet: s.agentWallet, total: 0n, count: 0 }
      cur.total += s.amount
      cur.count += 1
      m.set(k, cur)
    }
    return [...m.values()].sort((a, b) => (b.total > a.total ? 1 : -1))
  }, [settlements])

  return (
    <div className="space-y-12">
      <SectionHeading
        eyebrow="Earnings · on-chain payout ledger"
        title="Earnings"
      />

      <WalletGate subtitle="Connect the wallet that owns your agents to view its on-chain earnings.">
        {/* Headline stats */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat icon={<Coins className="w-4 h-4" />} label="Total earned" value={fmtUSDC(total)} unit="USDC" accent="amber" />
          <Stat icon={<Receipt className="w-4 h-4" />} label="Your payouts" value={String(settlements.length)} sub="settled jobs" accent="cyan" />
          <Stat icon={<Coins className="w-4 h-4" />} label="Avg / payout" value={avg.toFixed(4)} unit="USDC" accent="purple" />
          <Stat icon={<Receipt className="w-4 h-4" />} label="Protocol payouts" value={String(totalSettled)} sub="all agents" accent="pink" />
        </section>

        {/* Recent payouts */}
        <section className={cn(cardClass, 'mt-12 p-6')}>
          <div className="flex items-center gap-2 mb-5">
            <Receipt className="w-4 h-4 text-[#fbbf24]" />
            <h2 className="font-display text-lg tracking-tight">Recent payouts</h2>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {settlements.length} settlements
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-6">Reading PaymentLedger…</p>
          ) : settlements.length === 0 ? (
            <div className="py-12 text-center">
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-foreground/15 text-muted-foreground">
                <Inbox className="h-5 w-5" />
              </div>
              <p className="text-muted-foreground mb-1">No settled payouts yet.</p>
              <p className="text-sm text-muted-foreground/70 max-w-md mx-auto">
                Earnings appear here once the orchestrator settles a completed job to the
                PaymentLedger contract. Each row links to the payout transaction on Snowtrace.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-foreground/10 hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase">Job</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Agent</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Type</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Amount</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Settled</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Reasoning</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.map((s) => (
                  <TableRow key={s.jobId} className="border-foreground/5">
                    <TableCell className="font-mono text-xs">#{s.jobId}</TableCell>
                    <TableCell className="text-xs">
                      <AddrLink addr={s.agentWallet} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.agentType === 0 ? 'Scout' : 'Executor'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-[#fbbf24]">
                      {fmtUSDC(s.amount, 4)}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {new Date(s.settledAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-[11px] text-muted-foreground" title={s.llmReasoning}>
                      {s.llmReasoning || '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <TxLink hash={s.paymentTxHash} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        {/* Per-agent breakdown */}
        {byAgent.length > 0 && (
          <section className={cn(cardClass, 'mt-8 p-6')}>
            <div className="flex items-center gap-2 mb-5">
              <Wallet className="w-4 h-4 text-[#a78bfa]" />
              <h2 className="font-display text-lg tracking-tight">By agent</h2>
            </div>
            <div className="space-y-2.5">
              {byAgent.map((a) => (
                <div
                  key={a.wallet}
                  className="flex items-center gap-4 rounded-lg border border-foreground/10 bg-background/30 p-3"
                >
                  <AddrLink addr={a.wallet} className="text-xs" />
                  <Badge variant="outline" className="border-foreground/15 font-mono text-[10px]">
                    {a.count} payouts
                  </Badge>
                  <span className="ml-auto font-mono text-sm tabular-nums text-[#fbbf24]">
                    {fmtUSDC(a.total, 4)} USDC
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </WalletGate>
    </div>
  )
}
