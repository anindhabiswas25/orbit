import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { CredentialManager } from '../credentials/CredentialManager'
import type { AgentProfile } from '../credentials/types'

const TEST_DIR = path.join(os.tmpdir(), '.orbit-test-' + process.pid)

before(() => {
  process.env.ORBIT_HOME = TEST_DIR
})
after(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true })
  delete process.env.ORBIT_HOME
})
beforeEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true })
})

function profile(over: Partial<AgentProfile> = {}): AgentProfile {
  return {
    name: 'TestAgent',
    type: 'scout',
    wallet: '0x1234567890123456789012345678901234567890',
    encryptedKey: '0xabc123deadbeef',
    developerWallet: '0x1234567890123456789012345678901234567890',
    endpoint: 'https://test.xyz',
    fee: 50,
    network: 'fuji',
    registeredAt: new Date().toISOString(),
    registrationTx: '0xtx',
    ...over,
  }
}

test('creates .orbit directory on ensureDirectories', () => {
  CredentialManager.ensureDirectories()
  assert.equal(fs.existsSync(TEST_DIR), true)
})

test('returns empty file when credentials.json does not exist', () => {
  const file = CredentialManager.read()
  assert.deepEqual(file.agents, {})
  assert.equal(file.default, null)
})

test('saves a profile with an encrypted key', () => {
  CredentialManager.saveProfile(profile(), 'mypassword')
  const file = CredentialManager.read()
  assert.ok(file.agents['TestAgent'])
  assert.notEqual(file.agents['TestAgent']!.encryptedKey, '0xabc123deadbeef')
  assert.match(file.agents['TestAgent']!.encryptedKey, /^enc:v1:/)
})

test('loads and decrypts a profile with the correct password', () => {
  CredentialManager.saveProfile(profile({ encryptedKey: '0xdeadbeef1234' }), 'mypassword')
  const loaded = CredentialManager.loadProfile('TestAgent', 'mypassword')
  assert.equal(loaded.encryptedKey, '0xdeadbeef1234')
})

test('throws on wrong password', () => {
  CredentialManager.saveProfile(profile(), 'rightpassword')
  assert.throws(
    () => CredentialManager.loadProfile('TestAgent', 'wrongpassword'),
    /Wrong password or corrupted credential file/
  )
})

test('throws if profile name already exists', () => {
  CredentialManager.saveProfile(profile({ name: 'Dup' }), 'pw')
  assert.throws(() => CredentialManager.saveProfile(profile({ name: 'Dup' }), 'pw'), /already exists/)
})

test('sets the first saved profile as default', () => {
  CredentialManager.saveProfile(profile({ name: 'First', type: 'executor' }), 'pw')
  assert.equal(CredentialManager.getDefault(), 'First')
})

test('listProfiles never exposes the encrypted key', () => {
  CredentialManager.saveProfile(profile(), 'pw')
  const list = CredentialManager.listProfiles()
  assert.equal(list.length, 1)
  assert.equal('encryptedKey' in list[0]!, false)
})

test('removeProfile reassigns default', () => {
  CredentialManager.saveProfile(profile({ name: 'A' }), 'pw')
  CredentialManager.saveProfile(profile({ name: 'B', wallet: '0x' + '2'.repeat(40) }), 'pw')
  CredentialManager.removeProfile('A')
  assert.equal(CredentialManager.getDefault(), 'B')
})
