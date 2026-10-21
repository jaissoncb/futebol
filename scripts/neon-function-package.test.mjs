import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { prepareNeonDevUpload, target } from './prepare-neon-dev-upload.mjs'
import { sendNeonDevUpload } from './send-neon-dev-upload.mjs'

const config = JSON.parse(await readFile(new URL('../deployment/neon-dev.runtime-config.json', import.meta.url), 'utf8'))
const approved = { ...config, database: { ...config.database, runtimeRole: 'futebol_api_dev_synthetic_fixture' } }
const zip = new TextEncoder().encode('synthetic-package-fixture')
const zipSha256 = createHash('sha256').update(zip).digest('hex')
const fixture = { config: approved, password: 'SYNTHETIC-DB-password/@:#', apiKey: 'SYNTHETIC-management-token', zip, zipSha256 }

void test('one official multipart request carries both restricted URLs and excludes the management key from runtime', async () => {
  const request = prepareNeonDevUpload(fixture)
  assert.equal(request.url, `https://console.neon.tech/api/v2/projects/${target.projectId}/branches/${target.branchId}/functions/futebolapi/deployments`)
  assert.equal(request.init.headers.Authorization, `Bearer ${fixture.apiKey}`)
  assert.equal(request.init.redirect, 'error')
  assert.deepEqual([...request.init.body.keys()], ['zip', 'runtime', 'environment'])
  assert.equal(request.init.body.get('runtime'), 'nodejs24')
  const environment = JSON.parse(request.init.body.get('environment'))
  assert.deepEqual(Object.keys(environment), ['FUTEBOL_RUNTIME_CONFIG', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED'])
  assert.ok(!JSON.stringify(environment).includes(fixture.apiKey))
  assert.equal(await request.init.body.get('zip').text(), 'synthetic-package-fixture')
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    const url = new URL(environment[key])
    assert.equal(decodeURIComponent(url.username), approved.database.runtimeRole)
    assert.equal(decodeURIComponent(url.password), fixture.password)
    assert.equal(url.searchParams.get('sslmode'), 'verify-full')
  }
})

void test('unapproved placeholder, admin login, wrong target, corrupt ZIP or missing secrets cannot prepare a request', () => {
  for (const patch of [{ config }, { config: { ...approved, environment: 'prd' } },
    { config: { ...approved, database: { ...approved.database, runtimeRole: 'futebol_dev_owner' } } },
    { config: { ...approved, database: { ...approved.database, pooledHost: 'other.test' } } },
    { password: '' }, { apiKey: '' }, { apiKey: 'synthetic\r\nheader' }, { zipSha256: '0'.repeat(64) }, { zip: new Uint8Array() }]) {
    assert.throws(() => prepareNeonDevUpload({ ...fixture, ...patch }), error => {
      assert.equal(error.message, 'invalid_neon_dev_upload')
      assert.equal(error.cause, undefined)
      assert.ok(!JSON.stringify(error).includes('SYNTHETIC'))
      return true
    })
  }
})

void test('sender sends once to the fixed API, suppresses response secrets, and leaves uncertain POSTs without retry', async () => {
  let calls = 0
  const accepted = await sendNeonDevUpload(fixture, (url, init) => {
    calls++; assert.ok(url.endsWith('/functions/futebolapi/deployments')); assert.equal(init.method, 'POST')
    return Promise.resolve(Response.json({ secret: fixture.password, environment: fixture.apiKey }, { status: 202 }))
  })
  assert.deepEqual(accepted, { status: 'accepted_check_console', httpStatus: 202 })
  const uncertain = await sendNeonDevUpload(fixture, () => {
    calls++; return Promise.reject(new Error(fixture.password))
  })
  assert.deepEqual(uncertain, { status: 'unknown_check_console_before_retry' })
  assert.equal(calls, 2)
  assert.ok(!JSON.stringify([accepted, uncertain]).includes('SYNTHETIC'))
})
