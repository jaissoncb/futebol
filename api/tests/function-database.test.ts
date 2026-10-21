import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Pool } from 'pg'
import { assertRuntimeRole } from '../database.ts'
import { createRestrictedDatabaseDispatch } from '../routes.ts'
import { HttpError } from '../http-error.ts'

const principal = { issuer: 'https://identity.fixture.test', subject: 'synthetic-user' }
function fixture(role: unknown = false, boundary = true) {
  const events: string[] = []
  let roleResult = role
  const pool = {
    query: (sql: string) => {
      if (sql.includes('as unsafe')) { events.push('role'); return Promise.resolve({ rows: [{ unsafe: roleResult }] }) }
      events.push('boundary'); return Promise.resolve({ rows: [{ safe: boundary }] })
    },
    connect: () => {
      events.push('connect')
      return Promise.resolve({ query: (sql: string, values?: unknown[]) => {
        events.push(sql)
        if (sql.includes('bootstrap_user')) return Promise.resolve({ rows: [{ id: 'synthetic-internal-uuid' }] })
        if (sql.includes('from public.profiles')) return Promise.resolve({ rows: [{ id: values?.[0] }] })
        return Promise.resolve({ rows: [] })
      }, release: (discard: boolean) => events.push(`release:${String(discard)}`) })
    },
  } as unknown as Pool
  return { pool, events, setRole: (value: unknown) => { roleResult = value } }
}

void test('no bootstrap/transaction/dispatch until BOTH runtime role and database boundary checks succeed', async () => {
  for (const role of [true, undefined, null]) {
    const f = fixture(); f.setRole(role)
    await assert.rejects(createRestrictedDatabaseDispatch(f.pool)(principal, 'GET', new URL('https://api.test/me'), undefined))
    assert.deepEqual(f.events, ['role'])
  }
  const f = fixture(false, false)
  await assert.rejects(createRestrictedDatabaseDispatch(f.pool)(principal, 'GET', new URL('https://api.test/me'), undefined))
  assert.deepEqual(f.events, ['role', 'boundary'])
  await assert.rejects(assertRuntimeRole({ query: () => Promise.resolve({ rows: [] }) } as unknown as Pool))
})

void test('guard checks are deduplicated; actor transaction and per-request bootstrap remain intact', async () => {
  const f = fixture()
  const dispatch = createRestrictedDatabaseDispatch(f.pool)
  const results = await Promise.all(Array.from({ length: 3 }, () => dispatch(principal, 'GET', new URL('https://api.test/me'), undefined)))
  assert.deepEqual(results, Array.from({ length: 3 }, () => ({ id: 'synthetic-internal-uuid' })))
  assert.deepEqual(f.events.slice(0, 2), ['role', 'boundary'])
  assert.equal(f.events.filter(e => e === 'role').length, 1)
  assert.equal(f.events.filter(e => e.includes('bootstrap_user')).length, 3)
  assert.equal(f.events.filter(e => e === 'BEGIN').length, 3)
  assert.equal(f.events.filter(e => e.includes("set_config('futebol.actor_id', $1, true)")).length, 3)
  assert.equal(f.events.filter(e => e === 'COMMIT').length, 3)
  assert.equal(f.events.filter(e => e === 'release:false').length, 3)
})

void test('failed guard can recover without allowing a private operation during the failure; routes still roll back', async () => {
  const f = fixture(true)
  const dispatch = createRestrictedDatabaseDispatch(f.pool)
  await assert.rejects(dispatch(principal, 'GET', new URL('https://api.test/me'), undefined))
  assert.ok(!f.events.includes('connect'))
  f.setRole(false)
  await dispatch(principal, 'GET', new URL('https://api.test/me'), undefined)
  await assert.rejects(dispatch(principal, 'GET', new URL('https://api.test/missing'), undefined), HttpError)
  assert.equal(f.events.filter(e => e === 'role').length, 2)
  assert.equal(f.events.filter(e => e === 'ROLLBACK').length, 1)
})
