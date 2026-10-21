// Separate operator process. Never imported into the Function; no migrations,
// domain queries, empty-database suites, file-based secrets or password rotation.
import { randomBytes, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRuntimePool, assertRuntimeRole, assertDatabaseBoundary } from '../api/database.ts'
import { validateNeonDevConnection, neonDevTarget } from '../api/neon-dev-target.ts'
import { readSecretInput } from '../api/secret-input.ts'
import { candidate, candidateSha256 } from './send-neon-dev-upload.mjs'

const login = 'futebol_api_dev_functions'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function validateOperatorInput(input) {
  try {
    if (!input || typeof input.adminConnection !== 'string'
      || typeof input.apiKey !== 'string' || !/^[\x21-\x7e]{16,4096}$/.test(input.apiKey)) throw new Error()
    const raw = new URL(input.adminConnection)
    const keys = [...raw.searchParams.keys()]
    const url = validateNeonDevConnection(input.adminConnection)
    if (keys.length !== new Set(keys).size
      || url.searchParams.has('channel_binding') && url.searchParams.get('channel_binding') !== 'require') throw new Error()
    // A dedicated direct connection is used only by the operator process.
    url.hostname = neonDevTarget.host
    return url
  } catch { throw new Error('invalid_operator_input') }
}

const loginSafetySql = `select (
  r.rolcanlogin and r.rolinherit and not r.rolsuper and not r.rolbypassrls
  and not r.rolcreatedb and not r.rolcreaterole and not r.rolreplication
  and r.rolconfig is null
  and pg_has_role(r.oid,'futebol_runtime','MEMBER')
  and not exists(select 1 from pg_auth_members m where m.member=r.oid
    and (m.admin_option or pg_get_userbyid(m.roleid)<>'futebol_runtime'))
  and not exists(select 1 from pg_namespace n where n.nspowner=r.oid)
  and not exists(select 1 from pg_class c where c.relowner=r.oid)
  and not exists(select 1 from pg_proc p where p.proowner=r.oid)
  and not exists(select 1 from pg_type t where t.typowner=r.oid)
  and not exists(select 1 from pg_database d where d.datdba=r.oid)
  and not exists(select 1 from pg_namespace n where has_schema_privilege(r.oid,n.oid,'CREATE'))
  and has_database_privilege(r.oid,current_database(),'CONNECT')
  and not has_database_privilege(r.oid,current_database(),'CREATE')
  and not has_database_privilege(r.oid,current_database(),'TEMPORARY')
) as safe from pg_roles r where r.rolname=$1`

export async function provisionFunctionLogin(adminConnection, runtimePassword, options = {}) {
  let adminPool, runtimePool, client, transaction = false, created = false, committed = false
  try {
    const url = validateOperatorInput({ adminConnection, apiKey: 'synthetic-validation-only' })
    const poolFactory = options.createPool ?? createRuntimePool
    adminPool = poolFactory(url.href, 'futebol-functions-operator')
    adminPool.on('error', () => undefined)
    client = await adminPool.connect()
    const actual = await client.query('select current_database() as database,current_user as role')
    if (actual.rows[0]?.database !== neonDevTarget.database || actual.rows[0]?.role !== neonDevTarget.migrationRole) throw new Error()
    await (options.checkBoundary ?? assertDatabaseBoundary)(adminPool)
    await client.query('BEGIN'); transaction = true
    await client.query("set local lock_timeout='5000'")
    await client.query("select pg_advisory_xact_lock(hashtextextended('futebol.functions.login',0))")
    const existing = await client.query('select rolname from pg_roles where rolname=$1', [login])
    let password = runtimePassword
    if (existing.rows.length === 0) {
      // Only generated hex is interpolated. No operator input enters a SQL literal.
      password = randomBytes(32).toString('hex')
      await client.query(`create role ${login} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`)
      created = true
      await client.query(`grant futebol_runtime to ${login}`)
    }
    const inspected = await client.query(loginSafetySql, [login])
    if (inspected.rows[0]?.safe !== true) throw new Error()
    if (!password || typeof password !== 'string' || password.length > 4096) {
      throw new Error('existing_login_requires_password')
    }
    await client.query('COMMIT'); transaction = false; committed = true
    client.release(); client = undefined
    await adminPool.end(); adminPool = undefined
    // The administrative connection is closed before the restricted verification.
    url.username = login; url.password = password; url.hostname = neonDevTarget.pooledHost
    runtimePool = poolFactory(url.href, 'futebol-functions-login-check')
    runtimePool.on('error', () => undefined)
    await (options.checkRole ?? assertRuntimeRole)(runtimePool)
    await (options.checkBoundary ?? assertDatabaseBoundary)(runtimePool)
    return { status: created ? 'created_verified' : 'existing_verified', password }
  } catch (error) {
    if (transaction && client) { try { await client.query('ROLLBACK') } catch { /* sanitized below */ } }
    throw new Error(error instanceof Error && error.message === 'existing_login_requires_password'
      ? 'existing_login_requires_password' : created && committed ? 'login_created_verification_failed' : 'operator_provision_failed')
  } finally {
    client?.release()
    if (runtimePool) { try { await runtimePool.end() } catch { /* no raw error */ } }
    if (adminPool) { try { await adminPool.end() } catch { /* no raw error */ } }
  }
}

export async function verifyCandidate() {
  if (process.versions.node.split('.')[0] !== '24') throw new Error('node24_required')
  const manifest = JSON.parse(await readFile(resolve(root, candidate, 'manifest.json'), 'utf8'))
  if (manifest.zip.sha256 !== candidateSha256
    || createHash('sha256').update(await readFile(resolve(root, candidate, 'function.zip'))).digest('hex') !== candidateSha256) throw new Error('candidate_mismatch')
  for (const file of manifest.stage1Files) {
    if (createHash('sha256').update(await readFile(resolve(root, file.path))).digest('hex') !== file.sha256) throw new Error('source_mismatch')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const mode = process.argv[2]
    if (process.argv.length !== 3 || !['--check', '--validate', '--provision'].includes(mode)) throw new Error()
    await verifyCandidate()
    if (mode === '--check') console.log(JSON.stringify({ status: 'local_preflight_passed', network: false }))
    else {
      if (process.env.FUTEBOL_OPERATOR_PIPE !== 'v1' || process.stdin.isTTY || process.stdout.isTTY) throw new Error()
      const input = JSON.parse(await readSecretInput())
      if (mode === '--validate') {
        validateOperatorInput(input)
        console.log(JSON.stringify({ status: 'input_validated_locally', network: false }))
      } else {
        // stdout is a PRIVATE redirected pipe, consumed by the wrapper, never a
        // terminal/log. The management key is not accepted by this phase.
        if (Object.hasOwn(input, 'apiKey')) throw new Error()
        console.log(JSON.stringify(await provisionFunctionLogin(input.adminConnection, input.runtimePassword)))
      }
    }
  } catch (error) {
    const allowed = ['existing_login_requires_password', 'login_created_verification_failed']
    console.log(JSON.stringify({ status: error instanceof Error && allowed.includes(error.message) ? error.message : 'operator_operation_failed' }))
    process.exitCode = 1
  }
}
