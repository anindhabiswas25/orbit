'use client'

import { useEffect, useState, useCallback } from 'react'
import { useVault, protocolName } from '@/lib/web3/useVault'
import { fmtUSDC, fmtAPY, numUSDC, truncateAddress } from '@/lib/web3/format'
import {
  api,
  type Agent,
  type Job,
  type RebalanceEvent,
  type VaultStatus,
  type Protocol,
  type Meta,
} from '@/lib/web3/api'
import { txUrl, addressUrl, SNOWTRACE_BASE } from '@/lib/web3/explorer'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  ArrowRight,
  User,
  Vault,
  Coins,
  Trophy,
  Radar,
  Cpu,
  Activity,
  ExternalLink,
  TrendingUp,
  Layers,
  Wallet,
  Gauge,
} from 'lucide-react'

/* ----------------------------- link primitives ---------------------------- */

function ExtLink({
  href,
  children,
  className,
}: {
  href: string | null
  children: React.ReactNode
  className?: string
}) {
  if (!href) {
    return <span className="font-mono text-muted-foreground/50">—</span>
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group inline-flex items-center gap-1 font-mono text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      <span className="underline decoration-foreground/20 decoration-dotted underline-offset-2 group-hover:decoration-foreground">
        {children}
      </span>
      <ExternalLink className="h-3 w-3 opacity-40 transition-opacity group-hover:opacity-90" />
    </a>
  )
}

function AddrLink({
  addr,
  base,
  className,
}: {
  addr?: string | null
  base?: string
  className?: string
}) {
  return (
    <ExtLink href={addressUrl(addr, base)} className={className}>
      {addr ? truncateAddress(addr) : '—'}
    </ExtLink>
  )
}

function TxLink({
  hash,
  base,
  label,
}: {
  hash?: string | null
  base?: string
  label?: string
}) {
  return <ExtLink href={txUrl(hash, base)}>{hash ? label ?? truncateAddress(hash) : '—'}</ExtLink>
}

/* --------------------------------- page ----------------------------------- */

export default function TrackingPage() {
  const vault = useVault()
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [protocols, setProtocols] = useState<Protocol[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [events, setEvents] = useState<RebalanceEvent[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [offline, setOffline] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, p, a, j, e] = await Promise.all([
        api.status(),
        api.protocols(),
        api.agents(),
        api.jobs(15),
        api.events(15),
      ])
      setStatus(s)
      setProtocols(p)
      setAgents(a)
      setJobs(j)
      setEvents(e)
      setUpdatedAt(new Date())
      setOffline(false)
    } catch {
      setOffline(true)
    }
  }, [])

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5_000)
    return () => clearInterval(t)
  }, [refresh])

  const base = meta?.explorerBase ?? SNOWTRACE_BASE
  const scouts = agents.filter((a) => a.type === 'Scout')
  const executors = agents.filter((a) => a.type === 'Executor')
  const latestWinner = jobs.find((j) => j.status === 'Completed') || jobs[0]

  // Headline figures prefer the always-on backend (no wallet needed); fall back
  // to the connected wallet's on-chain reads.
  const vaultBalance = status ? status.vaultBalance : numUSDC(vault.vaultBalance)
  const activeName = status?.currentProtocolName ?? protocolName(vault.activeProtocol)
  const activeAPY = status?.currentAPYFormatted ?? fmtAPY(vault.activeAPY)
  const bestName = status?.bestProtocolName ?? protocolName(vault.bestProtocol)
  const bestAPY = status?.bestAPYFormatted ?? fmtAPY(vault.bestAPY)

  const totalRebalanced = events.reduce((s, e) => s + e.amount, 0)
  const completedJobs = jobs.filter((j) => j.status === 'Completed').length
  const activeAgents = agents.filter((a) => a.status === 'Active').length

  return (
    <div className="space-y-12">
      {/* header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3">
            Money flow · Agent competition · Live on-chain
          </p>
          <h1 className="font-display text-5xl lg:text-6xl tracking-tight">Tracking</h1>
        </div>
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
              {offline ? 'feed offline — on-chain data live' : 'live · refresh 5s'}
            </span>
          </div>
          <div className="font-mono text-[10px] text-muted-foreground/70">
            {meta ? `${meta.network} · chain ${meta.chainId}` : 'Avalanche Fuji'}
            {updatedAt && !offline ? ` · updated ${updatedAt.toLocaleTimeString()}` : ''}
          </div>
        </div>
      </div>

      {/* headline stats */}
      <section className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <Stat icon={<Vault className="w-4 h-4" />} label="Vault TVL" value={`${vaultBalance.toFixed(2)}`} unit="USDC" accent="purple" />
        <Stat icon={<Gauge className="w-4 h-4" />} label="Active APY" value={activeAPY} sub={activeName} accent="cyan" />
        <Stat icon={<TrendingUp className="w-4 h-4" />} label="Best signal" value={bestAPY} sub={bestName} accent="amber" />
        <Stat icon={<Cpu className="w-4 h-4" />} label="Agents online" value={String(activeAgents)} sub={`${scouts.length}S · ${executors.length}E`} accent="cyan" />
        <Stat icon={<Activity className="w-4 h-4" />} label="Jobs done" value={String(completedJobs)} sub={`of ${jobs.length} recent`} accent="purple" />
        <Stat icon={<Coins className="w-4 h-4" />} label="Rebalanced" value={totalRebalanced.toFixed(2)} unit="USDC" sub={`${events.length} moves`} accent="amber" />
      </section>

      <MoneyFlow
        vaultBalance={vaultBalance}
        activeName={activeName}
        activeAPY={activeAPY}
        vaultAddr={meta?.contracts.YieldVault}
        feePoolAddr={meta?.contracts.FeePool}
        activeAddr={status?.currentProtocol}
        base={base}
      />

      <AgentCompetition
        scouts={scouts}
        executors={executors}
        latestWinner={latestWinner}
        agents={agents}
        base={base}
      />

      <ProtocolBoard protocols={protocols} base={base} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <JobFeed jobs={jobs} base={base} />
        <RebalanceFeed events={events} base={base} />
      </div>

      <ContractsRef meta={meta} />
    </div>
  )
}

