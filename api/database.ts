import { Pool } from 'pg'
import type { PoolClient } from 'pg'
import type { Principal } from './auth.ts'

export function createRuntimePool(connectionString: string, applicationName = 'futebol-dev-api'): Pool {
  // Remote credentials are backend-only; the isolated DEV runner uses stdin.
  // Never turn off certificate validation or log the DSN.
  let url: URL
  try { url = new URL(connectionString) } catch { throw new Error('invalid_database_config') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username
    || url.hash || !url.pathname || url.pathname === '/') throw new Error('invalid_database_config')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!local && (url.searchParams.get('sslmode') !== 'verify-full'
    || [...url.searchParams.keys()].some(key => /^ssl/i.test(key) && key !== 'sslmode'))) throw new Error('invalid_database_tls')
  if (!local) url.searchParams.delete('sslmode')
  return new Pool({ connectionString: url.href, ssl: local ? undefined : { rejectUnauthorized: true }, max: 5, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, statement_timeout: 15000, query_timeout: 17000,
    application_name: applicationName })
}

export async function assertRuntimeRole(pool: Pool): Promise<void> {
  const result = await pool.query<{ unsafe: boolean }>(`select (
    r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication
    or not pg_has_role(current_user, 'futebol_runtime', 'MEMBER')
    or has_schema_privilege(current_user, 'public', 'CREATE')
    or has_schema_privilege(current_user, 'private', 'CREATE')
    or has_database_privilege(current_user, current_database(), 'CREATE')
    or has_database_privilege(current_user, current_database(), 'TEMPORARY')
    or exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and c.relowner=r.oid)
    or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.proowner=r.oid)
    or exists (select 1 from pg_roles elevated where elevated.rolname not in (current_user, 'futebol_runtime')
      and pg_has_role(current_user, elevated.oid, 'MEMBER'))
    or exists (select 1 from pg_roles inherited where inherited.rolname='futebol_runtime'
      and (inherited.rolsuper or inherited.rolbypassrls or inherited.rolcreatedb
        or inherited.rolcreaterole or inherited.rolreplication))
  ) as unsafe from pg_roles r where r.rolname=current_user`)
  if (result.rows.length !== 1 || result.rows[0].unsafe !== false) throw new Error('unsafe_runtime_role')
}

export async function assertDatabaseBoundary(pool: Pool): Promise<void> {
  const result = await pool.query<{ safe: boolean }>(`select
    (select count(*)=11 and bool_and(c.relrowsecurity and pg_get_userbyid(c.relowner)='futebol_owner')
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and c.relkind='r')
    and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where n.nspname in ('public','private') and a.grantee=0 and a.privilege_type='EXECUTE') as safe`)
  if (result.rows[0]?.safe !== true) throw new Error('unsafe_database_boundary')
}

export async function withActor<T>(pool: Pool, principal: Principal, work: (client: PoolClient, id: string) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let discard = false
  try {
    await client.query('BEGIN')
    await client.query("select set_config('statement_timeout', '15000', true), set_config('lock_timeout', '5000', true)")
    // Identity comes only from the validated access token, never a request body.
    const result = await client.query<{ id: string }>('select private.bootstrap_user($1, $2) as id', [principal.issuer, principal.subject])
    const id = result.rows[0]?.id
    if (!id) throw new Error('invalid_actor')
    await client.query("select set_config('futebol.actor_id', $1, true)", [id])
    const value = await work(client, id)
    await client.query('COMMIT')
    return value
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { discard = true }
    throw error
  } finally { client.release(discard) }
}
