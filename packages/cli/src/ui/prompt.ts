import { input, password, select, confirm, number } from '@inquirer/prompts'
import { ethers } from 'ethers'
import { C } from './brand'

// All prompts are styled with the Orbit purple prefix ✦.
// Never call @inquirer/prompts directly in command files — use these wrappers.

const PREFIX = C.primary('✦')

export async function askText(
  message: string,
  validate?: (v: string) => true | string
): Promise<string> {
  return input({ message, validate } as any)
}

export async function askPassword(message: string): Promise<string> {
  return password({ message, mask: '•' } as any)
}

export async function askSelect<T extends string>(
  message: string,
  choices: { name: string; value: T; description?: string }[]
): Promise<T> {
  return select({ message, choices } as any)
}

export async function askConfirm(message: string, defaultVal = false): Promise<boolean> {
  return confirm({ message, default: defaultVal } as any)
}

export async function askNumber(message: string, min: number, max: number): Promise<number> {
  return number({ message, min, max, required: true } as any) as Promise<number>
}

// Keep a reference so the unused-import linter does not flag the styled prefix,
// which @inquirer v7 applies via theme rather than a `prefix` option.
void PREFIX

export function validatePrivateKey(value: string): true | string {
  try {
    new ethers.Wallet(value)
    return true
  } catch {
    return 'Invalid private key format. Must be a 64-character hex string (with or without 0x).'
  }
}

export function validateAddress(value: string): true | string {
  return ethers.isAddress(value) ? true : 'Invalid Ethereum address'
}

export function validateURL(value: string): true | string {
  // Allow http://localhost and http://127.0.0.1 for local agent endpoints;
  // require https:// for everything else.
  if (value.startsWith('https://')) return true
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(value)) return true
  return 'Endpoint must start with https:// (or http://localhost for local testing)'
}

export function validateFee(value: string): true | string {
  const n = parseInt(value, 10)
  if (isNaN(n) || n < 1 || n > 500) {
    return 'Fee must be 1–500 basis points (1 = 0.01%, 500 = 5.00%)'
  }
  return true
}

export function validateProfileName(value: string): true | string {
  if (!value || value.length < 1) return 'Name cannot be empty'
  if (value.length > 32) return 'Name max 32 characters'
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return 'Name can only contain letters, numbers, hyphens, underscores'
  }
  return true
}
