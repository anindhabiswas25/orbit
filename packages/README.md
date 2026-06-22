# Orbit Agent Tools — `@orbit/cli` + `@orbit/sdk`

npm workspace monorepo for the Orbit Protocol agent tooling. Three packages:

| Package | Published | Purpose |
|---|---|---|
| `@orbit/core` | no (`private`) | Shared logic: credentials, chain client, agent loop, registration. |
| `@orbit/cli` | yes | Global `orbit` terminal command. |
| `@orbit/sdk` | yes | Importable TypeScript library. |

Both CLI and SDK read the same `~/.orbit/credentials.json` and call into
`@orbit/core` — there is exactly one implementation of the scout loop, executor
loop, chain reader, and credential manager.

## Build

From the repo root:

```bash
npm install                # links workspaces (packages/*)
npm run build:packages     # builds core → cli → sdk in dependency order
npm run test:packages      # runs @orbit/core unit tests (node:test)
```

Per package:

```bash
npm run build -w @orbit/core
npm run build -w @orbit/cli
npm run build -w @orbit/sdk
```

## Local CLI testing

```bash
npm run build:packages
node packages/cli/dist/index.js --help
# or link globally:
cd packages/cli && npm link && orbit --help
```

## Layout

```
packages/
├── core/   @orbit/core  — credentials/ chain/ agent/ registration/ utils/ types/
├── cli/    @orbit/cli   — ui/ (brand, spinner, progress, prompt, dashboard) + commands/
└── sdk/    @orbit/sdk   — OrbitSDK, AgentClient, AgentHandle
```

## Updating bundled addresses

After a contract redeploy, edit `packages/core/src/chain/FujiAddresses.ts` (or set
the `ORBIT_*` env vars), bump versions, then `npm run build:packages && npm publish`
each public package. Addresses currently mirror the live Fuji deployment in
`/deployed-addresses.json`.
