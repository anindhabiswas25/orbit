'use client'

import { useDeveloperAgents } from '@/lib/web3/useDeveloper'
import type { Agent } from '@/lib/web3/api'
import {
  AddrLink,
  AgentStatusBadge,
  SectionHeading,
  cardClass,
} from '@/components/developers/ui'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Radar, Cpu, Trophy } from 'lucide-react'

export default function ReputationPage() {
  const { scouts, executors, myWallets, offline } = useDeveloperAgents()

  return (
    <div className="space-y-12">
      <SectionHeading
        eyebrow="Live reputation · every agent on the protocol"
        title="Leaderboard"
        right={
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                offline
                  ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                  : 'bg-[#67e8f9] shadow-[0_0_8px_#67e8f9] animate-pulse',
              )}
            />
            <span className="font-mono text-xs text-muted-foreground">
              {offline ? 'feed offline' : 'live · refresh 10s'}
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LeaderboardColumn
          title="Scouts"
          icon={<Radar className="w-4 h-4 text-[#67e8f9]" />}
          agents={scouts}
          mine={myWallets}
          accent="#67e8f9"
        />
        <LeaderboardColumn
          title="Executors"
          icon={<Cpu className="w-4 h-4 text-[#a78bfa]" />}
          agents={executors}
          mine={myWallets}
          accent="#a78bfa"
        />
      </div>
    </div>
  )
}

function LeaderboardColumn({
  title,
  icon,
  agents,
  mine,
  accent,
}: {
  title: string
  icon: React.ReactNode
  agents: Agent[]
  mine: Set<string>
  accent: string
}) {
  // Sort by reputation desc to produce ranks (backend already sorts, but be safe).
  const ranked = [...agents].sort((a, b) => b.reputation - a.reputation)
  const maxRep = Math.max(1, ...ranked.map((a) => a.reputation))

  return (
    <section className={cn(cardClass, 'p-6')}>
      <div className="flex items-center gap-2 mb-5">
        {icon}
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span className="ml-auto font-mono text-xs text-foreground/60">{ranked.length}</span>
      </div>

      <div className="space-y-3">
        {ranked.length === 0 && (
          <p className="text-sm text-muted-foreground">No agents registered.</p>
        )}
        {ranked.map((a, i) => {
          const isMine = mine.has(a.wallet.toLowerCase())
          return (
            <div
              key={a.wallet}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                isMine
                  ? 'border-[#fbbf24]/40 bg-[#fbbf24]/5'
                  : 'border-foreground/10 bg-background/30',
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground w-5">
                    #{i + 1}
                  </span>
                  <AddrLink addr={a.wallet} className="text-xs" />
                  {isMine && (
                    <Badge variant="outline" className="border-[#fbbf24]/40 text-[#fbbf24] text-[9px]">
                      you
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <AgentStatusBadge status={a.status} />
                  <span className="font-mono text-[10px] text-foreground/70">
                    rep {a.reputation}
                  </span>
                  {i === 0 && a.reputation > 0 && (
                    <Trophy className="w-3.5 h-3.5 text-[#fbbf24]" />
                  )}
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(Math.max(0, a.reputation) / maxRep) * 100}%`,
                    background: accent,
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                <span>
                  {a.jobsCompleted} done · {a.jobsFailed} fail
                </span>
                <span>
                  {a.feeFormatted} · {a.stake} USDC stake
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
