'use client'

import { cn } from '@/lib/utils'
import { truncateAddress } from '@/lib/web3/format'
import { txUrl, addressUrl, SNOWTRACE_BASE } from '@/lib/web3/explorer'
import type { Job } from '@/lib/web3/api'
import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'

/** Shared card surface used across every portal page. */
export const cardClass =
  'rounded-xl border border-foreground/10 bg-card/50 backdrop-blur'

export const accentText: Record<'pink' | 'purple' | 'cyan' | 'amber', string> = {
  pink: 'text-[#eca8d6]',
  purple: 'text-[#a78bfa]',
  cyan: 'text-[#67e8f9]',
  amber: 'text-[#fbbf24]',
}

/* ------------------------------ link helpers ------------------------------ */

export function ExtLink({
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

export function AddrLink({
  addr,
  base = SNOWTRACE_BASE,
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

export function TxLink({
  hash,
  base = SNOWTRACE_BASE,
  label,
}: {
  hash?: string | null
  base?: string
  label?: string
}) {
  return (
    <ExtLink href={txUrl(hash, base)}>
      {hash ? label ?? truncateAddress(hash) : '—'}
    </ExtLink>
  )
}

/* --------------------------------- stat ----------------------------------- */

export function Stat({
  icon,
  label,
  value,
  unit,
  sub,
  accent = 'cyan',
}: {
  icon?: React.ReactNode
  label: string
  value: string
  unit?: string
  sub?: string
  accent?: 'pink' | 'purple' | 'cyan' | 'amber'
}) {
  return (
    <div className={cn(cardClass, 'p-4')}>
      <div className={cn('flex items-center gap-1.5 mb-2', accentText[accent])}>
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

/* -------------------------------- key/val --------------------------------- */

export function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground/80">{value}</span>
    </div>
  )
}

/* ----------------------------- status badges ------------------------------ */

export function JobStatusBadge({ status }: { status: Job['status'] }) {
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

export function AgentStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active: 'border-[#67e8f9]/30 text-[#a5f3fc]',
    Paused: 'border-[#fbbf24]/30 text-[#fbbf24]',
    Deregistered: 'border-foreground/15 text-muted-foreground',
    Banned: 'border-destructive/40 text-destructive',
  }
  return (
    <Badge variant="outline" className={cn('text-[10px]', map[status] ?? '')}>
      {status}
    </Badge>
  )
}

/* ------------------------------ section head ------------------------------ */

export function SectionHeading({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string
  title: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3">
          {eyebrow}
        </p>
        <h1 className="font-display text-5xl lg:text-6xl tracking-tight">{title}</h1>
      </div>
      {right}
    </div>
  )
}
