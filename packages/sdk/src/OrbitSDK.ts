import { ethers } from 'ethers'
import {
  CredentialManager,
  ChainClient,
  PreflightCheck,
  Registrar,
  FUJI_RPC_URL,
  UserError,
  type AgentProfile,
  type AgentType,
} from '@orbit/core'
import { AgentClient } from './AgentClient'

export type SetupStep =
  | 'validating'
  | 'preflight'
  | 'approving'
  | 'registering'
  | 'authorizing'
  | 'saving'
  | 'done'

export interface SetupOptions {
  /** Human-readable profile name. Must be unique in ~/.orbit/credentials.json. */
  name: string
  /** 'scout' or 'executor'. */
  type: AgentType
  /** Raw private key (0x...). Encrypted before saving. */
  privateKey: string
  /** Password used to encrypt the private key at rest. */
  password: string
  /** Wallet address that receives USDC job payments. */
  developerWallet: string
  /** HTTPS URL serving agent card JSON (http://localhost allowed for local testing). */
  endpoint: string
  /**
   * Fee per successful job in basis points (1–500). Ignored for scouts —
   * scouting is free, so it may be omitted or 0 when `type: 'scout'`.
   */
  fee?: number
  /** Optional custom RPC URL. Falls back to the public Fuji endpoint. */
  rpcUrl?: string
  /**
   * Optional YieldRegistry owner key. When registering a scout, this auto-authorizes
   * the scout to post APY results (owner-only on-chain action). Without it, the scout
   * is registered but must be authorized separately before it can scout — check with
   * `AgentClient.isScoutAuthorized()`.
   */
  registryOwnerKey?: string
  /** Progress callback — called at each registration step. */
  onProgress?: (step: SetupStep, detail?: string) => void
}

export interface ImportOptions {
  /** Human-readable profile name. Must be unique in ~/.orbit/credentials.json. */
  name: string
  /** Raw private key (0x...) of an already-registered agent. Encrypted before saving. */
  privateKey: string
  /** Password used to encrypt the private key at rest. */
  password: string
  /** Wallet that receives USDC payments. Defaults to the agent's own wallet. */
  developerWallet?: string
  /** Agent card endpoint, if known. Defaults to 'unknown'. */
  endpoint?: string
  /** Optional custom RPC URL. Falls back to the public Fuji endpoint. */
  rpcUrl?: string
}

export class OrbitSDK {
  private rpcUrl: string

  constructor(options: { rpcUrl?: string } = {}) {
    this.rpcUrl = options.rpcUrl ?? FUJI_RPC_URL
  }

  /**
   * Register a new agent on Orbit and save credentials locally.
   * Validates → preflight → approve 5 USDC → register() → save credentials.
   * @returns AgentClient ready for .run()
   */
  async setup(opts: SetupOptions): Promise<AgentClient> {
    opts.onProgress?.('validating')
    this.validate(opts)

    // Scouts have no fee — normalize to 0 regardless of what was passed.
    const fee = opts.type === 'scout' ? 0 : opts.fee!

    const client = new ChainClient(opts.privateKey, opts.rpcUrl ?? this.rpcUrl)

    opts.onProgress?.('preflight')
    // Pass the agent type so scouts are not blocked on the 5-USDC stake check.
    const preflight = await PreflightCheck.run(client, opts.name, opts.type)
    if (!preflight.ok) {
      throw new UserError(`Preflight failed:\n${preflight.errors.join('\n')}`)
    }

    const result = await Registrar.register(
      client,
      {
        type: opts.type,
        endpoint: opts.endpoint,
        fee,
        developerWallet: opts.developerWallet,
      },
      (step, txHash) => {
        if (step === 'approving') opts.onProgress?.('approving', txHash)
        if (step === 'registering') opts.onProgress?.('registering', txHash)
        if (step === 'done') opts.onProgress?.('saving', txHash)
      }
    )

    // Scouts must be authorized in YieldRegistry before they can post APY results.
    // This is an owner-only action — only attempt it if the caller supplied the
    // registry owner key. Otherwise the scout is registered but not yet authorized.
    if (opts.type === 'scout' && opts.registryOwnerKey) {
      opts.onProgress?.('authorizing')
      const authTx = await Registrar.authorizeScout(
        opts.registryOwnerKey,
        client.wallet.address,
        opts.rpcUrl ?? this.rpcUrl
      )
      if (authTx) opts.onProgress?.('authorizing', authTx)
    }

    const profile: AgentProfile = {
      name: opts.name,
      type: opts.type,
      wallet: client.wallet.address,
      encryptedKey: opts.privateKey, // CredentialManager encrypts on save
      developerWallet: opts.developerWallet,
      endpoint: opts.endpoint,
      fee,
      network: 'fuji',
      registeredAt: new Date().toISOString(),
      registrationTx: result.registerTx,
      ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    }

    CredentialManager.saveProfile(profile, opts.password)
    opts.onProgress?.('done', result.registerTx)

    return new AgentClient(profile, client)
  }

