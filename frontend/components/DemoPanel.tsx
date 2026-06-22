'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

export default function DemoPanel({ onUpdate }: { onUpdate: () => void }) {
  const [pool, setPool] = useState<'MockPoolA' | 'MockPoolB'>('MockPoolA');
  const [apy, setApy] = useState('1800');
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState('');

  async function handleSet() {
    setLoading(true);
    setLastResult('');
    try {
      const data = await api.setAPY(pool, parseInt(apy));
      if (data.success) {
        setLastResult(`${pool} APY set to ${data.apyFormatted}. Scout detects within ~60s.`);
        onUpdate();
      } else {
        setLastResult(`Error: ${data.error}`);
      }
    } catch (e: any) {
      setLastResult(`Error: ${e.message}`);
    }
    setLoading(false);
  }

  const apyNum = parseInt(apy) || 0;

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground mb-1">
        Demo Control
      </h2>
      <p className="text-muted-foreground text-xs mb-4">
        Set a MockPool APY on-chain to trigger a live rebalance.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">Pool</label>
          <select
            value={pool}
            onChange={(e) => setPool(e.target.value as 'MockPoolA' | 'MockPoolB')}
            className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="MockPoolA">MockPoolA</option>
            <option value="MockPoolB">MockPoolB</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">
            APY (bps) — <strong className="text-foreground font-mono">{(apyNum / 100).toFixed(2)}%</strong>
          </label>
          <input
            type="number"
            value={apy}
            onChange={(e) => setApy(e.target.value)}
            min="0"
            max="50000"
            placeholder="1800 = 18.00%"
            className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <button
          onClick={handleSet}
          disabled={loading}
          className="w-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded-md py-2.5 text-sm font-medium transition-opacity"
        >
          {loading ? 'Submitting…' : 'Set APY On-Chain'}
        </button>

        {lastResult && (
          <div className="text-xs rounded-md p-2.5 bg-secondary border border-border text-muted-foreground break-words">
            {lastResult}
          </div>
        )}
      </div>
    </div>
  );
}
