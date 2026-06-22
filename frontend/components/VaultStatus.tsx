import type { VaultStatus } from '@/lib/types';
import ExplorerLink from './ExplorerLink';

const ZERO = '0x0000000000000000000000000000000000000000';

export default function VaultStatusCard({
  status,
  explorerBase,
}: {
  status: VaultStatus | null;
  explorerBase?: string;
}) {
  if (!status) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 animate-pulse h-44">
        <div className="h-3 bg-muted rounded w-1/4 mb-6" />
        <div className="h-8 bg-muted rounded w-1/2 mb-3" />
        <div className="h-4 bg-muted rounded w-2/3" />
      </div>
    );
  }

  const hasActive = status.currentProtocol && status.currentProtocol !== ZERO;
  const hasBest = status.bestProtocol && status.bestProtocol !== ZERO;
  const hasRebalanced = status.lastScoutAt > 0;

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground mb-5">
        Vault Status
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
        {/* Balance */}
        <div>
          <div className="text-3xl font-mono text-foreground">
            {status.vaultBalance.toFixed(2)}
            <span className="text-base text-muted-foreground ml-1.5">USDC</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1.5">Total vault balance</div>
        </div>

        {/* Active Protocol */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${hasActive ? 'bg-positive' : 'bg-muted-foreground/40'}`}
            />
            <span className="text-lg font-medium text-foreground">
              {status.currentProtocolName || 'None'}
            </span>
          </div>
          <div className="text-2xl font-mono text-positive">{status.currentAPYFormatted}</div>
          <div className="text-xs text-muted-foreground mt-1.5 flex items-center gap-2">
            <span>Active · APY</span>
            {hasActive && (
              <ExplorerLink
                value={status.currentProtocol}
                kind="address"
                base={explorerBase}
                showIcon={false}
                lead={5}
                tail={4}
              />
            )}
          </div>
        </div>

        {/* Best Signal */}
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Best signal</div>
          <div className="text-lg font-medium text-foreground">{status.bestProtocolName || 'None'}</div>
          <div className="text-base font-mono text-warning">{status.bestAPYFormatted}</div>
          <div className="text-xs text-muted-foreground mt-1.5">
            {hasBest ? (
              <ExplorerLink
                value={status.bestProtocol}
                kind="address"
                base={explorerBase}
                showIcon={false}
                lead={5}
                tail={4}
              />
            ) : hasRebalanced ? (
              `Scouted ${new Date(status.lastScoutAt).toLocaleTimeString()}`
            ) : (
              'No scout yet'
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
