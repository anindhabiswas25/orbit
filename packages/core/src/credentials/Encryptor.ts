import * as crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16 // 128 bits
const SALT_ROUNDS = 100_000
const PREFIX = 'enc:v1:'

export class Encryptor {
  /**
   * Derive a 256-bit key from the user's password using PBKDF2.
   * Salt is the agent's wallet address (public, deterministic, unique per agent),
   * so the same password produces different keys for different agents.
   */
  private static deriveKey(password: string, salt: string): Buffer {
    return crypto.pbkdf2Sync(password, salt, SALT_ROUNDS, KEY_LENGTH, 'sha256')
  }

  /**
   * Encrypt a private key string.
   * @returns enc:v1:<iv>:<tag>:<ciphertext>
   */
  static encrypt(plaintext: string, password: string, salt: string): string {
    const key = Encryptor.deriveKey(password, salt)
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    return PREFIX + iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex')
  }

  /**
   * Decrypt a private key.
   * @throws If the password is wrong or the data is corrupted.
   */
  static decrypt(encryptedStr: string, password: string, salt: string): string {
    if (!encryptedStr.startsWith(PREFIX)) {
      throw new Error('Invalid encrypted key format')
    }

    const parts = encryptedStr.slice(PREFIX.length).split(':')
    if (parts.length !== 3) throw new Error('Invalid encrypted key format')

    const [ivHex, tagHex, ciphertextHex] = parts as [string, string, string]
    const key = Encryptor.deriveKey(password, salt)
    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const ciphertext = Buffer.from(ciphertextHex, 'hex')

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)

    try {
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return decrypted.toString('utf8')
    } catch {
      throw new Error('Wrong password or corrupted credential file')
    }
  }
}
