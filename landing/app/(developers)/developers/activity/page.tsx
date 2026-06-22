'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Job, type RebalanceEvent } from '@/lib/web3/api'
import { useDeveloperAgents } from '@/lib/web3/useDeveloper'
import {
  AddrLink,
  TxLink,
  JobStatusBadge,
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
import { Activity, ArrowRight, Wallet } from 'lucide-react'

export default function ActivityPage() {
  const { myWallets } = useDeveloperAgents()
  const [jobs, setJobs] = useState<Job[]>([])
  const [events, setEvents] = useState<RebalanceEvent[]>([])
  const [scope, setScope] = useState<'mine' | 'all'>('mine')

  const refresh = useCallback(async () => {
    try {
      const [j, e] = await Promise.all([api.jobs(30), api.events(30)])
      setJobs(j)
      setEvents(e)
    } catch {
      /* feed offline — keep last */
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 10_000)
    return () => clearInterval(t)
  }, [refresh])

  const shownJobs = useMemo(
    () =>
      scope === 'all'
        ? jobs
        : jobs.filter((j) => myWallets.has(j.agent.toLowerCase())),
    [jobs, scope, myWallets],
  )
  const shownEvents = useMemo(
    () =>
      scope === 'all'
        ? events
        : events.filter((e) => myWallets.has(e.executorAgent.toLowerCase())),
    [events, scope, myWallets],
  )

  return (
    <div className="space-y-12">
      <SectionHeading
        eyebrow="Jobs · rebalances · live on-chain"
        title="Activity"
        right={
          <div className="inline-flex rounded-full border border-foreground/15 p-1">
            <ToggleBtn active={scope === 'mine'} onClick={() => setScope('mine')}>
              My agents
            </ToggleBtn>
            <ToggleBtn active={scope === 'all'} onClick={() => setScope('all')}>
              All
            </ToggleBtn>
          </div>
        }
      />

      <WalletGate subtitle="Connect your wallet to see activity for the agents you own.">
        {/* Job feed */}
        <section className={cn(cardClass, 'p-6')}>
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-[#a78bfa]" />
            <h2 className="font-display text-lg tracking-tight">Job feed</h2>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {shownJobs.length} {scope === 'mine' ? 'yours' : 'recent'}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-foreground/10 hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase">Job</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Type</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Agent</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Time</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Tx</TableHead>
                <TableHead className="font-mono text-[10px] uppercase text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownJobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                    {scope === 'mine'
                      ? 'No jobs for your agents yet.'
                      : 'No jobs yet.'}
                  </TableCell>
                </TableRow>
              )}
              {shownJobs.map((j) => (
                <TableRow key={j.jobId} className="border-foreground/5">
                  <TableCell className="font-mono text-xs">#{j.jobId}</TableCell>
                  <TableCell className="text-xs">{j.type}</TableCell>
                  <TableCell className="text-xs">
                    <AddrLink addr={j.agent} />
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {new Date(j.assignedAt).toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <TxLink hash={j.resultTx ?? j.assignedTx} />
                  </TableCell>
                  <TableCell className="text-right">
                    <JobStatusBadge status={j.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        {/* Rebalance feed */}
        <section className={cn(cardClass, 'mt-8 p-6')}>
          <div className="flex items-center gap-2 mb-4">
            <ArrowRight className="w-4 h-4 text-[#67e8f9]" />
            <h2 className="font-display text-lg tracking-tight">Rebalances</h2>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {shownEvents.length} moves
            </span>
          </div>
          <div className="space-y-3">
            {shownEvents.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">
                {scope === 'mine'
                  ? 'No rebalances executed by your agents yet.'
                  : 'No rebalances yet.'}
              </p>
            )}
            {shownEvents.map((e, i) => (
              <div
                key={`${e.timestamp}-${i}`}
                className="rounded-lg border border-foreground/10 bg-background/30 p-4"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{e.fromName}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#a78bfa]" />
                  <span className="text-foreground">{e.toName}</span>
                  <Badge variant="outline" className="ml-auto border-[#67e8f9]/30 text-[#a5f3fc] text-[10px]">
                    +{e.gainFormatted}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                  <span>
                    {e.fromFormatted} → {e.toFormatted} · {e.amount.toFixed(2)} USDC
                  </span>
                  <span>{new Date(e.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Wallet className="w-3 h-3" />
                    <AddrLink addr={e.executorAgent} />
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    tx <TxLink hash={e.txHash} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </WalletGate>
    </div>
  )
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-4 h-8 text-xs transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
