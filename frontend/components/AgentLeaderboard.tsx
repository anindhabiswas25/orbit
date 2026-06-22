import type { Agent } from '@/lib/types';
import ExplorerLink from './ExplorerLink';

const STATUS_STYLES: Record<Agent['status'], string> = {
  Active:       'border-positive/40 text-positive',
  Paused:       'border-warning/40 text-warning',
  Deregistered: 'border-border text-muted-foreground',
  Banned:       'border-negative/40 text-negative',
};

export default function AgentLeaderboard({
  agents,
  explorerBase,
}: {
  agents: Agent[];
  explorerBase?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground mb-4">
        Agent Leaderboard
      </h2>
      <div className="space-y-1.5">
        {agents.map((agent, i) => (
          <div key={agent.wallet} className="bg-secondary border border-border rounded-md p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-muted-foreground text-xs font-mono w-5">#{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground font-mono uppercase tracking-wider">
                      {agent.type}
                    </span>
                    <ExplorerLink value={agent.wallet} kind="address" base={explorerBase} lead={6} tail={4} />
                    {agent.status !== 'Active' && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_STYLES[agent.status]}`}>
                        {agent.status}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {agent.feeFormatted} · {agent.jobsCompleted} wins · {agent.jobsFailed} fails ·{' '}
                    {agent.stake} USDC staked
                  </div>
                </div>
              </div>
              <div className="text-right ml-3 shrink-0">
                <div
                  className={`text-2xl font-mono ${
                    agent.reputation > 5
                      ? 'text-positive'
                      : agent.reputation > 0
                      ? 'text-warning'
                      : agent.reputation === 0
                      ? 'text-muted-foreground'
                      : 'text-negative'
                  }`}
                >
                  {agent.reputation >= 0 ? `+${agent.reputation}` : agent.reputation}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">rep</div>
              </div>
            </div>
          </div>
        ))}
        {agents.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-4">No agents registered yet</p>
        )}
      </div>
    </div>
  );
}
