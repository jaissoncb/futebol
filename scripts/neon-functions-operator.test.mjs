import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateOperatorInput, provisionFunctionLogin, verifyCandidate } from './neon-functions-operator.mjs'

const adminConnection = 'postgresql://futebol_dev_owner:SYNTHETIC_ADMIN@ep-small-voice-baiso0c9.c-8.eu-central-1.aws.neon.tech/futebol_dev?sslmode=verify-full'
const apiKey = 'SYNTHETIC-management-key'

function fixtures({ exists = false, safe = true, actualRole = 'futebol_dev_owner', failRuntime = false } = {}) {
  const events = [], queries = []
  let adminClosed = false
  const client = {
    query: (sql, values) => {
      queries.push([sql, values])
      if (sql.includes('current_database() as database')) return Promise.resolve({ rows: [{ database: 'futebol_dev', role: actualRole }] })
      if (sql.startsWith('select rolname')) return Promise.resolve({ rows: exists ? [{ rolname: 'futebol_api_dev_functions' }] : [] })
      if (sql.includes('as safe from pg_roles')) return Promise.resolve({ rows: [{ safe }] })
      return Promise.resolve({ rows: [] })
    },
    release: () => events.push('release-admin'),
  }
  const options = {
    createPool: (dsn, name) => {
      if (name === 'futebol-functions-operator') return { on() {}, connect: () => Promise.resolve(client), end: () => { adminClosed = true; events.push('admin-closed'); return Promise.resolve() } }
      assert.equal(adminClosed, true, 'admin connection must end before runtime verification')
      const url = new URL(dsn)
      assert.equal(url.username, 'futebol_api_dev_functions')
      assert.equal(url.hostname, 'ep-small-voice-baiso0c9-pooler.c-8.eu-central-1.aws.neon.tech')
      assert.equal(url.searchParams.get('sslmode'), 'verify-full')
      assert.ok(!dsn.includes('SYNTHETIC_ADMIN'))
      return { on() {}, end: () => { events.push('runtime-closed'); return Promise.resolve() } }
    },
    checkBoundary: () => { events.push('boundary'); return Promise.resolve() },
    checkRole: () => { events.push('restricted-role'); return failRuntime ? Promise.reject(new Error('SYNTHETIC_PRIVATE_DB_ERROR')) : Promise.resolve() },
  }
  return { options, events, queries }
}

void test('offline input validation is fixed to DEV owner/host/database and rejects unsafe URLs or keys', () => {
  assert.equal(validateOperatorInput({ adminConnection, apiKey }).hostname, 'ep-small-voice-baiso0c9.c-8.eu-central-1.aws.neon.tech')
  const invalid = [adminConnection.replace('futebol_dev_owner', 'neondb_owner'),
    adminConnection.replace('/futebol_dev', '/futebol_prd'), adminConnection.replace('ep-small-voice', 'ep-other'),
    adminConnection + '&options=-crole%3Dfutebol_owner', adminConnection + '&sslmode=verify-full', adminConnection + '&channel_binding=disable']
  for (const input of [...invalid.map(value => ({ adminConnection: value, apiKey })),
    { adminConnection, apiKey: '' }, { adminConnection, apiKey: 'synthetic\nSENSITIVE' }]) {
    assert.throws(() => validateOperatorInput(input), error => error.message === 'invalid_operator_input' && error.cause === undefined)
  }
})

void test('new login receives ONLY the existing runtime role; no schema/data/owner grants or test runner', async () => {
  const f = fixtures()
  const result = await provisionFunctionLogin(adminConnection, undefined, f.options)
  assert.equal(result.status, 'created_verified')
  assert.match(result.password, /^[a-f0-9]{64}$/)
  assert.deepEqual(Object.keys(result), ['status', 'password'])
  const mutating = f.queries.map(([sql]) => sql).filter(sql => /^(create|grant|alter|drop|insert|update|delete|revoke) /i.test(sql))
  assert.equal(mutating.length, 2)
  assert.match(mutating[0], /^create role futebol_api_dev_functions login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '[a-f0-9]{64}'$/)
  assert.equal(mutating[1], 'grant futebol_runtime to futebol_api_dev_functions')
  assert.ok(f.events.indexOf('admin-closed') < f.events.indexOf('restricted-role'))
  assert.equal(f.events.filter(e => e === 'boundary').length, 2)
  assert.ok(f.events.includes('runtime-closed'))
})

void test('existing safe login is verified with its own password and never changed or rotated', async () => {
  const f = fixtures({ exists: true })
  const result = await provisionFunctionLogin(adminConnection, 'SYNTHETIC_RUNTIME_PASSWORD', f.options)
  assert.equal(result.status, 'existing_verified')
  assert.equal(result.password, 'SYNTHETIC_RUNTIME_PASSWORD')
  assert.ok(!f.queries.some(([sql]) => /^(create|grant|alter|drop|revoke) /i.test(sql)))
})

void test('missing existing password or unsafe login fails closed without correction or mutation', async () => {
  for (const [safe, expected] of [[true, 'existing_login_requires_password'], [false, 'operator_provision_failed']]) {
    const f = fixtures({ exists: true, safe })
    await assert.rejects(provisionFunctionLogin(adminConnection, undefined, f.options), error => error.message === expected && error.cause === undefined)
    assert.ok(f.queries.some(([sql]) => sql === 'ROLLBACK'))
    assert.ok(!f.queries.some(([sql]) => /^(create|grant|alter|drop|revoke) /i.test(sql)))
    assert.ok(!f.events.includes('restricted-role'))
  }
})

void test('wrong connected identity cannot create the login; restricted verification failure cannot open dispatch/deploy', async () => {
  const wrong = fixtures({ actualRole: 'unexpected_owner' })
  await assert.rejects(provisionFunctionLogin(adminConnection, undefined, wrong.options), /operator_provision_failed/)
  assert.ok(!wrong.queries.some(([sql]) => sql.startsWith('create ')))
  const failed = fixtures({ failRuntime: true })
  await assert.rejects(provisionFunctionLogin(adminConnection, undefined, failed.options), error => {
    assert.equal(error.message, 'login_created_verification_failed'); assert.equal(error.cause, undefined)
    assert.ok(!JSON.stringify(error).includes('SYNTHETIC')); return true
  })
  assert.ok(failed.events.includes('runtime-closed'))
})

void test('approved ZIP/sources match; operator graph never imports migrations or empty-database/domain runners', async () => {
  await verifyCandidate()
  const source = await readFile(new URL('./neon-functions-operator.mjs', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1])
  assert.ok(imports.every(path => !/start-neon-dev|test-neon-dev|test-dev-database|neon-domain-preflight|runtime-dev|\.sql/.test(path)))
  assert.ok(!source.includes('private.bootstrap_user'))
})
