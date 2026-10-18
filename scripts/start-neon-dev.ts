import { readFileSync, appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createRuntimePool } from '../api/database.ts'
import { neonDevTarget, validateNeonDevConnection } from '../api/neon-dev-target.ts'
import { assertDevReadiness } from '../api/dev-readiness.ts'
import { runNeonDomainPreflight } from './neon-domain-preflight.ts'

// Provisioner is a separate process. Migration credential is never inherited by
// the HTTP API; only a fresh, restricted runtime DSN travels over the child stdin.
const record = (event: Record<string, string | boolean>) => appendFileSync(
  'D:/Projetos/_Handoff/Futebol/FUTEBOL_API_NEON_EVIDENCIAS_2026-10-18.jsonl',
  `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
let created = false
const login = `futebol_api_dev_${randomBytes(8).toString('hex')}`
let migration: ReturnType<typeof createRuntimePool> | undefined
try {
  assertDevReadiness()
  const url = validateNeonDevConnection(readFileSync(0, 'utf8').trim())
  migration = createRuntimePool(url.href)
  migration.on('error', () => record({ event: 'migration_connection_unavailable' }))
  const actual = await migration.query<{ database: string; role: string }>('select current_database() as database,current_user as role')
  if (actual.rows[0]?.database !== neonDevTarget.database || actual.rows[0]?.role !== neonDevTarget.migrationRole) throw new Error('wrong_target')
  const password = randomBytes(32).toString('hex')
  await migration.query(`create role ${login} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`)
  created = true
  await migration.query(`grant futebol_runtime to ${login}`)
  url.username = login; url.password = password; url.hostname = neonDevTarget.pooledHost
  const testRuntime = createRuntimePool(url.href)
  testRuntime.on('error', () => record({ event: 'preflight_runtime_connection_unavailable' }))
  try { await runNeonDomainPreflight(migration, testRuntime, record) }
  finally { await testRuntime.end() }
  const child = spawn(process.execPath, ['--experimental-strip-types', 'api/runtime-dev.ts'], {
    cwd: 'D:/Projetos/Futebol', stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true,
    env: Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP']
      .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  })
  const closed = once(child, 'exit')
  child.stdin.end(url.href)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(signal, () => {
    if (!child.killed) child.kill()
  })
  await closed
  record({ event: 'runtime_child_stopped' })
} catch {
  record({ event: 'runtime_provision_failed', secretsSuppressed: true })
  console.log('Futebol runtime provisioning failed; no credential details logged')
  process.exitCode = 1
} finally {
  if (migration) {
    try {
      if (created) await migration.query(`drop role ${login}`)
      record({ event: 'runtime_login_cleanup', completed: true })
    } catch { record({ event: 'runtime_login_cleanup', completed: false }); process.exitCode = 1 }
    await migration.end()
  }
}
