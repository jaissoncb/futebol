import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createTokenValidator } from '../auth.ts'
import { createApi } from '../server.ts'

void test('real local HTTP: JWT rejection precedes all DB calls; CORS, no-store and payload boundary', async t => {
  const keys = await generateKeyPair('RS256')
  const policy = { issuer: 'https://fixture.test', jwksUri: 'https://fixture.test/jwks', audience: 'fixture-api',
    clientId: 'fixture-client', maxLifetimeSeconds: 900 }
  let dispatched = 0
  const server = createApi({
    authenticate: createTokenValidator(policy, p => Promise.resolve(p.fixture_kind === 'user_access'), createLocalJWKSet({
      keys: [{ ...await exportJWK(keys.publicKey), kid: 'test', alg: 'RS256' }],
    })),
    dispatch: () => { dispatched++; return Promise.resolve({ id: 'fixture-internal-uuid' }) },
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const now = Math.floor(Date.now() / 1000)
  async function sign(claims: Record<string, unknown> = {}) {
    return new SignJWT({ iss: policy.issuer, aud: policy.audience, azp: policy.clientId, sub: 'fixture',
      iat: now, exp: now + 600, fixture_kind: 'user_access', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(keys.privateKey)
  }
  for (const claims of [{ iss: 'https://other.test' }, { aud: 'other' }, { azp: 'other' },
    { fixture_kind: 'id' }, { gty: ['client_credentials'] }, { exp: now - 60 }, { nbf: now + 60 }]) {
    const result = await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${await sign(claims)}` } })
    assert.equal(result.status, 401); assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await result.json(), { error: 'invalid_access_token' })
  }
  assert.equal(dispatched, 0)
  const auth = { Authorization: `Bearer ${await sign()}`, 'Content-Type': 'application/json' }
  assert.equal((await fetch(`${base}/me`, { headers: { ...auth, Origin: 'https://evil.test' } })).status, 403)
  assert.equal((await fetch(`${base}/me`, { method: 'POST', headers: auth, body: '{' })).status, 400)
  assert.equal((await fetch(`${base}/me`, { method: 'POST', headers: auth, body: JSON.stringify('x'.repeat(262144)) })).status, 413)
  assert.equal(dispatched, 0)
  const result = await fetch(`${base}/me`, { headers: { ...auth, Origin: 'http://localhost:5173' } })
  assert.equal(result.status, 200); assert.equal(result.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.equal(dispatched, 1)
})
