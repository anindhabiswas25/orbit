import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { CredentialFile, AgentProfile } from './types'
import { Encryptor } from './Encryptor'
import { UserError, FatalError } from '../errors'

/**
 * Resolve the Orbit home directory. Honours ORBIT_HOME for tests and custom
 * setups; defaults to ~/.orbit.
 */
function orbitDir(): string {
  return process.env.ORBIT_HOME || path.join(os.homedir(), '.orbit')
}

const EMPTY_FILE: CredentialFile = {
  version: '1',
  default: null,
  agents: {},
}

export class CredentialManager {
  /** Ensure ~/.orbit/ and ~/.orbit/logs/ exist with correct permissions. */
  static ensureDirectories(): void {
    const dir = orbitDir()
    const logs = path.join(dir, 'logs')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (!fs.existsSync(logs)) fs.mkdirSync(logs, { recursive: true, mode: 0o700 })
  }

  /** Read the credential file. Returns an empty structure if it doesn't exist. */
  static read(): CredentialFile {
    const file = CredentialManager.credFilePath
    if (!fs.existsSync(file)) return { ...EMPTY_FILE, agents: {} }
    try {
      const raw = fs.readFileSync(file, 'utf8')
      return JSON.parse(raw) as CredentialFile
    } catch {
      throw new FatalError(`Cannot read credential file at ${file}. File may be corrupted.`)
    }
  }

  /** Write credential file atomically (temp file, then rename). */
  static write(data: CredentialFile): void {
    CredentialManager.ensureDirectories()
    const file = CredentialManager.credFilePath
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, file)
  }

  /**
   * Save a new agent profile. The `encryptedKey` field is expected to hold the
   * RAW private key on input — it is encrypted before persisting.
   * @throws UserError if the name already exists.
   */
  static saveProfile(profile: AgentProfile, password: string): void {
    const file = CredentialManager.read()
    if (file.agents[profile.name]) {
      throw new UserError(
        `Agent profile "${profile.name}" already exists. Use a different name or run orbit import.`
      )
    }
    const encrypted: AgentProfile = {
      ...profile,
      encryptedKey: Encryptor.encrypt(profile.encryptedKey, password, profile.wallet),
    }
    file.agents[profile.name] = encrypted
    if (!file.default) file.default = profile.name
    CredentialManager.write(file)
  }

  /**
   * Load a profile and decrypt its private key. The returned profile's
   * `encryptedKey` field holds the DECRYPTED raw key.
   */
  static loadProfile(name: string, password: string): AgentProfile {
    const file = CredentialManager.read()
    const profile = file.agents[name]
    if (!profile) {
      const available = Object.keys(file.agents).join(', ')
      throw new UserError(
        `Agent "${name}" not found in credential file.\n` +
          `Available agents: ${available || 'none — run orbit setup first'}`
      )
    }
    const rawKey = Encryptor.decrypt(profile.encryptedKey, password, profile.wallet)
    return { ...profile, encryptedKey: rawKey }
  }

  /** List all saved profile names. */
  static listNames(): string[] {
    return Object.keys(CredentialManager.read().agents)
  }

  /** Get all profiles (without decrypting keys — safe to display). */
  static listProfiles(): Omit<AgentProfile, 'encryptedKey'>[] {
    const file = CredentialManager.read()
    return Object.values(file.agents).map(({ encryptedKey: _ignored, ...rest }) => rest)
  }

  /** Set the default agent name. */
  static setDefault(name: string): void {
    const file = CredentialManager.read()
    if (!file.agents[name]) throw new UserError(`Agent "${name}" not found`)
    file.default = name
    CredentialManager.write(file)
  }

  /** Get the default agent name. @throws UserError if none set. */
  static getDefault(): string {
    const file = CredentialManager.read()
    if (!file.default) {
      throw new UserError('No default agent set. Use orbit switch <name> or the --agent flag.')
    }
    return file.default
  }

  /** Remove a profile from the credential file. */
  static removeProfile(name: string): void {
    const file = CredentialManager.read()
    if (!file.agents[name]) throw new UserError(`Agent "${name}" not found`)
    delete file.agents[name]
    if (file.default === name) {
      const remaining = Object.keys(file.agents)
      file.default = remaining.length > 0 ? remaining[0]! : null
    }
    CredentialManager.write(file)
  }

  static get credFilePath(): string {
    return path.join(orbitDir(), 'credentials.json')
  }

  static get logDir(): string {
    return path.join(orbitDir(), 'logs')
  }
}
