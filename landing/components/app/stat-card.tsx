'use client'

import { cn } from '@/lib/utils'

export function StatCard({
  label,
  value,
  sub,
  accent,
  className,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  accent?: 'pink' | 'purple' | 'cyan' | 'amber'
  className?: string
}) {
  const dot = {
    pink: 'bg-[#eca8d6] shadow-[0_0_8px_#eca8d6]',
    purple: 'bg-[#a78bfa] shadow-[0_0_8px_#a78bfa]',
    cyan: 'bg-[#67e8f9] shadow-[0_0_8px_#67e8f9]',
    amber: 'bg-[#fbbf24] shadow-[0_0_8px_#fbbf24]',
  }

  return (
    <div
      className={cn(
        'hover-lift rounded-xl border border-foreground/10 bg-card/60 backdrop-blur p-6',
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        {accent && (
          <span className={cn('h-1.5 w-1.5 rounded-full', dot[accent])} />
        )}
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="font-display text-3xl lg:text-4xl tracking-tight tabular-nums">
        {value}
      </div>
      {sub && (
        <div className="mt-2 text-sm text-muted-foreground">{sub}</div>
      )}
    </div>
  )
}
