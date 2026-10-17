import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { AuthenticationError, createTokenValidator, validatePolicy } from '../auth.ts'

const policy = { issuer: 'https://issuer.test', jwksUri: 'https://issuer.test/.well-known/jwks',
  audience: 'urn:futebol:fixture:api', clientId: 'fixture-client', maxLifetimeSeconds: 900 }
const keys = await generateKeyPair('RS256')
const publicKey = { ...await exportJWK(keys.publicKey), kid: 'fixture-1', alg: 'RS256', use: 'sig' }
const local = createLocalJWKSet({ keys: [publicKey] })
const now = Math.floor(Date.now() / 1000)
// Synthetic claim only: never used by runtime, never claimed to be Kinde's contract.
const verify = createTokenValidator(policy, claims => Promise.resolve(claims.fixture_kind === 'user_access'), local)
async function token(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  return new SignJWT({ iss: policy.issuer, aud: policy.audience, sub: 'fixture-user', azp: policy.clientId,
    iat: now, exp: now + 600, fixture_kind: 'user_access', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture-1', ...header }).sign(keys.privateKey)
}
void test('RS256 access fixture and audience array accepted only with positive proof', async () => {
  for (const aud of [policy.audience, ['other-api', policy.audience]]) {
    assert.deepEqual(await verify(`Bearer ${await token({ aud })}`), { issuer: policy.issuer, subject: 'fixture-user' })
  }
})
void test('default principal interface rejects even cryptographically valid user fixture', async () => {
  const closed = createTokenValidator(policy, undefined, local)
  await assert.rejects(closed(`Bearer ${await token()}`), AuthenticationError)
})
const negatives: [string, Record<string, unknown>][] = [
  ['issuer', { iss: 'https://other.test' }], ['audience', { aud: 'other' }],
  ['azp', { azp: 'another-client' }], ['missing azp', { azp: undefined }],
  ['ID', { aud: policy.clientId, fixture_kind: 'id' }], ['unproven principal', { fixture_kind: undefined }],
  ['M2M array', { gty: ['client_credentials'] }], ['M2M string', { gty: 'client_credentials' }],
  ['unknown grant shape', { gty: {} }], ['unknown grant array', { gty: [42] }],
  ['expired', { iat: now - 600, exp: now - 60 }], ['missing exp', { exp: undefined }],
  ['future iat', { iat: now + 60, exp: now + 600 }], ['missing iat', { iat: undefined }],
  ['future nbf', { nbf: now + 60 }], ['nbf after exp', { nbf: now + 601 }],
  ['lifetime', { exp: now + 901 }], ['exp before iat', { exp: now - 1 }],
  ['empty sub', { sub: '' }], ['missing sub', { sub: undefined }], ['control sub', { sub: 'a\nb' }],
  ['missing audience', { aud: undefined }], ['missing issuer', { iss: undefined }],
]
for (const [name, claims] of negatives) void test(`reject ${name}`, async () => {
  await assert.rejects(verify(`Bearer ${await token(claims)}`), AuthenticationError)
})
for (const [name, header] of [
  ['unknown kid', { kid: 'unknown' }], ['missing kid', { kid: undefined }],
  ['jku SSRF', { jku: 'https://attacker.test/jwks' }], ['inline jwk', { jwk: publicKey }],
] as const) void test(`reject ${name}`, async () => {
  await assert.rejects(verify(`Bearer ${await token({}, header)}`), AuthenticationError)
})
void test('reject altered signature, none, HS256 and malformed Authorization', async () => {
  const signed = await token()
  const parts = signed.split('.')
  const signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1
  const mutated = `${parts[0]}.${parts[1]}.${signature.toString('base64url')}`
  const hmac = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: 'fixture-1' }).sign(new Uint8Array(32))
  for (const value of [undefined, '', `bearer ${signed}`, `Bearer ${signed} extra`, `Bearer ${mutated}`,
    `Bearer ${hmac}`, 'Bearer eyJhbGciOiJub25lIn0.e30.']) {
    await assert.rejects(verify(value), AuthenticationError)
  }
})
void test('reject token-controlled trust roots and API audience equal to client ID', () => {
  for (const override of [{ jwksUri: 'https://evil.test/jwks' }, { issuer: 'http://issuer.test' },
    { audience: policy.clientId }, { maxLifetimeSeconds: 0 }]) assert.throws(() => validatePolicy({ ...policy, ...override }))
})
void test('key rotation accepts new fixed-source key and rejects removed key', async () => {
  const rotated = await generateKeyPair('RS256')
  const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(rotated.publicKey), kid: 'fixture-2', alg: 'RS256' }] })
  const rotatedVerify = createTokenValidator(policy, () => Promise.resolve(true), resolver)
  const jwt = await new SignJWT({ iss: policy.issuer, aud: policy.audience, azp: policy.clientId,
    sub: 'fixture', iat: now, exp: now + 600 }).setProtectedHeader({ alg: 'RS256', kid: 'fixture-2' }).sign(rotated.privateKey)
  assert.equal((await rotatedVerify(`Bearer ${jwt}`)).subject, 'fixture')
  await assert.rejects(rotatedVerify(`Bearer ${await token()}`), AuthenticationError)
})
