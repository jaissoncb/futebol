import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createTokenValidator, AuthenticationError, IdentityUnavailableError } from '../auth.ts'
import { createFetchHandler } from '../fetch-handler.ts'
import { createUserinfoProof } from '../g3.ts'
import { HttpError } from '../http-error.ts'
import entry from '../function.ts'

const keys = await generateKeyPair('RS256')
const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid: 'fetch-fixture', alg: 'RS256' }] })
const policy = { issuer: 'https://identity.fixture.test', jwksUri: 'https://identity.fixture.test/.well-known/jwks',
  audience: 'urn:fixture:api', clientId: 'fixture-client', maxLifetimeSeconds: 600, lifetimeRoundingSeconds: 1 }
const endpoint = `${policy.issuer}/oauth2/v2/user_profile`
const origin = 'https://futebol.fixture.test'
const now = Math.floor(Date.now() / 1000)
const claims = { iss: policy.issuer, aud: policy.audience, azp: policy.clientId, sub: 'synthetic-user',
  iat: now, exp: now + 600, auth_time: now - 300, amr: ['pwd'] }
async function bearer(overrides: Record<string, unknown> = {}) {
  return `Bearer ${await new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'fetch-fixture' }).sign(keys.privateKey)}`
}
function request(path = '/me', init: RequestInit = {}) { return new Request(`https://api.fixture.test${path}`, init) }
const syntheticBearer = 'Bearer a.b.c'
const principal = { issuer: policy.issuer, subject: claims.sub }

void test('fetch uses the complete existing G3 chain before dispatch and keeps HTTP errors sanitized', async () => {
  let providerStatus = 200, providers = 0, dispatched = 0, sent = ''
  const handler = createFetchHandler({ allowedOrigin: origin,
    authenticate: createTokenValidator(policy, createUserinfoProof({ fetch: (url, options) => {
      providers++; assert.equal(url, endpoint); assert.equal(options?.redirect, 'error')
      sent = new Headers(options?.headers).get('authorization') ?? ''
      return Promise.resolve(providerStatus === 200 ? Response.json({ sub: claims.sub }) : new Response(null, { status: providerStatus }))
    } }, endpoint), resolver),
    dispatch: () => { dispatched++; return Promise.resolve({ id: 'synthetic-internal-uuid' }) },
  })
  for (const overrides of [{ iss: 'https://other.test' }, { aud: 'other' }, { azp: 'other' },
    { aud: policy.clientId }, { exp: now - 1 }, { exp: now + 602 }, { gty: 'client_credentials' },
    { amr: [] }, { auth_time: undefined }]) {
    const response = await handler(request('/me', { headers: { Authorization: await bearer(overrides) } }))
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('www-authenticate'), 'Bearer')
    assert.deepEqual(await response.json(), { error: 'invalid_access_token' })
  }
  assert.equal(providers, 0); assert.equal(dispatched, 0)
  const token = await bearer()
  for (const status of [400, 401, 403, 429, 500]) {
    providerStatus = status
    const response = await handler(request('/me', { headers: { Authorization: token } }))
    assert.equal(response.status, status < 429 ? 401 : 503)
    if (status >= 429) assert.equal(response.headers.get('retry-after'), '2')
  }
  assert.equal(dispatched, 0)
  providerStatus = 200
  for (let i = 0; i < 2; i++) {
    const response = await handler(request('/me', { headers: { Authorization: token, Origin: origin } }))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), origin)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('pragma'), 'no-cache')
    assert.equal(response.headers.get('vary'), 'Origin')
    assert.deepEqual(await response.json(), { id: 'synthetic-internal-uuid' })
  }
  assert.equal(sent, token); assert.equal(providers, 6); assert.equal(dispatched, 2)
})

