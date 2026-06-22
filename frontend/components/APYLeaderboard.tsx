import type { Protocol } from '@/lib/types';
import ExplorerLink from './ExplorerLink';

export default function APYLeaderboard({
  protocols,
  explorerBase,
}: {
  protocols: Protocol[];
  explorerBase?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground mb-4">
        APY Leaderboard
      </h2>
      <div className="space-y-1.5">
        {protocols.map((p, i) => (
          <div
            key={p.address}
            className={`flex items-center justify-between rounded-md p-3 border ${
              p.isActive ? 'border-positive/40 bg-positive/5' : 'border-border bg-secondary'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs font-mono w-4 text-right">{i + 1}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-foreground">{p.name}</span>
                  {p.isActive && (
                    <span className="text-[10px] px-1.5 py-0.5 border border-positive/40 text-positive rounded uppercase tracking-wider">
                      Active
                    </span>
                  )}
                  {p.error && <span className="text-xs text-negative">unavailable</span>}
                </div>
                <div className="text-xs mt-0.5">
                  <ExplorerLink value={p.address} kind="address" base={explorerBase} showIcon={false} />
                </div>
              </div>
            </div>
            <div
              className={`text-xl font-mono ${p.isActive ? 'text-positive' : 'text-foreground'}`}
            >
              {p.apyFormatted}
            </div>
          </div>
        ))}
        {protocols.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-4">Loading protocols…</p>
        )}
      </div>
    </div>
  );
}
