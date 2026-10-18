import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { AuthenticationError, IdentityUnavailableError } from '../auth.ts'
import { createG3Validator, createUserinfoProof, g3Policy, userinfoUrl } from '../g3.ts'
import { createG3Probe } from '../g3-probe.ts'
import { createApi } from '../server.ts'

const keys = await generateKeyPair('RS256')
const resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid: 'g3-fixture', alg: 'RS256' }] })
const now = Math.floor(Date.now() / 1000)
const claims = { iss: g3Policy.issuer, aud: g3Policy.audience, azp: g3Policy.clientId,
  sub: 'synthetic-g3-user', amr: ['pwd'], auth_time: now - 300, iat: now, exp: now + 600 }
const ok = () => Response.json({ sub: claims.sub, ignored_pii: 'synthetic-only' })
void test('zero positive cache TTL repeats full userinfo proof and never enables stale fallback', async () => {
  let calls = 0
  const proof = createUserinfoProof({ cacheTtlMs: 0, fetch: () => {
    calls++; return Promise.resolve(calls === 3 ? new Response(null,{status:503}) : ok())
  } })
  assert.equal(await proof(claims,'Bearer fixture-fresh'),true)
  assert.equal(await proof(claims,'Bearer fixture-fresh'),true)
  await assert.rejects(proof(claims,'Bearer fixture-fresh'),IdentityUnavailableError)
  assert.equal(calls,3)
  assert.throws(() => createUserinfoProof({cacheTtlMs:60001 as 60000}),/invalid_cache_ttl/)
})
void test('sanitized transport observations distinguish DNS TLS timeout and malformed body', async () => {
  for (const [code,category] of [['EAI_AGAIN','dns'],['CERT_HAS_EXPIRED','tls'],['ECONNRESET','reset']]) {
    const events: unknown[] = []
    const proof = createUserinfoProof({onUnavailable:event=>events.push(event),
      fetch:()=>Promise.reject(new Error('PRIVATE_FIXTURE',{cause:{code}}))})
    await assert.rejects(proof(claims,'Bearer PRIVATE_TOKEN_FIXTURE'),IdentityUnavailableError)
    assert.equal((events[0] as {category:string}).category,category)
    assert.ok(!JSON.stringify(events).includes('PRIVATE_'))
  }
  const events: unknown[] = []
  await assert.rejects(createUserinfoProof({onUnavailable:event=>events.push(event),
    fetch:()=>Promise.resolve(new Response('{',{headers:{'content-type':'application/json'}}))})(claims,'Bearer fixture'),IdentityUnavailableError)
  assert.equal((events[0] as {category:string}).category,'json')
  assert.equal((events[0] as {phase:string}).phase,'body')
})
async function sign(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  return new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'g3-fixture', ...header }).sign(keys.privateKey)
}

void test('G3 accepts conjunction of signed user claims and SAME Bearer userinfo, including refreshed iat and 601 s rounding', async () => {
  let sentBearer = ''
  let calls = 0
  const verify = createG3Validator({ fetch: (url, options) => {
    assert.equal(url, userinfoUrl); assert.equal(options?.redirect, 'error')
    assert.equal(options?.credentials, 'omit'); assert.equal(options?.method, 'GET')
    sentBearer = new Headers(options?.headers).get('authorization') ?? ''; calls++
    return Promise.resolve(ok())
  } }, resolver)
  for (const aud of [g3Policy.audience, ['another-api', g3Policy.audience]]) {
    const bearer = `Bearer ${await sign({ aud, exp: now + 601, auth_time: now - 86400 })}`
    assert.equal((await verify(bearer)).subject, claims.sub)
    assert.equal(sentBearer, bearer)
    await verify(bearer); assert.equal(calls, aud === g3Policy.audience ? 1 : 2)
  }
})

