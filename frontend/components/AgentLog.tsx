import type { RebalanceEvent } from '@/lib/types';
import ExplorerLink from './ExplorerLink';

export default function AgentLog({
  events,
  explorerBase,
}: {
  events: RebalanceEvent[];
  explorerBase?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground mb-4">
        Rebalance History
      </h2>
      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {events.map((e, i) => (
          <div key={i} className="bg-secondary border border-border rounded-md p-3 text-sm">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-foreground font-medium">
                  {e.fromName || 'None'} <span className="text-muted-foreground">→</span> {e.toName}
                </span>
                <span className="text-xs text-positive font-mono">{e.gainFormatted}</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {e.fromFormatted} → {e.toFormatted} · {e.amount.toFixed(2)} USDC moved
            </div>
            <div className="flex items-center justify-between gap-2 mt-1">
              <ExplorerLink value={e.executorAgent} kind="address" base={explorerBase} showIcon={false} />
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <span className="opacity-60">tx</span>
                <ExplorerLink value={e.txHash} kind="tx" base={explorerBase} lead={6} tail={4} />
              </span>
            </div>
          </div>
        ))}
        {events.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-4">
            No rebalances yet. Awaiting first scout cycle…
          </p>
        )}
      </div>
    </div>
  );
}
