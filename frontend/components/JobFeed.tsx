import type { Job } from '@/lib/types';
import ExplorerLink from './ExplorerLink';

const STATUS_STYLES: Record<Job['status'], { dot: string; text: string }> = {
  Pending:   { dot: 'bg-warning',          text: 'text-warning' },
  Completed: { dot: 'bg-positive',         text: 'text-positive' },
  Failed:    { dot: 'bg-negative',         text: 'text-negative' },
  Expired:   { dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
};

export default function JobFeed({ jobs, explorerBase }: { jobs: Job[]; explorerBase?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground mb-4">
        Job Feed
      </h2>
      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {jobs.map((job) => {
          const cfg = STATUS_STYLES[job.status];
          // Prefer the result/settlement tx; fall back to the assignment tx.
          const tx = job.resultTx ?? job.assignedTx;
          return (
            <div key={job.jobId} className="rounded-md p-3 text-sm border border-border bg-secondary">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  <span className="text-muted-foreground text-xs font-mono">#{job.jobId}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground uppercase tracking-wider">
                    {job.type}
                  </span>
                  <span className={`text-xs font-medium ${cfg.text}`}>{job.status}</span>
                </div>
                <span className="text-muted-foreground text-xs font-mono">
                  {new Date(job.assignedAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <ExplorerLink value={job.agent} kind="address" base={explorerBase} showIcon={false} />
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <span className="opacity-60">tx</span>
                  <ExplorerLink value={tx} kind="tx" base={explorerBase} lead={6} tail={4} />
                </span>
              </div>
            </div>
          );
        })}
        {jobs.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-4">No jobs yet. Agents initializing…</p>
        )}
      </div>
    </div>
  );
}
