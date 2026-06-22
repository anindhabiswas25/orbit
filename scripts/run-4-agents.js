// Launch all 4 agent servers (2 Scouts + 2 Executors) as child processes.
// Each agent runs its own HTTP server for x402 receipt delivery.
//
// Run: node scripts/run-4-agents.js
//
// Ports:
//   Scout1-Alpha     → :4001
//   Scout2-Beta      → :4002
//   Executor1-Prime  → :4003
//   Executor2-Rapid  → :4004

const { spawn } = require('child_process');
const path = require('path');
require('dotenv').config();

const AGENTS = [
  {
    name: 'Scout1-Alpha',
    type: 'scout',
    port: 4001,
    privateKey: process.env.SCOUT1_PRIVATE_KEY,
    devWallet: process.env.SCOUT1_DEV_WALLET,
    color: '\x1b[36m',   // cyan
  },
  {
    name: 'Scout2-Beta',
    type: 'scout',
    port: 4002,
    privateKey: process.env.SCOUT2_PRIVATE_KEY,
    devWallet: process.env.SCOUT2_DEV_WALLET,
    color: '\x1b[32m',   // green
  },
  {
    name: 'Executor1-Prime',
    type: 'executor',
    port: 4003,
    privateKey: process.env.EXECUTOR1_PRIVATE_KEY,
    devWallet: process.env.EXECUTOR1_DEV_WALLET,
    color: '\x1b[33m',   // yellow
  },
  {
    name: 'Executor2-Rapid',
    type: 'executor',
    port: 4004,
    privateKey: process.env.EXECUTOR2_PRIVATE_KEY,
    devWallet: process.env.EXECUTOR2_DEV_WALLET,
    color: '\x1b[35m',   // magenta
  },
];

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const serverScript = path.join(__dirname, '..', 'agents', 'agent-server.js');
const children = [];

console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}  Orbit Protocol — 4 Agent Servers${RESET}`);
console.log(`${BOLD}═══════════════════════════════════════════════════════${RESET}`);
console.log('');

for (const agent of AGENTS) {
  if (!agent.privateKey) {
    console.log(`  ${agent.color}[${agent.name}]${RESET} SKIPPED — no private key`);
    continue;
  }

  const env = {
    ...process.env,
    AGENT_PRIVATE_KEY: agent.privateKey,
    AGENT_TYPE: agent.type,
    AGENT_NAME: agent.name,
    SERVER_PORT: String(agent.port),
    DEV_WALLET: agent.devWallet || '',
    ORCHESTRATOR_WALLET: process.env.ORCHESTRATOR_WALLET || '',
    FUJI_RPC_URL: process.env.FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
  };

  const child = spawn('node', [serverScript], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `${agent.color}[${agent.name.padEnd(16)} :${agent.port}]${RESET}`;

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const level = parsed.level?.toUpperCase().padEnd(5) || 'INFO ';
        const msg = parsed.message || line;
        const extra = Object.entries(parsed)
          .filter(([k]) => !['timestamp', 'level', 'agent', 'port', 'message'].includes(k))
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(' ');
        console.log(`${prefix} ${level} ${msg}${extra ? ' ' + extra : ''}`);
      } catch {
        console.log(`${prefix} ${line}`);
      }
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      console.log(`${prefix} \x1b[31mERR\x1b[0m   ${line}`);
    }
  });

  child.on('exit', (code) => {
    console.log(`${prefix} Process exited with code ${code}`);
  });

  children.push({ name: agent.name, child });
  console.log(`  ${agent.color}[${agent.name}]${RESET} started on port ${agent.port} (${agent.type})`);
}

console.log('');
console.log(`${BOLD}  All agents running. Press Ctrl+C to stop all.${RESET}`);
console.log('');
console.log('  Agent Endpoints:');
for (const agent of AGENTS) {
  if (!agent.privateKey) continue;
  console.log(`    ${agent.color}${agent.name.padEnd(18)}${RESET} http://localhost:${agent.port}/agent-card`);
  console.log(`    ${' '.repeat(18)} http://localhost:${agent.port}/x402/receipt`);
  console.log(`    ${' '.repeat(18)} http://localhost:${agent.port}/health`);
}
console.log('');

process.on('SIGINT', () => {
  console.log(`\n${BOLD}  Stopping all agents...${RESET}`);
  for (const { name, child } of children) {
    child.kill('SIGINT');
    console.log(`  Stopped ${name}`);
  }
  setTimeout(() => process.exit(0), 1000);
});
