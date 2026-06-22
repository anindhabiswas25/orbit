import type { VaultStatus, Protocol, Agent, Job, RebalanceEvent, Meta } from './types';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  status:    ()             => get<VaultStatus>('/api/status'),
  protocols: ()             => get<Protocol[]>('/api/protocols'),
  agents:    (type?: string) => get<Agent[]>(`/api/agents${type ? `?type=${type}` : ''}`),
  jobs:      (limit = 20)   => get<Job[]>(`/api/jobs?limit=${limit}`),
  events:    (limit = 20)   => get<RebalanceEvent[]>(`/api/events?limit=${limit}`),
  meta:      ()             => get<Meta>('/api/meta'),
  setAPY: (pool: string, apy: number) =>
    fetch(`${API}/api/demo/set-apy`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pool, apy }),
    }).then(r => r.json()),
};