const negatives: [string, Record<string, unknown>][] = [
  ['issuer', { iss: 'https://production.test' }], ['audience', { aud: 'urn:other' }],
  ['ID audience', { aud: g3Policy.clientId }], ['azp', { azp: 'another-client' }],
  ['mixed audience types', { aud: [g3Policy.audience, 1] }],
  ['expired within skew', { iat: now - 600, exp: now - 1 }], ['too long lifetime', { exp: now + 602 }],
  ['future iat', { iat: now + 60 }], ['future nbf', { nbf: now + 60 }],
  ['amr missing', { amr: undefined }], ['amr string', { amr: 'pwd' }],
  ['amr empty', { amr: [] }], ['amr other method', { amr: ['otp'] }], ['amr mixed types', { amr: ['pwd', 1] }],
  ['auth_time missing', { auth_time: undefined }], ['auth_time string', { auth_time: String(now) }],
  ['auth_time null', { auth_time: null }], ['auth_time future', { auth_time: now + 31 }],
  ['auth_time after iat', { auth_time: now, iat: now - 60, exp: now + 540 }],
  ['auth_time zero', { auth_time: 0 }], ['auth_time negative', { auth_time: -1 }],
  ...['client_credentials', ['client_credentials'], 'authorization_code', [], {}, null, 1, false].map(
    (gty, index): [string, Record<string, unknown>] => [`gty presence ${index}`, { gty }]),
]
for (const [name, overrides] of negatives) void test(`G3 rejects ${name} before userinfo`, async () => {
  let called = false
  const verify = createG3Validator({ fetch: () => { called = true; return Promise.resolve(ok()) } }, resolver)
  await assert.rejects(verify(`Bearer ${await sign(overrides)}`), AuthenticationError)
  assert.equal(called, false)
})

void test('G3 missing/unknown kid, token URLs including null, wrong key/alg and missing Bearer are rejected', async () => {
  const verify = createG3Validator({ fetch: () => { assert.fail('userinfo must not run') } }, resolver)
  for (const header of [{ kid: undefined }, { kid: 'unknown' }, { jku: null }, { x5u: 'https://evil.test' }]) {
    await assert.rejects(verify(`Bearer ${await sign({}, header)}`), AuthenticationError)
  }
  const wrongKeys = await generateKeyPair('RS256')
  const wrong = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'g3-fixture' }).sign(wrongKeys.privateKey)
  const hmac = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256', kid: 'g3-fixture' }).sign(new Uint8Array(32))
  for (const bearer of [undefined, '', `Bearer ${wrong}`, `Bearer ${hmac}`, 'Bearer eyJhbGciOiJub25lIn0.e30.']) {
    await assert.rejects(verify(bearer), AuthenticationError)
  }
})

for (const status of [400, 401, 403, 429, 500, 503, 302, 204]) void test(`userinfo ${status} fails closed with correct class`, async () => {
  const verify = createG3Validator({ fetch: () => Promise.resolve(new Response(null, { status })) }, resolver)
  await assert.rejects(verify(`Bearer ${await sign()}`), [400, 401, 403].includes(status) ? AuthenticationError : IdentityUnavailableError)
})
for (const [name, body] of [
  ['sub mismatch', { sub: 'another-user' }], ['sub missing', {}], ['sub empty', { sub: '' }],
  ['array', [{ sub: claims.sub }]], ['null', null], ['wrong sub type', { sub: 1 }],
] as const) void test(`userinfo ${name} fails closed`, async () => {
  const verify = createG3Validator({ fetch: () => Promise.resolve(Response.json(body)) }, resolver)
  await assert.rejects(verify(`Bearer ${await sign()}`), name === 'sub mismatch' ? AuthenticationError : IdentityUnavailableError)
})
void test('userinfo TLS/DNS, malformed JSON, wrong content type and oversized length/body fail closed', async () => {
  const transports: (typeof fetch)[] = [
    () => Promise.reject(new Error('synthetic TLS/DNS error, must not leak')),
    () => Promise.resolve(new Response('{', { headers: { 'content-type': 'application/json' } })),
    () => Promise.resolve(new Response(JSON.stringify({ sub: claims.sub }), { headers: { 'content-type': 'text/html' } })),
    () => Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '65537' } })),
    () => Promise.resolve(Response.json({ sub: claims.sub, oversized: 'x'.repeat(65536) })),
  ]
  for (const transport of transports) {
    await assert.rejects(createG3Validator({ fetch: transport }, resolver)(`Bearer ${await sign()}`), IdentityUnavailableError)
  }
})

