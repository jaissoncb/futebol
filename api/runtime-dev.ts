import { readFileSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRuntimePool, assertRuntimeRole, assertDatabaseBoundary } from './database.ts'
import { createDatabaseDispatch } from './routes.ts'
import { createG3Validator } from './g3.ts'
import { createApi } from './server.ts'
import { assertDevReadiness } from './dev-readiness.ts'
import { neonDevTarget } from './neon-dev-target.ts'
import { AuthenticationError, IdentityUnavailableError } from './auth.ts'

const record = (event: Record<string, string | number | boolean>) => appendFileSync(
  'D:/Projetos/_Handoff/Futebol/FUTEBOL_API_NEON_EVIDENCIAS_2026-10-18.jsonl',
  `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
try {
  assertDevReadiness()
  const input = readFileSync(0, 'utf8').trim()
  if (input.length > 16384) throw new Error('invalid_runtime_config')
  const url = new URL(input)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== neonDevTarget.pooledHost
    || url.pathname !== '/futebol_dev' || !/^futebol_api_dev_[a-f0-9]{16}$/.test(decodeURIComponent(url.username))
    || !url.password || url.port && url.port !== '5432' || url.hash
    || [...url.searchParams.keys()].some(key => !['sslmode', 'channel_binding'].includes(key))) throw new Error('invalid_runtime_config')
  url.searchParams.set('sslmode', 'verify-full')
  const pool = createRuntimePool(url.href)
  pool.on('error', () => record({ event: 'runtime_pool_unavailable' }))
  try { await assertRuntimeRole(pool); await assertDatabaseBoundary(pool) }
  catch { await pool.end(); throw new Error('unsafe_runtime_role') }
  const validate = createG3Validator({ timeoutMs: 5000 })
  const dispatch = createDatabaseDispatch(pool)
  const identities = new Map<string, string>()
  const server = createApi({
    health: { status: 'dev', authentication: 'validated-dev' },
    authenticate: async bearer => {
      try { return await validate(bearer) }
      catch (error) {
        record({ event: 'auth_denied_before_sql', httpStatus: error instanceof AuthenticationError ? 401 : 503,
          dependency: error instanceof IdentityUnavailableError ? error.dependency : 'token' })
        throw error
      }
    },
    dispatch: async (principal, method, path, body) => {
      const result = await dispatch(principal, method, path, body)
      if (path.pathname === '/me' && result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') {
        const key = createHash('sha256').update(JSON.stringify([principal.issuer, principal.subject])).digest('hex')
        const prior = identities.get(key)
        if (identities.size >= 1024 && !prior) identities.delete(identities.keys().next().value as string)
        identities.set(key, result.id)
        record({ event: 'me_completed', httpStatus: 200, internalUuidValid: /^[a-f0-9-]{36}$/i.test(result.id),
          repeatedInInstance: prior !== undefined, bootstrapStable: prior === undefined || prior === result.id })
      }
      return result
    },
  })
  let poolEnding = false, stopping = false
  const endPool = () => {
    if (poolEnding) return
    poolEnding = true
    void pool.end().catch(() => record({ event: 'runtime_pool_close_failed' }))
  }
  server.on('error', () => { record({ event: 'runtime_listen_failed' }); endPool(); process.exitCode = 1 })
  server.listen(8787, 'localhost', () => {
    record({ event: 'runtime_ready', restrictedRoleVerified: true, g3EvidenceVerified: true })
    console.log('Futebol API + Neon DEV ready; per-request G3 and RLS required')
  })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(signal, () => {
    if (stopping) return
    stopping = true
    server.closeAllConnections(); server.close(endPool)
  })
} catch {
  console.log('Futebol DEV runtime not started; configuration/evidence unavailable')
  process.exitCode = 1
}
