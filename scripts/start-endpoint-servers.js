const http = require('http');

const agents = [
  { name: 'Scout1',    type: 'scout',    port: 4001 },
  { name: 'Scout2',    type: 'scout',    port: 4002 },
  { name: 'Executor1', type: 'executor', port: 4003 },
  { name: 'Executor2', type: 'executor', port: 4004 },
];

for (const agent of agents) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Orbit-Version');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (req.method === 'GET' && req.url === '/agent-card') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: agent.name,
        type: agent.type,
        chain: 'avalanche-fuji',
        chainId: 43113,
        endpoints: {
          receipt: `http://localhost:${agent.port}/x402/receipt`,
          health: `http://localhost:${agent.port}/health`,
        },
        protocol: 'orbit/1.0',
      }, null, 2));
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ready', agent: agent.name, type: agent.type, port: agent.port }));
      return;
    }

    if (req.method === 'POST' && req.url === '/x402/receipt') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      });
      return;
    }

    res.writeHead(404); res.end();
  });

  server.listen(agent.port, () => {
    console.log(`[endpoint] ${agent.name} (${agent.type}) → http://localhost:${agent.port}/agent-card`);
  });
}

console.log('\nAll 4 agent endpoint servers running. Use these URLs in orbit setup:');
console.log('  Scout1:    http://localhost:4001/agent-card');
console.log('  Scout2:    http://localhost:4002/agent-card');
console.log('  Executor1: http://localhost:4003/agent-card');
console.log('  Executor2: http://localhost:4004/agent-card');
console.log('\nPress Ctrl+C to stop.\n');
