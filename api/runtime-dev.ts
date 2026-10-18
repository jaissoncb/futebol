import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRuntimePool, assertRuntimeRole, assertDatabaseBoundary } from './database.ts'
import { createDatabaseDispatch } from './routes.ts'
import { createG3Validator } from './g3.ts'
import { createApi } from './server.ts'
import { assertDevReadiness } from './dev-readiness.ts'
import { neonDevTarget } from './neon-dev-target.ts'
import { AuthenticationError, IdentityUnavailableError } from './auth.ts'
import { readSecretInput } from './secret-input.ts'
import { createStabilizationValidation } from './stabilization.ts'
import { HttpError } from './server.ts'
import { createNativeUserinfoFetch } from './userinfo-https.ts'

const record = (event: Record<string, string | number | boolean>) => appendFileSync(
  'D:/Projetos/_Handoff/Futebol/FUTEBOL_API_NEON_EVIDENCIAS_2026-10-18.jsonl',
  `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
const stabilizing = process.argv.includes('--stabilize')
const transportTrial = stabilizing && process.argv.includes('--transport-trial')
let stage = 'readiness'
try {
  assertDevReadiness()
  stage = 'stdin'
  const input = await readSecretInput()
  stage = 'target'
  const url = new URL(input)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== neonDevTarget.pooledHost
    || url.pathname !== '/futebol_dev' || !/^futebol_api_dev_[a-f0-9]{16}$/.test(decodeURIComponent(url.username))
    || !url.password || url.port && url.port !== '5432' || url.hash
    || [...url.searchParams.keys()].some(key => !['sslmode', 'channel_binding'].includes(key))) throw new Error('invalid_runtime_config')
  url.searchParams.set('sslmode', 'verify-full')
  const pool = createRuntimePool(url.href)
  pool.on('error', () => record({ event: 'runtime_pool_unavailable' }))
  try {
    stage = 'runtime_role'; await assertRuntimeRole(pool)
    stage = 'database_boundary'; await assertDatabaseBoundary(pool)
  }
  catch (error) {
    const known = ['42501','28P01','08006','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EAI_AGAIN','ENOTFOUND',
      'CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN']
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      && known.includes(error.code) ? error.code : 'UNCLASSIFIED'
    record({ event: 'runtime_boundary_failed', stage, code })
    await pool.end(); throw new Error('unsafe_runtime_role', { cause: error })
  }
  const validate = createG3Validator({ timeoutMs: 5000, onProof: proof => record({
    event: 'runtime_userinfo_confirmed', source: proof.source, elapsedMs: proof.elapsedMs,
    sameBearer: true, subjectMatches: true,
  }) })
  const stabilizationValidation = stabilizing ? createStabilizationValidation(record,fetch,undefined,
    transportTrial ? createNativeUserinfoFetch(record) : undefined) : undefined
  let lastAcceptedAccessDigest: string | undefined
  const dispatch = createDatabaseDispatch(pool)
  const identities = new Map<string, string>()
  const server = createApi({
    health: { status: 'dev', authentication: 'validated-dev' },
    authenticate: async (bearer, url) => {
      try {
        const principal = await (stabilizationValidation ? stabilizationValidation(bearer, url) : validate(bearer))
        const digest = createHash('sha256').update(bearer ?? '').digest('hex')
        record({ event: 'runtime_g3_accepted', fullContractVerified: true,
          priorAccessObserved: lastAcceptedAccessDigest !== undefined,
          tokenChanged: lastAcceptedAccessDigest !== undefined && lastAcceptedAccessDigest !== digest })
        lastAcceptedAccessDigest = digest
        return principal
      }
      catch (error) {
        record({ event: 'auth_denied_before_sql', httpStatus: error instanceof AuthenticationError ? 401 : 503,
          dependency: error instanceof IdentityUnavailableError ? error.dependency : 'token' })
        throw error
      }
    },
    dispatch: async (principal, method, path, body) => {
      if (path.pathname === '/__dev/stabilization') {
        if (!stabilizing || method !== 'GET') throw new HttpError(404, 'not_found')
        record({ event: 'stabilization_probe_accepted', phase: path.searchParams.get('phase') ?? '',
          mode: path.searchParams.get('mode') ?? '', databaseDispatched: false })
        return { accepted: true, databaseDispatched: false }
      }
      const result = await dispatch(principal, method, path, body)
      if (stabilizing && method === 'GET' && path.pathname === '/workspace' && path.searchParams.get('__dev_delay') === '1') {
        record({event:'stabilization_private_read_pending',sqlReadCompleted:true})
        await new Promise(resolve=>setTimeout(resolve,8000))
        record({event:'stabilization_private_read_released',privateResponseLogged:false})
      }
      const operation = method === 'POST' && path.pathname === '/groups' ? 'group_create'
        : method === 'PATCH' && /^\/groups\/[^/]+$/.test(path.pathname) ? 'group_update'
          : method === 'POST' && /^\/groups\/[^/]+\/players$/.test(path.pathname) ? 'player_create'
            : method === 'PATCH' && /^\/players\/[^/]+$/.test(path.pathname) ? 'player_update'
              : method === 'PUT' && /^\/matches\/[^/]+\/draw$/.test(path.pathname) ? 'draw_save'
                : method === 'GET' && /^\/groups\/[^/]+\/matches\/[^/]+$/.test(path.pathname) ? 'match_graph_read'
                  : method === 'GET' && /^\/groups\/[^/]+\/matches$/.test(path.pathname) ? 'history_read' : undefined
      if (operation) record({ event: 'domain_request_completed', operation, httpStatus: 200 })
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
  stage = 'listen'
  server.listen(8787, 'localhost', () => {
    record({ event: 'runtime_ready', restrictedRoleVerified: true, g3EvidenceVerified: true })
    console.log('Futebol API + Neon DEV ready; per-request G3 and RLS required')
  })
  // A bounded stabilization run self-closes normally, allowing the provisioner
  // to remove its temporary login without forced process termination.
  if (stabilizing) setTimeout(() => {
    if (stopping) return
    stopping = true
    record({event:'stabilization_budget_finished',budgetMinutes:transportTrial?5:20})
    server.closeAllConnections(); server.close(endPool)
  },(transportTrial?5:20)*60*1000).unref()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(signal, () => {
    if (stopping) return
    stopping = true
    server.closeAllConnections(); server.close(endPool)
  })
} catch {
  record({ event: 'runtime_start_failed', stage, secretsSuppressed: true })
  console.log('Futebol DEV runtime not started; configuration/evidence unavailable')
  process.exitCode = 1
}
