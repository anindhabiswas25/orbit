import { AgentType } from '../types'

export interface AgentProfile {
  /** Human-readable label. Unique within the credential file. */
  name: string

  /** 'scout' or 'executor' */
  type: AgentType

  /** Public wallet address (0x...) — used for display and filtering events. */
  wallet: string

  /**
   * AES-256-GCM encrypted private key on disk.
   * Format: enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
   * NOTE: when returned from CredentialManager.loadProfile() this field holds the
   * DECRYPTED raw private key, not the ciphertext.
   */
  encryptedKey: string

  /** Wallet address that receives USDC job payments via FeePool. */
  developerWallet: string

  /** HTTPS URL serving agent card JSON. */
  endpoint: string

  /** Fee per successful job in basis points (1–500). */
  fee: number

  /** Network identifier — always 'fuji' for testnet builds. */
  network: 'fuji'

  /** ISO 8601 timestamp of on-chain registration. */
  registeredAt: string

  /** Transaction hash of AgentRegistry.register() call. */
  registrationTx: string

  /** Optional custom RPC URL. Falls back to package default if absent. */
  rpcUrl?: string
}

export interface CredentialFile {
  /** Format version — increment when schema changes. */
  version: '1'

  /** Name of the default agent (used when --agent flag is omitted). */
  default: string | null

  /** Map of profile name → profile data. */
  agents: Record<string, AgentProfile>
}
