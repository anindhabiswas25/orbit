import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Encryptor } from '../credentials/Encryptor'

const plaintext = '0xdeadbeefcafebabedeadbeefcafebabe12345678cafebabedeadbeefcafebabe'
const password = 'test-password-123'
const salt = '0x1234567890123456789012345678901234567890'

test('Encryptor: encrypts to enc:v1: prefix format', () => {
  const enc = Encryptor.encrypt(plaintext, password, salt)
  assert.match(enc, /^enc:v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/)
})

test('Encryptor: decrypt(encrypt(x)) === x', () => {
  const enc = Encryptor.encrypt(plaintext, password, salt)
  assert.equal(Encryptor.decrypt(enc, password, salt), plaintext)
})

test('Encryptor: different passwords produce different ciphertexts', () => {
  const enc1 = Encryptor.encrypt(plaintext, 'pw1aaaaa', salt)
  const enc2 = Encryptor.encrypt(plaintext, 'pw2bbbbb', salt)
  assert.notEqual(enc1, enc2)
})

test('Encryptor: throws on wrong password during decrypt', () => {
  const enc = Encryptor.encrypt(plaintext, password, salt)
  assert.throws(
    () => Encryptor.decrypt(enc, 'wrongpassword', salt),
    /Wrong password or corrupted credential file/
  )
})

test('Encryptor: throws on invalid format', () => {
  assert.throws(() => Encryptor.decrypt('not-encrypted', password, salt), /Invalid encrypted key format/)
})
