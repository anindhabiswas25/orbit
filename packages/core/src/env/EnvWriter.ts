import * as fs from 'fs'
import * as path from 'path'
import { ethers } from 'ethers'
import type { AgentType } from '../types'

/**
 * Writes registered agent keys into the Orbit repo's `.env` so the agent
 * process runners (e.g. scripts/run-4-agents.js) can launch them.
 *
 * Slots are fixed to match run-4-agents.js:
 *   scout    -> SCOUT1_*    / SCOUT2_*
 *   executor -> EXECUTOR1_* / EXECUTOR2_*
 *
 * Re-registering the same wallet updates its existing slot in place rather
 * than consuming a new one.
 */

export interface EnvAgentSlot {
  type: AgentType
  wallet: string
  privateKey: string
  developerWallet: string
}

export interface EnvWriteResult {
  slotName: string // e.g. "SCOUT1"
  path: string
  action: 'created' | 'updated'
}

const MANAGED_HEADER = '# ── Agent Wallets (managed by `orbit setup` / `orbit import`) ──'

/** Locate the repo `.env`. Honours ORBIT_ENV_PATH; otherwise walks up to a repo marker. */
export function resolveEnvPath(): string {
  if (process.env.ORBIT_ENV_PATH) return process.env.ORBIT_ENV_PATH

  const markers = ['deployed-addresses.json', 'hardhat.config.js']
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    if (markers.some((m) => fs.existsSync(path.join(dir, m)))) {
      return path.join(dir, '.env')
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.join(process.cwd(), '.env')
}

/** Read a value from process.env, falling back to the repo `.env` file. */
export function readEnvValue(name: string, envPath: string = resolveEnvPath()): string | undefined {
  if (process.env[name]) return process.env[name]
  if (!fs.existsSync(envPath)) return undefined
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  const idx = lines.findIndex((l) => lineMatcher(name).test(l))
  if (idx < 0) return undefined
  const v = lines[idx]!.slice(lines[idx]!.indexOf('=') + 1).trim()
  return v || undefined
}

function normalizeKey(key: string): string {
  const k = key.trim()
  return k.startsWith('0x') ? k : '0x' + k
}

function addressFromKey(key: string): string | null {
  try {
    return new ethers.Wallet(normalizeKey(key)).address.toLowerCase()
  } catch {
    return null
  }
}

function lineMatcher(name: string): RegExp {
  return new RegExp(`^\\s*${name}\\s*=`)
}

export function syncAgentToEnv(slot: EnvAgentSlot, envPath: string = resolveEnvPath()): EnvWriteResult {
  const prefix = slot.type === 'scout' ? 'SCOUT' : 'EXECUTOR'
  const targetAddr = slot.wallet.toLowerCase()

  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : []

  const getVal = (name: string): string => {
    const idx = lines.findIndex((l) => lineMatcher(name).test(l))
    if (idx < 0) return ''
    const eq = lines[idx]!.indexOf('=')
    return lines[idx]!.slice(eq + 1).trim()
  }

  const setVal = (name: string, value: string): void => {
    const idx = lines.findIndex((l) => lineMatcher(name).test(l))
    if (idx >= 0) {
      lines[idx] = `${name}=${value}`
      return
    }
    // Append under a managed header (created once).
    if (!lines.some((l) => l.trim() === MANAGED_HEADER)) {
      if (lines.length > 0 && lines[lines.length - 1]!.trim() !== '') lines.push('')
      lines.push(MANAGED_HEADER)
    }
    lines.push(`${name}=${value}`)
  }

  // 1) Reuse the slot already holding this wallet, if any.
  let chosen = 0
  for (const n of [1, 2]) {
    const existing = getVal(`${prefix}${n}_PRIVATE_KEY`)
    if (existing && addressFromKey(existing) === targetAddr) {
      chosen = n
      break
    }
  }
  // 2) Otherwise take the first empty slot.
  if (!chosen) {
    for (const n of [1, 2]) {
      if (!getVal(`${prefix}${n}_PRIVATE_KEY`)) {
        chosen = n
        break
      }
    }
  }
  // 3) Both slots full with other wallets — overwrite slot 2.
  const action: EnvWriteResult['action'] = chosen ? 'updated' : 'created'
  if (!chosen) chosen = 2

  setVal(`${prefix}${chosen}_PRIVATE_KEY`, normalizeKey(slot.privateKey))
  setVal(`${prefix}${chosen}_DEV_WALLET`, slot.developerWallet)

  fs.writeFileSync(envPath, lines.join('\n'), { mode: 0o600 })

  return { slotName: `${prefix}${chosen}`, path: envPath, action }
}