void test('timeout covers headers AND stalled streaming body; ignored abort cannot populate cache later', async () => {
  let calls = 0
  let release!: (value: Response) => void
  const proof = createUserinfoProof({ timeoutMs: 10, fetch: () => {
    calls++; return new Promise<Response>(resolve => { release = resolve })
  } })
  await assert.rejects(proof(claims, 'Bearer fixture-timeout'), IdentityUnavailableError)
  release(ok()); await new Promise(resolve => setTimeout(resolve, 5))
  const second = proof(claims, 'Bearer fixture-timeout')
  assert.equal(calls, 2); release(ok()); assert.equal(await second, true)
  let bodyCancelled = false
  const stalled = createUserinfoProof({ timeoutMs: 10, fetch: () => Promise.resolve(new Response(new ReadableStream({
    cancel() { bodyCancelled = true },
  }), { headers: { 'content-type': 'application/json' } })) })
  await assert.rejects(stalled(claims, 'Bearer body-timeout'), IdentityUnavailableError)
  assert.equal(bodyCancelled, true)
})

void test('calibrated timeout is bounded and unavailable diagnostics expose only classification/timing', async () => {
  assert.throws(() => createUserinfoProof({ timeoutMs: 5001 }), /invalid_timeout/)
  const events: unknown[] = []
  const proof = createUserinfoProof({ timeoutMs: 5, onUnavailable: event => events.push(event),
    fetch: () => new Promise<Response>(() => undefined) })
  await assert.rejects(proof(claims, 'Bearer synthetic-private'), (error: unknown) => error instanceof IdentityUnavailableError
    && error.dependency === 'userinfo' && error.reason === 'timeout')
  assert.equal(events.length, 1)
  assert.match(JSON.stringify(events), /timeout/)
  assert.ok(!JSON.stringify(events).includes('synthetic-private'))
  assert.ok(!JSON.stringify(events).includes(claims.sub))
})

void test('positive cache max 60 s, token exp bound, context bound, distinct refreshed token and no stale-on-error', async () => {
  let clock = now * 1000
  let calls = 0
  let unavailable = false
  const proof = createUserinfoProof({ now: () => clock, fetch: () => {
    calls++; return Promise.resolve(unavailable ? new Response(null, { status: 503 }) : ok())
  } })
  await proof(claims, 'Bearer token-a'); clock += 59999
  await proof(claims, 'Bearer token-a'); assert.equal(calls, 1)
  clock++; unavailable = true
  await assert.rejects(proof(claims, 'Bearer token-a'), IdentityUnavailableError); assert.equal(calls, 2)
  unavailable = false
  await proof(claims, 'Bearer token-a'); await proof(claims, 'Bearer refreshed-token'); assert.equal(calls, 4)
  await proof({ ...claims, aud: [g3Policy.audience] }, 'Bearer token-a'); assert.equal(calls, 5)
  await assert.rejects(proof({ ...claims, amr: undefined }, 'Bearer token-a'), AuthenticationError)
  const short = { ...claims, exp: clock / 1000 + 1 }
  await proof(short, 'Bearer short-lived'); clock += 1000
  await assert.rejects(proof(short, 'Bearer short-lived'), AuthenticationError)
})

