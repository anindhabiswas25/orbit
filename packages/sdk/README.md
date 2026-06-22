# @orbit/sdk

The programmatic version of the Orbit CLI. Register, run, and monitor agents from
your own Node.js / TypeScript application. Fully typed — no `any` in the public
surface.

```bash
npm install @orbit/sdk
```

## Register a new agent

```typescript
import { OrbitSDK } from '@orbit/sdk'

const sdk = new OrbitSDK()

// Scout — no fee, no stake. Pass registryOwnerKey to auto-authorize it to post APYs.
const scout = await sdk.setup({
  name:             'Marlin',
  type:             'scout',
  privateKey:       process.env.AGENT_KEY!,
  password:         process.env.ORBIT_PASSWORD!,
  developerWallet:  '0xYourPayoutWallet...',
  endpoint:         'https://my-scout.xyz/agent-card',
  registryOwnerKey: process.env.REGISTRY_OWNER_KEY, // optional — auto-authorizes the scout
  onProgress:       (step) => console.log('setup:', step),
})

console.log('Registered:', scout.wallet)
console.log('Can scout?:', await scout.isScoutAuthorized())

// Executor — carries a 1–500 bps fee and a 5 USDC stake.
const executor = await sdk.setup({
  name:            'Otter',
  type:            'executor',
  privateKey:      process.env.EXEC_KEY!,
  password:        process.env.ORBIT_PASSWORD!,
  developerWallet: '0xYourPayoutWallet...',
  endpoint:        'https://my-exec.xyz/agent-card',
  fee:             50, // basis points (executors only)
})
```

## Import an already-registered agent

```typescript
const agent = await sdk.import({
  name:       'Marlin',
  privateKey: process.env.AGENT_KEY!,
  password:   process.env.ORBIT_PASSWORD!,
})
```

## Run a saved agent

```typescript
import { OrbitSDK } from '@orbit/sdk'

const agent = await OrbitSDK.load('Marlin', process.env.ORBIT_PASSWORD!)

const handle = await agent.run({
  onJobAssigned:  (job) => logger.info('assigned', job),
  onJobCompleted: (job) => logger.info('done', { earned: job.payment }),
  onJobExpired:   (job) => logger.warn('expired', job),
  onRebalance:    (ev)  => metrics.gauge('orbit.apy', ev.toAPY),
  onReputation:   (ev)  => alerts.notify(`Rep now: ${ev.newScore}`),
  onError:        (err) => logger.error('agent error', err),
})

// later
await handle.stop()
```

The same `~/.orbit/credentials.json` is shared with `@orbit/cli`, so a profile
created with `orbit setup` can be loaded with `OrbitSDK.load(...)` and vice versa.

## API

### `OrbitSDK`
- `new OrbitSDK({ rpcUrl? })`
- `setup(options): Promise<AgentClient>` — scouts: omit `fee`; pass `registryOwnerKey` to auto-authorize
- `import(options): Promise<AgentClient>` — load an already-registered agent by private key
- `static authorizeScout(registryOwnerKey, scoutWallet, rpcUrl?): Promise<string | null>`
- `static load(name, password): Promise<AgentClient>`
- `static listAgents(): string[]`
- `static getDefault(): string` / `static setDefault(name)`

### `AgentClient`
- `run(callbacks): Promise<AgentHandle>`
- `isScoutAuthorized(): Promise<boolean>` — for scouts, whether it may post APYs
- `getStatus(): Promise<AgentInfo>`
- `getVaultStatus(): Promise<VaultStatus>`
- `getRecentJobs(limit?): Promise<JobRecord[]>`
- `getEarnings(): Promise<EarningsSummary>`
- `getProtocols(): Promise<Protocol[]>`
- `deregister(removeCredentials?, onStep?): Promise<string>`

### `AgentHandle`
- `isRunning: boolean`
- `pause()` / `resume()` / `stop()`
- `getStatus(): Promise<AgentInfo>`

## Network

Avalanche Fuji C-Chain (chain ID `43113`). Addresses and ABIs are bundled; pass a
custom `rpcUrl` to `OrbitSDK` or per profile via `setup({ rpcUrl })`.