void test('origin, preflight, health, duplicate Bearer and DEV controls cannot start authentication/DB work', async () => {
  let authenticated = 0, dispatched = 0
  const handler = createFetchHandler({ allowedOrigin: origin,
    authenticate: () => { authenticated++; return Promise.resolve(principal) },
    dispatch: () => { dispatched++; return Promise.resolve({}) },
  })
  const health = await handler(request('/health'))
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ok' })
  const preflight = await handler(request('/me', { method: 'OPTIONS', headers: { Origin: origin } }))
  assert.equal(preflight.status, 204); assert.equal(await preflight.text(), '')
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, PATCH, PUT')
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Authorization, Content-Type')
  const denied = await handler(request('/me', { headers: { Origin: 'https://other.test', Authorization: syntheticBearer } }))
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null)
  for (const headers of [new Headers(), new Headers({ Authorization: `${syntheticBearer}, ${syntheticBearer}` }),
    new Headers([['Authorization', syntheticBearer], ['authorization', syntheticBearer]]),
    new Headers({ Authorization: `Bearer ${'x'.repeat(16385)}.b.c` })]) {
    assert.equal((await handler(request('/me', { headers }))).status, 401)
  }
  for (const path of ['/__dev', '/__dev/g3?phase=initial', '/__dev/stabilization', '/workspace?__dev_delay=1',
    '/workspace?phase=sample', '/workspace?mode=fresh_native', '/workspace?transport=native']) {
    assert.equal((await handler(request(path, { headers: { Authorization: syntheticBearer } }))).status, 404)
  }
  assert.equal(authenticated, 0); assert.equal(dispatched, 0)
})

void test('body is authenticated first, validated as JSON and capped in bytes, including chunked UTF-8', async () => {
  let dispatched = 0
  const handler = createFetchHandler({ allowedOrigin: origin,
    authenticate: authorization => authorization === 'Bearer reject.b.c' ? Promise.reject(new AuthenticationError()) : Promise.resolve(principal),
    dispatch: (_principal, _method, _url, body) => { dispatched++; return Promise.resolve(body) },
  })
  const call = (body: string, type = 'application/json', authorization = syntheticBearer) => handler(request('/me', {
    method: 'POST', headers: { Authorization: authorization, 'Content-Type': type }, body,
  }))
  assert.equal((await call('{', 'text/plain', 'Bearer reject.b.c')).status, 401)
  assert.equal((await call('{}', 'text/plain')).status, 415)
  assert.equal((await call('{')).status, 400)
  assert.equal((await call(JSON.stringify('x'.repeat(262143)))).status, 413)
  assert.equal((await call(JSON.stringify('é'.repeat(131072)))).status, 413)
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(200000)); controller.enqueue(new Uint8Array(100000))
  }, cancel() { cancelled = true } })
  const chunked = new Request('https://api.fixture.test/me', { method: 'POST', body: stream,
    headers: { Authorization: syntheticBearer, 'Content-Type': 'application/json' }, duplex: 'half' })
  assert.equal((await handler(chunked)).status, 413); assert.equal(cancelled, true)
  assert.equal(dispatched, 0)
  const exact = await call(JSON.stringify('x'.repeat(262142)))
  assert.equal(exact.status, 200); assert.equal((await exact.json() as string).length, 262142)
  assert.equal(dispatched, 1)
})

void test('aborted body is cancelled before dispatch', async () => {
  let dispatched = 0, cancelled = false
  const handler = createFetchHandler({ allowedOrigin: origin, authenticate: () => Promise.resolve(principal),
    dispatch: () => { dispatched++; return Promise.resolve({}) },
  })
  const controller = new AbortController()
  const pending = handler(new Request('https://api.fixture.test/me', { method: 'POST',
    headers: { Authorization: syntheticBearer, 'Content-Type': 'application/json' },
    body: new ReadableStream({ cancel() { cancelled = true } }), signal: controller.signal, duplex: 'half' }))
  controller.abort()
  assert.equal((await pending).status, 408)
  assert.equal(dispatched, 0); assert.equal(cancelled, true)
})

void test('body timeout is bounded at 20 seconds and releases a stalled stream before dispatch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let cancelled = false, dispatched = false
  const handler = createFetchHandler({ allowedOrigin: origin, authenticate: () => Promise.resolve(principal),
    dispatch: () => { dispatched = true; return Promise.resolve({}) },
  })
  const pending = handler(new Request('https://api.fixture.test/me', { method: 'POST',
    headers: { Authorization: syntheticBearer, 'Content-Type': 'application/json' },
    body: new ReadableStream({ cancel() { cancelled = true } }), duplex: 'half' }))
  // Let authentication finish and install the body timer; no wall-clock wait.
  await Promise.resolve()
  t.mock.timers.tick(20000)
  assert.equal((await pending).status, 408)
  assert.equal(cancelled, true); assert.equal(dispatched, false)
})