/* --------------------------------- stat ----------------------------------- */

function Stat({
  icon,
  label,
  value,
  unit,
  sub,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  sub?: string
  accent: 'pink' | 'purple' | 'cyan' | 'amber'
}) {
  const c = {
    pink: 'text-[#eca8d6]',
    purple: 'text-[#a78bfa]',
    cyan: 'text-[#67e8f9]',
    amber: 'text-[#fbbf24]',
  }[accent]
  return (
    <div className="rounded-xl border border-foreground/10 bg-card/50 backdrop-blur p-4">
      <div className={cn('flex items-center gap-1.5 mb-2', c)}>
        {icon}
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="font-display text-2xl tracking-tight tabular-nums">
        {value}
        {unit && <span className="text-sm text-muted-foreground ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

/* ------------------------------- Money flow ------------------------------- */

function MoneyFlow({
  vaultBalance,
  activeName,
  activeAPY,
  vaultAddr,
  feePoolAddr,
  activeAddr,
  base,
}: {
  vaultBalance: number
  activeName: string
  activeAPY: string
  vaultAddr?: string
  feePoolAddr?: string
  activeAddr?: string
  base: string
}) {
  const fee = vaultBalance * 0.001
  const deployed = vaultBalance - fee

  return (
    <section className="rounded-xl border border-foreground/10 bg-card/50 backdrop-blur p-8 lg:p-10">
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-display text-2xl tracking-tight">Money flow</h2>
        <span className="font-mono text-xs text-muted-foreground">pooled vault · illustrative split</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-4">
        <FlowNode icon={<User className="w-5 h-5" />} accent="pink" title="You" value="Deposit USDC" sub="Pooled with all depositors" />
        <Connector label="−0.10% fee" sublabel="→ FeePool" link={addressUrl(feePoolAddr, base)} />
        <FlowNode
          icon={<Vault className="w-5 h-5" />}
          accent="purple"
          title="Orbit Vault"
          value={`${vaultBalance.toFixed(2)} USDC`}
          sub={`Net deployed ~${deployed.toFixed(2)}`}
          link={addressUrl(vaultAddr, base)}
        />
        <Connector label="allocate" sublabel="active adapter" />
        <FlowNode
          icon={<Coins className="w-5 h-5" />}
          accent="cyan"
          title={activeName}
          value={`${activeAPY} APY`}
          sub="Yield accrues block-by-block"
          link={addressUrl(activeAddr, base)}
        />
      </div>

      <div className="mt-6 flex items-center justify-center gap-3 text-sm text-muted-foreground">
        <span className="h-px w-12 bg-gradient-to-r from-transparent to-[#67e8f9]/40" />
        <Coins className="w-4 h-4 text-[#67e8f9]" />
        <span>
          Yield flows back to <span className="text-foreground">You</span> on withdraw — no lock period
        </span>
        <ArrowRight className="w-4 h-4 text-[#67e8f9]" />
        <User className="w-4 h-4 text-[#eca8d6]" />
        <span className="h-px w-12 bg-gradient-to-l from-transparent to-[#eca8d6]/40" />
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <SplitBar label="Deployed to protocol" pct={99.9} accent="#67e8f9" />
        <SplitBar label="Protocol fee → agents" pct={0.1} accent="#fbbf24" />
        <div className="rounded-lg border border-foreground/10 bg-background/30 p-4 text-xs text-muted-foreground leading-relaxed">
          The vault is <span className="text-foreground">pooled</span>: there&apos;s no per-user allocation on-chain.
          Splits shown here illustrate where each deposited dollar flows.
        </div>
      </div>
    </section>
  )
}

function FlowNode({
  icon,
  title,
  value,
  sub,
  accent,
  link,
}: {
  icon: React.ReactNode
  title: string
  value: string
  sub: string
  accent: 'pink' | 'purple' | 'cyan'
  link?: string | null
}) {
  const ring = {
    pink: 'border-[#eca8d6]/30 text-[#eca8d6]',
    purple: 'border-[#a78bfa]/30 text-[#a78bfa]',
    cyan: 'border-[#67e8f9]/30 text-[#67e8f9]',
  }
  return (
    <div className="hover-lift rounded-xl border border-foreground/10 bg-background/40 p-5 flex flex-col items-center text-center">
      <div className={cn('mb-3 flex h-11 w-11 items-center justify-center rounded-full border bg-background/60', ring[accent])}>
        {icon}
      </div>
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="font-display text-lg tracking-tight mt-1">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          contract <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
  )
}

function Connector({ label, sublabel, link }: { label: string; sublabel: string; link?: string | null }) {
  const body = (
    <>
      <div className="relative flex items-center">
        <span className="hidden md:block h-px w-12 bg-gradient-to-r from-[#a78bfa]/50 to-[#67e8f9]/50" />
        <ArrowRight className="w-4 h-4 text-[#a78bfa] animate-pulse" />
      </div>
      <span className="font-mono text-[10px] text-foreground/70">{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{sublabel}</span>
    </>
  )
  return (
    <div className="flex md:flex-col items-center justify-center gap-1 py-2">
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="flex md:flex-col items-center gap-1 hover:opacity-80">
          {body}
        </a>
      ) : (
        body
      )}
    </div>
  )
}

function SplitBar({ label, pct, accent }: { label: string; pct: number; accent: string }) {
  return (
    <div className="rounded-lg border border-foreground/10 bg-background/30 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs" style={{ color: accent }}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct, 1)}%`, background: accent }} />
      </div>
    </div>
  )
}

/* --------------------------- Agent competition --------------------------- */

function AgentCompetition({
  scouts,
  executors,
  latestWinner,
  agents,
  base,
}: {
  scouts: Agent[]
  executors: Agent[]
  latestWinner?: Job
  agents: Agent[]
  base: string
}) {
  const winnerAgent = latestWinner
    ? agents.find((a) => a.wallet.toLowerCase() === latestWinner.agent.toLowerCase())
    : undefined
  const winnerTx = latestWinner?.resultTx ?? latestWinner?.assignedTx

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-display text-2xl tracking-tight">Agent competition</h2>
        <Badge variant="outline" className="border-foreground/15 font-mono text-[10px]">
          {scouts.length} scouts · {executors.length} executors compete → winner executes
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <CompetitorColumn title="Scouts" icon={<Radar className="w-4 h-4 text-[#67e8f9]" />} agents={scouts} winnerWallet={winnerAgent?.wallet} base={base} />
        <CompetitorColumn title="Executors" icon={<Cpu className="w-4 h-4 text-[#a78bfa]" />} agents={executors} winnerWallet={winnerAgent?.wallet} base={base} />

        <div className="rounded-xl border border-[#fbbf24]/25 bg-gradient-to-b from-[#fbbf24]/8 to-transparent p-6">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-4 h-4 text-[#fbbf24]" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Latest winner</span>
          </div>
          {latestWinner ? (
            <>
              <div className="font-display text-xl tracking-tight">Job #{latestWinner.jobId}</div>
              <div className="mt-1">
                <AddrLink addr={latestWinner.agent} base={base} className="text-xs" />
              </div>
              <Badge variant="outline" className="mt-3 border-[#fbbf24]/30 text-[#fbbf24]">
                {latestWinner.type} · {latestWinner.status}
              </Badge>
              {winnerAgent && (
                <div className="mt-5 space-y-2 text-sm">
                  <KV label="Reputation" value={String(winnerAgent.reputation)} />
                  <KV label="Jobs completed" value={String(winnerAgent.jobsCompleted)} />
                  <KV label="Fee" value={winnerAgent.feeFormatted} />
                  <KV label="Stake" value={`${winnerAgent.stake} USDC`} />
                </div>
              )}
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Settlement tx</span>
                <TxLink hash={winnerTx} base={base} />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Waiting for the next assignment…</p>
          )}
        </div>
      </div>
    </section>
  )
}

function CompetitorColumn({
  title,
  icon,
  agents,
  winnerWallet,
  base,
}: {
  title: string
  icon: React.ReactNode
  agents: Agent[]
  winnerWallet?: string
  base: string
}) {
  const maxRep = Math.max(1, ...agents.map((a) => a.reputation))
  return (
    <div className="rounded-xl border border-foreground/10 bg-card/50 backdrop-blur p-6">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="ml-auto font-mono text-xs text-foreground/60">{agents.length}</span>
      </div>
      <div className="space-y-3">
        {agents.length === 0 && <p className="text-sm text-muted-foreground">No agents registered.</p>}
        {agents.map((a) => {
          const isWinner = winnerWallet && a.wallet.toLowerCase() === winnerWallet.toLowerCase()
          return (
            <div
              key={a.wallet}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                isWinner ? 'border-[#fbbf24]/40 bg-[#fbbf24]/5' : 'border-foreground/10 bg-background/30',
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <AddrLink addr={a.wallet} base={base} className="text-xs" />
                {isWinner ? (
                  <Trophy className="w-3.5 h-3.5 text-[#fbbf24]" />
                ) : (
                  <span className="font-mono text-[10px] text-muted-foreground">rep {a.reputation}</span>
                )}
              </div>
              <Progress value={(a.reputation / maxRep) * 100} className="h-1.5" />
              <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                <span>{a.jobsCompleted} done · {a.jobsFailed} fail</span>
                <span>{a.feeFormatted}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ----------------------------- Protocol board ----------------------------- */

function ProtocolBoard({ protocols, base }: { protocols: Protocol[]; base: string }) {
  if (protocols.length === 0) return null
  const max = Math.max(1, ...protocols.map((p) => p.apy))
  return (
    <section className="rounded-xl border border-foreground/10 bg-card/50 backdrop-blur p-6">
      <div className="flex items-center gap-2 mb-5">
        <Layers className="w-4 h-4 text-[#67e8f9]" />
        <h2 className="font-display text-lg tracking-tight">Where money can go</h2>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {protocols.length} protocols scouted
        </span>
      </div>
      <div className="space-y-2.5">
        {protocols.map((p, i) => (
          <div
            key={p.address}
            className={cn(
              'flex items-center gap-4 rounded-lg border p-3',
              p.isActive ? 'border-[#67e8f9]/40 bg-[#67e8f9]/5' : 'border-foreground/10 bg-background/30',
            )}
          >
            <span className="font-mono text-[10px] text-muted-foreground w-4">{i + 1}</span>
            <div className="min-w-[120px]">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">{p.name}</span>
                {p.isActive && (
                  <Badge variant="outline" className="border-[#67e8f9]/30 text-[#a5f3fc] text-[9px]">
                    ACTIVE
                  </Badge>
                )}
                {p.error && <span className="text-[10px] text-destructive">unavailable</span>}
              </div>
              <AddrLink addr={p.address} base={base} className="text-[10px]" />
            </div>
            <div className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(p.apy / max) * 100}%`, background: p.isActive ? '#67e8f9' : '#a78bfa' }}
              />
            </div>
            <span className={cn('font-mono text-sm tabular-nums w-16 text-right', p.isActive ? 'text-[#a5f3fc]' : 'text-foreground/80')}>
              {p.apyFormatted}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------- Live feeds ------------------------------- */

