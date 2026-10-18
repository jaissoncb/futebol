import { test } from 'node:test'
import assert from 'node:assert/strict'
import { neonDevTarget, validateNeonDevConnection } from '../neon-dev-target.ts'

void test('native Neon runner can select only the DEV endpoint/database/owner; TLS is strengthened before any connection', () => {
  const fixture = `postgresql://${neonDevTarget.migrationRole}:synthetic-not-a-secret@${neonDevTarget.host}/futebol_dev?sslmode=require&channel_binding=require`
  assert.equal(validateNeonDevConnection(fixture).searchParams.get('sslmode'), 'verify-full')
  for (const mutate of [
    (url: URL) => { url.hostname = 'production.neon.tech' },
    (url: URL) => { url.hostname = 'localhost' },
    (url: URL) => { url.pathname = '/production' },
    (url: URL) => { url.username = 'other_owner' },
    (url: URL) => { url.password = '' },
    (url: URL) => { url.port = '5433' },
    (url: URL) => { url.searchParams.set('sslrootcert', 'other') },
    (url: URL) => { url.searchParams.set('options', 'unsafe') },
  ]) {
    const url = new URL(fixture); mutate(url)
    assert.throws(() => validateNeonDevConnection(url.href), error => error instanceof Error
      && error.message === 'invalid_neon_dev_target' && !error.message.includes('synthetic'))
  }
  assert.throws(() => validateNeonDevConnection('not a URI'), /invalid_neon_dev_target/)
})
