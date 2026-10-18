import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import type { Pool } from 'pg'
import { assertRuntimeRole, createRuntimePool, withActor } from '../api/database.ts'
import { neonDevTarget, validateNeonDevConnection } from '../api/neon-dev-target.ts'
import { readSecretInput } from '../api/secret-input.ts'

// Only the endpoint just created/read back in the authenticated Free console.
// Credentials arrive on stdin from the operator's masked prompt, never argv/env/file.
const tests: { name: string; status: 'PASS' | 'FAIL'; code?: string }[] = []
let stage = 'connection_preflight'
let migration: Pool | undefined
let runtime: Pool | undefined
let loginCreated = false
const login = `futebol_probe_${randomUUID().replaceAll('-', '').slice(0, 16)}`
const ids: string[] = []
let groupId: string | undefined
const principal = (subject: string) => ({ issuer: 'https://fixture.test', subject })
const fixture = `neon-native-fixture:${randomUUID()}`
const owner = principal(`${fixture}:owner`), outsider = principal(`${fixture}:outsider`)
function pass(name: string) { tests.push({ name, status: 'PASS' }); console.log(`PASS ${name}`) }
function fail(name: string, error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && /^[A-Z0-9_]{2,32}$/.test(error.code) ? error.code : 'UNCLASSIFIED'
  tests.push({ name, status: 'FAIL', code })
  console.log(`FAIL ${name} (${code}); diagnostic details suppressed to protect credentials`)
  process.exitCode = 1
}
async function denied(work: Promise<unknown>) {
  await assert.rejects(work, (error: unknown) => Boolean(error && typeof error === 'object'
    && 'code' in error && error.code === '42501'))
}
try {
  const input = await readSecretInput()
  const url = validateNeonDevConnection(input)
  migration = createRuntimePool(url.href)
  const actual = await migration.query<{ database: string; role: string; empty: boolean }>(`select current_database() as database,
    current_user as role, not exists(select 1 from public.profiles) and not exists(select 1 from public.groups) as empty`)
  assert.deepEqual(actual.rows[0], { database: 'futebol_dev', role: 'futebol_dev_owner', empty: true })
  pass(stage)
  stage = 'restricted_native_login'
  // Only generated hex identifiers/password are interpolated; no credential logs.
  const password = randomBytes(32).toString('hex')
  await migration.query(`create role ${login} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`)
  loginCreated = true
  await migration.query(`grant futebol_runtime to ${login}`)
  url.username = login; url.password = password
  url.hostname = neonDevTarget.pooledHost // Exercise Neon pooled endpoint + bounded pg pool.
  runtime = createRuntimePool(url.href)
  await assertRuntimeRole(runtime)
  await assert.rejects(assertRuntimeRole(migration), /unsafe_runtime_role/)
  await denied(runtime.query('set role futebol_owner'))
  await denied(runtime.query('create schema forbidden_neon_native_fixture'))
  await denied(runtime.query('create temporary table forbidden_neon_native_fixture(id int)'))
  await denied(runtime.query('select * from private.external_identities'))
  pass(stage)
  stage = 'bootstrap_20_concurrent'
  const bootstrap = await Promise.all(Array.from({ length: 20 }, () => withActor(runtime!, owner, (_client, id) => Promise.resolve(id))))
  assert.equal(new Set(bootstrap).size, 1)
  ids.push(bootstrap[0])
  const otherIssuer = await withActor(runtime, { ...owner, issuer: 'https://other-fixture.test' }, (_client, id) => Promise.resolve(id))
  ids.push(otherIssuer); assert.notEqual(otherIssuer, ids[0])
  const outsiderId = await withActor(runtime, outsider, (_client, id) => Promise.resolve(id))
  ids.push(outsiderId)
  pass(stage)
  stage = 'native_rls_and_transactions'
  groupId = await withActor(runtime, owner, async client => (await client.query<{ id: string }>(
    "select public.create_group('Neon native DEV fixture',1::smallint,'futsal') as id")).rows[0].id)
  const visible = await withActor(runtime, outsider, client => client.query('select id from public.groups where id=$1', [groupId]))
  assert.equal(visible.rowCount, 0)
  await denied(withActor(runtime, outsider, client => client.query("insert into public.players(group_id,name) values($1,'Denied fixture')", [groupId])))
  await assert.rejects(withActor(runtime, owner, async client => {
    await client.query("insert into public.players(group_id,name) values($1,'Rollback fixture')", [groupId])
    throw new Error('fixture_rollback')
  }), /fixture_rollback/)
  const clean = await withActor(runtime, owner, client => client.query('select id from public.players where group_id=$1', [groupId]))
  assert.equal(clean.rowCount, 0)
  pass(stage)
  stage = 'pooled_30_requests_actor_isolation'
  await Promise.all(Array.from({ length: 30 }, async (_, index) => {
    const subject = index % 2 ? owner : outsider
    const expected = index % 2 ? ids[0] : outsiderId
    await withActor(runtime!, subject, async (client, id) => {
      assert.equal(id, expected)
      const actor = await client.query<{ id: string }>('select private.actor_id() as id')
      assert.equal(actor.rows[0].id, expected)
    })
  }))
  const cleared = await Promise.all(Array.from({ length: 10 }, () => runtime!.query<{ cleared: boolean }>(
    "select nullif(current_setting('futebol.actor_id',true),'') is null as cleared")))
  assert.ok(cleared.every(result => result.rows[0].cleared))
  pass(stage)
  stage = 'disabled_user_rejected'
  await migration.query('update private.app_users set disabled_at=now() where id=$1', [ids[0]])
  await denied(withActor(runtime, owner, () => Promise.resolve(true)))
  pass(stage)
} catch (error) {
  fail(stage, error)
} finally {
  try {
    await runtime?.end()
    if (migration) {
      if (groupId) await migration.query('delete from public.groups where id=$1', [groupId])
      if (ids.length) {
        await migration.query('delete from private.external_identities where user_id=any($1::uuid[])', [ids])
        await migration.query('delete from private.app_users where id=any($1::uuid[])', [ids])
      }
      if (loginCreated) await migration.query(`drop role ${login}`)
      pass('cleanup_ephemeral_login_and_fixtures')
    }
  } catch (error) { fail('cleanup_ephemeral_login_and_fixtures', error) }
  await migration?.end()
  const latest = 'D:/Projetos/_Handoff/Futebol/FUTEBOL_NEON_NATIVE_EVIDENCIAS_2026-10-18.json'
  const history = 'D:/Projetos/_Handoff/Futebol/FUTEBOL_NEON_NATIVE_HISTORICO_2026-10-18.jsonl'
  if (existsSync(latest)) appendFileSync(history, `${JSON.stringify(JSON.parse(readFileSync(latest, 'utf8')))}\n`)
  const evidence = { at: new Date().toISOString(), projectId: 'ancient-wildflower-55433050',
    branch: 'dev', pooled: true, tls: 'verify-full', tests }
  appendFileSync(history, `${JSON.stringify(evidence)}\n`)
  writeFileSync(latest, JSON.stringify(evidence, null, 2))
}