function JobFeed({ jobs, base }: { jobs: Job[]; base: string }) {
  return (
    <section className="rounded-xl border border-foreground/10 bg-card/50 backdrop-blur p-6">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-[#a78bfa]" />
        <h3 className="font-display text-lg tracking-tight">Live job feed</h3>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{jobs.length} recent</span>
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
          {jobs.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                No jobs yet.
              </TableCell>
            </TableRow>
          )}
          {jobs.map((j) => (
            <TableRow key={j.jobId} className="border-foreground/5">
              <TableCell className="font-mono text-xs">#{j.jobId}</TableCell>
              <TableCell className="text-xs">{j.type}</TableCell>
              <TableCell className="text-xs">
                <AddrLink addr={j.agent} base={base} />
              </TableCell>
              <TableCell className="font-mono text-[10px] text-muted-foreground">
                {new Date(j.assignedAt).toLocaleTimeString()}
              </TableCell>
              <TableCell className="text-right text-xs">
                <TxLink hash={j.resultTx ?? j.assignedTx} base={base} />
              </TableCell>
              <TableCell className="text-right">
                <StatusBadge status={j.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}

function RebalanceFeed({ events, base }: { events: RebalanceEvent[]; base: string }) {
  return (
    <section className="rounded-xl border border-foreground/10 bg-card/50 backdrop-blur p-6">
      <div className="flex items-center gap-2 mb-4">
        <ArrowRight className="w-4 h-4 text-[#67e8f9]" />
        <h3 className="font-display text-lg tracking-tight">Rebalance feed</h3>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{events.length} moves</span>
      </div>
      <div className="space-y-3">
        {events.length === 0 && <p className="text-sm text-muted-foreground py-4">No rebalances yet.</p>}
        {events.map((e, i) => (
          <div key={`${e.timestamp}-${i}`} className="rounded-lg border border-foreground/10 bg-background/30 p-4">
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
                <AddrLink addr={e.executorAgent} base={base} />
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                tx <TxLink hash={e.txHash} base={base} />
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ----------------------------- Contracts ref ------------------------------ */

const CONTRACT_LABELS: Record<string, string> = {
  AgentSelectionEngine: 'Selection Engine',
  AgentRegistry: 'Agent Registry',
  YieldRegistry: 'Yield Registry',
  YieldVault: 'Yield Vault',
  FeePool: 'Fee Pool',
  PaymentLedger: 'Payment Ledger',
  USDC: 'USDC',
}

function ContractsRef({ meta }: { meta: Meta | null }) {
  if (!meta) return null
  const entries = Object.entries(meta.contracts).filter(([, a]) => !!a)
  return (
    <section className="rounded-xl border border-foreground/10 bg-card/50 backdrop-blur p-6">
      <div className="flex items-center gap-2 mb-5">
        <Layers className="w-4 h-4 text-[#a78bfa]" />
        <h2 className="font-display text-lg tracking-tight">Protocol contracts</h2>
        <a
          href={meta.explorerBase}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
        >
          Snowtrace <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2.5">
        {entries.map(([key, addr]) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">{CONTRACT_LABELS[key] ?? key}</span>
            <AddrLink addr={addr} base={meta.explorerBase} />
          </div>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------- bits ------------------------------------- */

function StatusBadge({ status }: { status: Job['status'] }) {
  const map: Record<Job['status'], string> = {
    Completed: 'border-[#67e8f9]/30 text-[#a5f3fc]',
    Pending: 'border-[#fbbf24]/30 text-[#fbbf24]',
    Failed: 'border-destructive/40 text-destructive',
    Expired: 'border-foreground/15 text-muted-foreground',
  }
  return (
    <Badge variant="outline" className={cn('text-[10px]', map[status])}>
      {status}
    </Badge>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground/80">{value}</span>
    </div>
  )
}