  /**
   * Import an already-registered agent into ~/.orbit/credentials.json from its
   * private key. Verifies the wallet is registered on-chain before saving.
   * Programmatic equivalent of `orbit import`.
   * @returns AgentClient ready for .run()
   */
  async import(opts: ImportOptions): Promise<AgentClient> {
    if (!opts.name || !/^[a-zA-Z0-9_-]+$/.test(opts.name)) {
      throw new UserError('name must be alphanumeric (letters, numbers, hyphens, underscores)')
    }
    if (!opts.password || opts.password.length < 8) {
      throw new UserError('password must be at least 8 characters')
    }
    let wallet: ethers.Wallet
    try {
      wallet = new ethers.Wallet(opts.privateKey)
    } catch {
      throw new UserError('privateKey is not a valid Ethereum private key')
    }
    if (CredentialManager.listNames().includes(opts.name)) {
      throw new UserError(`Profile "${opts.name}" already exists`)
    }

    const client = new ChainClient(opts.privateKey, opts.rpcUrl ?? this.rpcUrl)
    const info = await Registrar.verifyExisting(client) // throws if not registered

    const profile: AgentProfile = {
      name: opts.name,
      type: info.type,
      wallet: wallet.address,
      encryptedKey: opts.privateKey,
      developerWallet: opts.developerWallet ?? wallet.address,
      endpoint: opts.endpoint ?? 'unknown',
      fee: 0,
      network: 'fuji',
      registeredAt: new Date().toISOString(),
      registrationTx: 'imported',
      ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    }
    CredentialManager.saveProfile(profile, opts.password)
    return new AgentClient(profile, client)
  }

  /**
   * Authorize a scout in YieldRegistry so it can post APY results. Owner-only —
   * `registryOwnerKey` must be the YieldRegistry owner's key, not the scout's.
   * @returns tx hash, or null if the scout was already authorized.
   */
  static async authorizeScout(
    registryOwnerKey: string,
    scoutWallet: string,
    rpcUrl?: string
  ): Promise<string | null> {
    return Registrar.authorizeScout(registryOwnerKey, scoutWallet, rpcUrl)
  }

  /**
   * Load a saved agent profile by name and return an AgentClient.
   */
  static async load(name: string, password: string): Promise<AgentClient> {
    const profile = CredentialManager.loadProfile(name, password)
    const client = new ChainClient(profile.encryptedKey, profile.rpcUrl)
    return new AgentClient(profile, client)
  }

  /** List all saved agent profile names (does not decrypt any keys). */
  static listAgents(): string[] {
    return CredentialManager.listNames()
  }

  /** Get the current default agent name. */
  static getDefault(): string {
    return CredentialManager.getDefault()
  }

  /** Set the default agent. */
  static setDefault(name: string): void {
    CredentialManager.setDefault(name)
  }

  private validate(opts: SetupOptions): void {
    if (!opts.name || !/^[a-zA-Z0-9_-]+$/.test(opts.name)) {
      throw new UserError('name must be alphanumeric (letters, numbers, hyphens, underscores)')
    }
    if (!['scout', 'executor'].includes(opts.type)) {
      throw new UserError('type must be "scout" or "executor"')
    }
    try {
      new ethers.Wallet(opts.privateKey)
    } catch {
      throw new UserError('privateKey is not a valid Ethereum private key')
    }
    if (!opts.password || opts.password.length < 8) {
      throw new UserError('password must be at least 8 characters')
    }
    if (!ethers.isAddress(opts.developerWallet)) {
      throw new UserError('developerWallet is not a valid Ethereum address')
    }
    // Allow https:// everywhere, plus http://localhost / 127.0.0.1 for local testing.
    const localOk = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(opts.endpoint)
    if (!opts.endpoint.startsWith('https://') && !localOk) {
      throw new UserError('endpoint must start with https:// (or http://localhost for local testing)')
    }
    // Scouts have no fee; only executors carry a 1–500 bps fee.
    if (opts.type === 'executor') {
      if (opts.fee === undefined || opts.fee < 1 || opts.fee > 500) {
        throw new UserError('fee must be 1–500 basis points for executor agents')
      }
    }
  }
}
