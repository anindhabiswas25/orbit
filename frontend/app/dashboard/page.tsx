'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import type { VaultStatus, Protocol, Agent, Job, RebalanceEvent, Meta } from '@/lib/types';
import VaultStatusCard from '@/components/VaultStatus';
import APYLeaderboard from '@/components/APYLeaderboard';
import AgentLeaderboard from '@/components/AgentLeaderboard';
import JobFeed from '@/components/JobFeed';
import AgentLog from '@/components/AgentLog';
import DemoPanel from '@/components/DemoPanel';
import ContractsPanel from '@/components/ContractsPanel';

export default function Dashboard() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [events, setEvents] = useState<RebalanceEvent[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, p, a, j, e] = await Promise.all([
        api.status(),
        api.protocols(),
        api.agents(),
        api.jobs(12),
        api.events(20),
      ]);
      setStatus(s);
      setProtocols(p);
      setAgents(a);
      setJobs(j);
      setEvents(e);
      setLastPoll(new Date());
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // Meta (contract addresses / explorer base) changes rarely — load once.
  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const explorerBase = meta?.explorerBase;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Header */}
        <header className="flex items-end justify-between mb-10 border-b border-border pb-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-positive animate-pulse" />
              <h1 className="font-display text-5xl leading-none tracking-tight text-foreground">Orbit</h1>
            </div>
            <p className="text-muted-foreground mt-2 text-sm">
              Open Agent Yield Marketplace · Live Dashboard
            </p>
          </div>
          <div className="text-right text-xs">
            <div className="font-mono uppercase tracking-wider text-muted-foreground">
              {meta?.network ?? 'Avalanche Fuji'} · Chain {meta?.chainId ?? 43113}
            </div>
            {error ? (
              <div className="text-negative mt-1">API error — retrying…</div>
            ) : (
              <div className="text-muted-foreground mt-1">
                Updated {lastPoll ? lastPoll.toLocaleTimeString() : '—'} · every 10s
              </div>
            )}
          </div>
        </header>

        {/* Row 1: Vault + Demo */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
          <div className="lg:col-span-2">
            <VaultStatusCard status={status} explorerBase={explorerBase} />
          </div>
          <DemoPanel onUpdate={refresh} />
        </div>

        {/* Row 2: Protocol + Agent leaderboards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
          <APYLeaderboard protocols={protocols} explorerBase={explorerBase} />
          <AgentLeaderboard agents={agents} explorerBase={explorerBase} />
        </div>

        {/* Row 3: Job feed + Rebalance history */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
          <JobFeed jobs={jobs} explorerBase={explorerBase} />
          <AgentLog events={events} explorerBase={explorerBase} />
        </div>

        {/* Row 4: Contracts reference */}
        <ContractsPanel meta={meta} />

        <footer className="mt-10 pt-6 border-t border-border text-xs text-muted-foreground flex items-center justify-between">
          <span>Every address &amp; transaction links to Snowtrace.</span>
          <span className="font-mono">orbit-protocol</span>
        </footer>
      </div>
    </main>
  );
}
