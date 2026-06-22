import type { Meta } from '@/lib/types';
import ExplorerLink from './ExplorerLink';

const LABELS: Record<string, string> = {
  AgentSelectionEngine: 'Selection Engine',
  AgentRegistry: 'Agent Registry',
  YieldRegistry: 'Yield Registry',
  YieldVault: 'Yield Vault',
  FeePool: 'Fee Pool',
  PaymentLedger: 'Payment Ledger',
  USDC: 'USDC',
};

export default function ContractsPanel({ meta }: { meta: Meta | null }) {
  if (!meta) return null;
  const entries = Object.entries(meta.contracts).filter(([, addr]) => !!addr);

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground mb-4">
        Protocol Contracts
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
        {entries.map(([key, addr]) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">{LABELS[key] ?? key}</span>
            <ExplorerLink value={addr} kind="address" base={meta.explorerBase} lead={6} tail={4} />
          </div>
        ))}
      </div>
    </div>
  );
}
