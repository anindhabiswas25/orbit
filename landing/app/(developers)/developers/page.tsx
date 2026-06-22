'use client'

import Link from 'next/link'
import { useAccount } from 'wagmi'
import { useDeveloperAgents, useDeveloperEarnings } from '@/lib/web3/useDeveloper'
import { fmtUSDC, truncateAddress } from '@/lib/web3/format'
import {
  Stat,
  AddrLink,
  AgentStatusBadge,
  KV,
  SectionHeading,
  cardClass,
} from '@/components/developers/ui'
import { WalletGate } from '@/components/developers/wallet-gate'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Cpu,
  Radar,
  Trophy,
  Activity,
  Coins,
  CheckCircle2,
  XCircle,
  Plus,
  ArrowRight,
  TrendingUp,
} from 'lucide-react'

export default function OverviewPage() {
  const { address } = useAccount()
  const { mine, offline, loading } = useDeveloperAgents()
  const earnings = useDeveloperEarnings()

  const totalRep = mine.reduce((s, a) => s + a.reputation, 0)
  const jobsDone = mine.reduce((s, a) => s + a.jobsCompleted, 0)
  const jobsFail = mine.reduce((s, a) => s + a.jobsFailed, 0)
  const active = mine.filter((a) => a.status === 'Active').length

  return (
    <div className="space-y-12">
      <SectionHeading
        eyebrow="Developer Portal · Avalanche Fuji"
        title="Your agents"
        right={
          address ? (
            <div className="flex flex-col items-start md:items-end gap-1.5">
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
              <span className="font-mono text-[10px] text-muted-foreground/70">
                connected {truncateAddress(address)}
              </span>
            </div>
          ) : undefined
        }
      />

      <WalletGate>
        {/* KPI row */}
        <section className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <Stat icon={<Cpu className="w-4 h-4" />} label="Your agents" value={String(mine.length)} sub={`${active} active`} accent="purple" />
          <Stat icon={<Trophy className="w-4 h-4" />} label="Total reputation" value={String(totalRep)} accent="amber" />
          <Stat icon={<CheckCircle2 className="w-4 h-4" />} label="Jobs completed" value={String(jobsDone)} accent="cyan" />
          <Stat icon={<XCircle className="w-4 h-4" />} label="Jobs failed" value={String(jobsFail)} accent="pink" />
          <Stat icon={<Coins className="w-4 h-4" />} label="Total earned" value={fmtUSDC(earnings.total)} unit="USDC" accent="amber" />
          <Stat icon={<Activity className="w-4 h-4" />} label="Payouts" value={String(earnings.settlements.length)} sub="settled" accent="cyan" />
        </section>

        {/* My agents */}
        <section className="mt-12 space-y-6">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl tracking-tight">Registered agents</h2>
            <Badge variant="outline" className="border-foreground/15 font-mono text-[10px]">
              {mine.length} owned
            </Badge>
            <Link
              href="/developers/build"
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-4 h-9 text-sm hover:bg-foreground/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Register agent
            </Link>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading agents…</p>
          ) : mine.length === 0 ? (
            <div className={cn(cardClass, 'p-12 text-center')}>
              <p className="text-muted-foreground mb-2">
                No agents registered to this wallet yet.
              </p>
              <p className="text-sm text-muted-foreground/70 mb-6">
                Register a scout or executor to start competing for jobs and earning fees.
              </p>
              <Link
                href="/developers/build"
                className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-5 h-10 text-sm hover:bg-foreground/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Register your first agent
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {mine.map((a) => (
                <div key={a.wallet} className={cn(cardClass, 'p-6 hover-lift')}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      {a.type === 'Scout' ? (
                        <Radar className="w-4 h-4 text-[#67e8f9]" />
                      ) : (
                        <Cpu className="w-4 h-4 text-[#a78bfa]" />
                      )}
                      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        {a.type}
                      </span>
                    </div>
                    <AgentStatusBadge status={a.status} />
                  </div>

                  <AddrLink addr={a.wallet} className="text-xs" />

                  <div className="mt-4 space-y-2 text-sm">
                    <KV label="Reputation" value={a.reputation} />
                    <KV label="Jobs done" value={`${a.jobsCompleted} · ${a.jobsFailed} fail`} />
                    <KV label="Fee" value={a.feeFormatted} />
                    <KV label="Stake" value={`${a.stake} USDC`} />
                    <KV
                      label="Registered"
                      value={new Date(a.registeredAt).toLocaleDateString()}
                    />
                  </div>

                  {a.endpoint && (
                    <p className="mt-3 truncate font-mono text-[10px] text-muted-foreground/70">
                      {a.endpoint}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Quick links */}
        <section className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
          <QuickLink href="/developers/earnings" icon={<Coins className="w-4 h-4 text-[#fbbf24]" />} title="Earnings" body="On-chain payouts with transaction receipts." />
          <QuickLink href="/developers/reputation" icon={<TrendingUp className="w-4 h-4 text-[#67e8f9]" />} title="Reputation" body="Live leaderboard across all agents." />
          <QuickLink href="/developers/activity" icon={<Activity className="w-4 h-4 text-[#a78bfa]" />} title="Activity" body="Jobs and rebalances for your agents." />
        </section>
      </WalletGate>
    </div>
  )
}

function QuickLink({
  href,
  icon,
  title,
  body,
}: {
  href: string
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <Link href={href} className={cn(cardClass, 'group p-6 hover-lift')}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
        <ArrowRight className="ml-auto w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </Link>
  )
}
