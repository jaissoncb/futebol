import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertPublicBundle } from './bundle-security.mjs'

const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.synthetic-signature`
test('allows public keys and rejection code literals', () => {
  assert.doesNotThrow(() => assertPublicBundle(`sb_publishable_synthetic; ${jwt('anon')}; startsWith("sb_secret_"); "service_role"`))
})
test('blocks private keys and privileged/session JWTs without exposing values', () => {
  for (const secret of ['sb_secret_synthetic-not-real', 'service_role_synthetic-not-real', 'const key="service_role"', jwt('service_role'), jwt('authenticated'), jwt('admin'),
    `ghp_${'A'.repeat(36)}`, `github_pat_${'A'.repeat(40)}`, `re_${'A'.repeat(30)}`, '-----BEGIN PRIVATE KEY-----', 'postgres://synthetic:synthetic-password@localhost']) {
    assert.throws(() => assertPublicBundle(`const key="${secret}"`), (error) => {
      assert.ok(error.message.includes('publicação bloqueada'))
      assert.ok(!error.message.includes(secret))
      return true
    })
  }
})
test('ignores malformed JWT-like library text', () => {
  assert.doesNotThrow(() => assertPublicBundle('eyJmalformed.bad-json.synthetic-signature'))
})
