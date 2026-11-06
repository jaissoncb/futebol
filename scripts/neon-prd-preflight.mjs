// Dedicated read-only client. Never imports migrations, provisioners or deployers.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prepareDatabase } from './prepare-neon-prd-database.mjs'
import { readSecretInput } from '../api/secret-input.ts'

const root = resolve(import.meta.dirname, '..')
const host = 'ep-proud-mountain-bafo1u4d.c-8.eu-central-1.aws.neon.tech'
const preflightHash = '88535a71456c0c3f4b76e9a2410322870a7501ba7599db7d256b47bcc1f5dadd'
export async function checkPreflight() {
  assert.equal(process.versions.node.split('.')[0], '24')
  const prepared = await prepareDatabase()
  assert.equal(prepared.status, 'target_prepared_not_authorized')
  const target = JSON.parse(await readFile(resolve(root, 'deployment/neon-prd.database-target.json'), 'utf8'))
  assert.equal(target.branchId, 'br-divine-sun-badnm7ch')
  assert.equal(target.endpointId, 'ep-proud-mountain-bafo1u4d')
  assert.equal(target.unpooledHost, host)
  assert.equal(target.pooledHost, host.replace('.c-', '-pooler.c-'))
  const sql = await readFile(resolve(root, 'deployment/neon-prd-preflight.sql'), 'utf8')
  assert.equal(createHash('sha256').update(sql).digest('hex'), preflightHash)
  assert.equal(JSON.parse(await readFile(resolve(root, 'node_modules/pg/package.json'), 'utf8')).version, '8.23.1')
  return sql
}
export function clientOptions(password) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 4096 || password.includes('\0')) {
    throw new Error('invalid_hidden_input')
  }
  return { host, port: 5432, database: 'futebol_prd', user: 'neondb_owner', password,
    ssl: { rejectUnauthorized: true, servername: host, minVersion: 'TLSv1.2' },
    sslnegotiation: 'postgres', enableChannelBinding: true,
    connectionTimeoutMillis: 15000, query_timeout: 15000,
    options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000',
    application_name: 'futebol-prd-readonly-preflight', keepAlive: false }
}
const evidenceSql = `select current_database() as database,current_user as role,
  (select pg_get_userbyid(datdba) from pg_database where datname=current_database()) as owner,
  current_setting('server_version_num')::int / 10000 as postgres_major,
  current_setting('default_transaction_read_only')='on' as read_only,
  (select rolcreaterole from pg_roles where rolname=current_user) as can_create_role,
  has_database_privilege(current_user,current_database(),'CREATE') as can_create_in_database,
  (select pg_has_role(current_user,nspowner,'USAGE') from pg_namespace where nspname='public') as can_own_public_schema,
  (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as server_tls`

export function assertPreflightEvidence(row) {
  // pg_stat_ssl observes the backend connection, not the client's TLS socket.
  // Client certificate AND hostname verification remain mandatory.
  if (row.database !== 'futebol_prd' || row.role !== 'neondb_owner' || row.owner !== 'neondb_owner'
    || row.postgres_major !== 17 || row.read_only !== true || row.can_create_role !== true
    || row.can_create_in_database !== true || row.can_own_public_schema !== true
    || row.tls_verified !== true || row.fresh_schema !== true || typeof row.server_tls !== 'boolean') {
    throw new Error('prd_capabilities_rejected')
  }
}

export async function runReadOnlyPreflight(password, dependencies = {}) {
  let client
  let connected = false
  let evidence = {}
  try {
    const sql = await checkPreflight()
    const config = clientOptions(password)
    const createClient = dependencies.createClient ?? (options => new dependencies.Client(options))
    client = createClient(config)
    client.on('error', () => undefined)
    await client.connect()
    connected = true
    if (client.connection.stream.authorized !== true || client.connection.stream.servername !== host) {
      throw new Error('tls_identity_rejected')
    }
    // Exact reviewed, hashed read-only SQL. Never accepts SQL/path/target input.
    await client.query(sql)
    const { rows } = await client.query(evidenceSql)
    const row = rows[0]
    if (row) evidence = { database: row.database === 'futebol_prd' ? 'futebol_prd' : 'unexpected',
      role: row.role === 'neondb_owner' ? 'neondb_owner' : 'unexpected',
      owner: row.owner === 'neondb_owner' ? 'neondb_owner' : 'unexpected',
      postgres_major: Number.isInteger(row.postgres_major) ? row.postgres_major : null,
      tls_verified: true, fresh_schema: true,
      ...Object.fromEntries(['read_only','can_create_role','can_create_in_database','can_own_public_schema','server_tls']
        .map(key => [key, typeof row[key] === 'boolean' ? row[key] : null])) }
    if (rows.length !== 1) throw new Error('prd_capabilities_rejected')
    assertPreflightEvidence(evidence)
    return { status: 'PASS', ...row, tls_verified: true, fresh_schema: true,
      branchId: 'br-divine-sun-badnm7ch', branch_binding: 'user_confirmed_console_metadata' }
  } catch (error) {
    const reasons = ['prd_target_rejected','prd_migration_identity_rejected','prd_not_fresh',
      'tls_identity_rejected','prd_capabilities_rejected']
    const reason = reasons.includes(error?.message) ? error.message
      : error?.code === '28P01' ? 'authentication_failed'
        : error?.code === '3D000' ? 'database_missing' : 'connection_or_preflight_rejected'
    return { status: connected ? 'FAIL' : 'NOT_RUN', reason, ...evidence }
  } finally {
    if (client) {
      try { await client.end() } catch { /* Never print driver errors. */ }
      client.password = null
      if (client.connectionParameters) client.connectionParameters.password = null
    }
    password = null
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !['--check','--self-test','--read-only'].includes(process.argv[2])) throw new Error()
    await checkPreflight()
    const mode = process.argv[2]
    if (mode === '--check') console.log(JSON.stringify({ status: 'local_preflight_pass', network: false, client: 'pg 8.23.1' }))
    else {
      if (process.env.FUTEBOL_PRD_PREFLIGHT_PIPE !== 'v1' || process.stdin.isTTY) throw new Error()
      const input = JSON.parse(await readSecretInput())
      if (Object.keys(input).join(',') !== 'password') throw new Error()
      clientOptions(input.password)
      if (mode === '--self-test') console.log(JSON.stringify({ status: 'private_pipe_pass', network: false }))
      else {
        const { Client } = await import('pg')
        console.log(JSON.stringify(await runReadOnlyPreflight(input.password, { Client })))
      }
      input.password = null
    }
  } catch {
    console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'local_safety_check_rejected' }))
    process.exitCode = 1
  }
}