void test('cache is bounded at 1024 entries and does not share confirmation between instances', async () => {
  let calls = 0
  const transport: typeof fetch = () => { calls++; return Promise.resolve(ok()) }
  const proof = createUserinfoProof({ fetch: transport })
  for (let i = 0; i < 1025; i++) await proof(claims, `Bearer fixture-${i}`)
  await proof(claims, 'Bearer fixture-0'); assert.equal(calls, 1026)
  await createUserinfoProof({ fetch: transport })(claims, 'Bearer fixture-0'); assert.equal(calls, 1027)
})

void test('concurrent same token deduplicates; context cannot join; max eight remote connections', async () => {
  let calls = 0
  const releases: (() => void)[] = []
  const proof = createUserinfoProof({ fetch: () => {
    calls++; return new Promise<Response>(resolve => releases.push(() => resolve(ok())))
  } })
  const one = Array.from({ length: 20 }, () => proof(claims, 'Bearer concurrent'))
  await assert.rejects(proof({ ...claims, azp: 'other' }, 'Bearer concurrent'), AuthenticationError)
  assert.equal(calls, 1); releases.shift()!(); await Promise.all(one)
  const many = Array.from({ length: 8 }, (_, i) => proof(claims, `Bearer bounded-${i}`))
  await assert.rejects(proof(claims, 'Bearer excess'), IdentityUnavailableError)
  assert.equal(calls, 9); for (const release of releases) release(); await Promise.all(many)
})

void test('HTTP G3 negatives and provider failures never reach SQL/bootstrap; local block still evaluated on cache hit', async t => {
  let sqlCalls = 0
  let providerCalls = 0
  let status = 200
  let disabled = false
  const server = createApi({
    authenticate: createG3Validator({ fetch: () => {
      providerCalls++; return Promise.resolve(status === 200 ? ok() : new Response(null, { status }))
    } }, resolver),
    dispatch: () => {
      // Represents existing withActor/bootstrap disabled check, which is never cached by G3.
      sqlCalls++; return disabled ? Promise.reject(new AuthenticationError()) : Promise.resolve({ fixture: true })
    },
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const bearer = `Bearer ${await sign()}`
  const call = (authorization?: string) => fetch(`${base}/me`, { headers: authorization ? { Authorization: authorization } : {} })
  for (const [, override] of negatives) assert.equal((await call(`Bearer ${await sign(override)}`)).status, 401)
  assert.equal((await call()).status, 401)
  const duplicates = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(`${base}/me`, { headers: ['Host', new URL(base).host, 'Authorization', bearer, 'authorization', bearer] }, response => {
      response.resume(); resolve(response.statusCode)
    }); request.on('error', reject); request.end()
  })
  assert.equal(duplicates, 401); assert.equal(sqlCalls, 0); assert.equal(providerCalls, 0)
  for (const errorStatus of [400, 401, 403, 429, 500]) {
    status = errorStatus
    const result = await call(bearer)
    assert.equal(result.status, errorStatus < 429 ? 401 : 503)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    if (errorStatus >= 429) assert.equal(result.headers.get('retry-after'), '2')
  }
  assert.equal(sqlCalls, 0)
  status = 200; assert.equal((await call(bearer)).status, 200)
  const confirmedCalls = providerCalls
  disabled = true; assert.equal((await call(bearer)).status, 401)
  assert.equal(sqlCalls, 2); assert.equal(providerCalls, confirmedCalls)
})

void test('diagnostic API accepts G3 fixture only at probe; /me remains closed and evidence has no identifiers/tokens', async t => {
  const events: Record<string, string | number | boolean>[] = []
  const server = createG3Probe(event => events.push(event), () => Promise.resolve(ok()), resolver)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const jwt = await sign(); const headers = { Authorization: `Bearer ${jwt}` }
  assert.equal((await fetch(`${base}/__dev/g3?phase=initial`, { headers })).status, 200)
  assert.equal((await fetch(`${base}/me`, { headers })).status, 503)
  const evidence = JSON.stringify(events)
  assert.ok(!evidence.includes(jwt)); assert.ok(!evidence.includes(claims.sub))
  assert.ok(events.some(event => event.amrPwd === true && event.authTimePresent === true))
})