void test('HTTP 403/409/503 and Retry-After preserve the existing response contract without raw errors', async () => {
  for (const [error, status, code] of [[new HttpError(403, 'forbidden'), 403, 'forbidden'],
    [new HttpError(409, 'conflict'), 409, 'conflict'], [new IdentityUnavailableError(), 503, 'identity_unavailable'],
    [new Error('synthetic-sensitive-provider-detail'), 503, 'service_unavailable']] as const) {
    const handler = createFetchHandler({ allowedOrigin: origin, authenticate: () => Promise.resolve(principal),
      dispatch: () => Promise.reject(error) })
    const response = await handler(request('/me', { headers: { Authorization: syntheticBearer } }))
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: code })
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
})

void test('isolate limits are bounded across spoofed proxy headers and recover at the next window', async () => {
  let clock = 1000
  const handler = createFetchHandler({ allowedOrigin: origin, now: () => clock,
    authenticate: () => Promise.resolve(principal), dispatch: () => Promise.resolve({}),
  })
  for (let i = 0; i < 120; i++) assert.equal((await handler(request('/me', {
    headers: { Authorization: syntheticBearer, 'X-Forwarded-For': `192.0.2.${i}` },
  }))).status, 200)
  const limited = await handler(request('/me'))
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60')
  clock += 60000
  assert.equal((await handler(request('/health'))).status, 200)
  const releases: (() => void)[] = []
  const concurrent = createFetchHandler({ allowedOrigin: origin,
    authenticate: () => new Promise(resolve => releases.push(() => resolve(principal))),
    dispatch: () => Promise.resolve({}),
  })
  const pending = Array.from({ length: 8 }, () => concurrent(request('/me', { headers: { Authorization: syntheticBearer } })))
  assert.equal((await concurrent(request('/me', { headers: { Authorization: syntheticBearer } }))).status, 429)
  releases.forEach(release => release()); assert.ok((await Promise.all(pending)).every(r => r.status === 200))
})

void test('save UUID, method, principal, body and business query reach the existing dispatch without retries or rewriting', async () => {
  const calls: unknown[][] = []
  const handler = createFetchHandler({ allowedOrigin: origin, authenticate: () => Promise.resolve(principal),
    dispatch: (...args) => { calls.push(args); return Promise.resolve({ id: 'fixture-save' }) },
  })
  const path = '/matches/00000000-0000-4000-8000-000000000001/draw'
  const body = { fixture: 'unchanged-payload' }
  for (let i = 0; i < 2; i++) {
    assert.equal((await handler(request(path, { method: 'PUT', headers: { Authorization: syntheticBearer,
      'Content-Type': 'application/json' }, body: JSON.stringify(body) }))).status, 200)
  }
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call[0], principal); assert.equal(call[1], 'PUT')
    assert.equal((call[2] as URL).pathname, path); assert.deepEqual(call[3], body)
  }
  const history = '/groups/00000000-0000-4000-8000-000000000001/matches?page=2'
  await handler(request(history, { headers: { Authorization: syntheticBearer } }))
  assert.equal((calls[2][2] as URL).searchParams.get('page'), '2')
})

void test('Function entry exports fetch; its local runtime graph excludes DEV modules, scripts and node:http', () => {
  assert.equal(typeof entry.fetch, 'function')
  const visited = new Set<string>()
  function inspect(file: URL) {
    if (visited.has(file.href)) return
    visited.add(file.href)
    const source = readFileSync(file, 'utf8')
    assert.ok(!source.includes('node:http'))
    const imports = source.matchAll(/(?:import|export)\s+(?!type\b)[^'"\n]*?from\s+['"]([^'"]+)['"]/g)
    for (const match of imports) {
      if (!match[1].startsWith('.')) continue
      const target = new URL(match[1], file)
      assert.ok(!/\/(?:server|runtime-dev|stabilization|userinfo-https|dev-readiness|secret-input|g3-probe|g3-dev|neon-dev-target)\.ts$/.test(target.pathname))
      assert.ok(!target.pathname.includes('/scripts/'))
      inspect(target)
    }
  }
  inspect(new URL('../function.ts', import.meta.url))
  assert.equal(visited.size, 9)
})
