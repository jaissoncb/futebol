import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { Pool } from 'pg'
import { assertRuntimeRole, withActor } from '../api/database.ts'
import { createDatabaseDispatch } from '../api/routes.ts'
import { createTokenValidator } from '../api/auth.ts'
import { createApi } from '../api/server.ts'

// Intentionally no environment DSN override: cannot accidentally target a remote DB.
// Container is dedicated to this cycle, labelled, loopback-only and fictitious.
const container = 'futebol-dev-kinde-neon-20261017'
const label = execFileSync('docker', ['inspect', '--format', '{{index .Config.Labels "project"}}', container], { encoding: 'utf8' }).trim()
assert.equal(label, 'futebol-dev')
const port = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim()
assert.equal(port, '127.0.0.1:55432')
const migration = new Pool({ host: '127.0.0.1', port: 55432, database: 'futebol_dev', user: 'postgres', max: 5 })
const runtime = new Pool({ host: '127.0.0.1', port: 55432, database: 'futebol_dev', user: 'futebol_dev_login', max: 3 })
const principal = (subject: string) => ({ issuer: 'https://fixture.test', subject })
const fixturePrefix = randomUUID()
const owner = principal(`${fixturePrefix}:owner`), admin = principal(`${fixturePrefix}:admin`)
const member = principal(`${fixturePrefix}:member`), outsider = principal(`${fixturePrefix}:outsider`)
const as = <T>(p: typeof owner, work: Parameters<typeof withActor<T>>[2]) => withActor(runtime, p, work)
async function rejected(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => (error as { code?: string }).code === code)
}

void test('isolated local PostgreSQL: identity, final runtime ACL/RLS, domain and concurrency', async t => {
  t.after(async () => { await runtime.end(); await migration.end() })
  assert.equal((await migration.query<Record<string, unknown>>('select current_database() as name')).rows[0].name, 'futebol_dev')
  const initialized = (await migration.query<Record<string, unknown>>("select to_regclass('private.app_users') as id")).rows[0].id
  if (!initialized) {
    assert.equal((await migration.query<Record<string, unknown>>("select count(*)::int as count from pg_tables where schemaname='public'")).rows[0].count, 0)
    for (const name of ['001_identity','002_domain','003_security','004_save_match_draw']) {
      await migration.query<Record<string, unknown>>(await readFile(new URL(`../database/${name}.sql`, import.meta.url), 'utf8'))
    }
    await migration.query<Record<string, unknown>>('create role futebol_dev_login login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls')
    await migration.query<Record<string, unknown>>('grant futebol_runtime to futebol_dev_login')
  }
  await migration.query(await readFile(new URL('../database/005_database_boundary.sql',import.meta.url),'utf8'))
  await t.test('restricted runtime and no PUBLIC function execution/table leakage', async () => {
    await assertRuntimeRole(runtime)
    await assert.rejects(assertRuntimeRole(migration), /unsafe_runtime_role/)
    const unprotected = await migration.query<Record<string, unknown>>(`select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and c.relkind='r' and not c.relrowsecurity`)
    assert.equal(unprotected.rowCount, 0)
    const publicExecute = await migration.query<Record<string, unknown>>(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where n.nspname in ('public','private') and a.grantee=0 and a.privilege_type='EXECUTE'`)
    assert.equal(publicExecute.rowCount, 0)
    await rejected(runtime.query<Record<string, unknown>>('select * from private.external_identities'), '42501')
    await rejected(runtime.query<Record<string, unknown>>('create table public.forbidden(id int)'), '42501')
    await rejected(runtime.query<Record<string, unknown>>('create schema forbidden'), '42501')
    await rejected(runtime.query<Record<string, unknown>>('create temporary table forbidden(id int)'), '42501')
    await rejected(runtime.query<Record<string, unknown>>('set role futebol_owner'), '42501')
  })
  let ownerId: string, adminId: string, memberId: string
  await t.test('20 simultaneous bootstraps give one UUID; no orphans and issuer separation', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => as(owner, (_c, id) => Promise.resolve(id))))
    assert.equal(new Set(ids).size, 1); ownerId = ids[0]
    const otherIssuer = await as({ ...owner, issuer: 'https://different.test' }, (_c, id) => Promise.resolve(id))
    assert.notEqual(otherIssuer, ownerId)
    adminId = await as(admin, (_c,id) => Promise.resolve(id)); memberId = await as(member, (_c, id) => Promise.resolve(id))
    await as(outsider, (_c, id) => Promise.resolve(id))
    const orphan = await migration.query<Record<string, unknown>>(`select u.id from private.app_users u left join private.external_identities i on i.user_id=u.id
      left join public.profiles p on p.id=u.id where i.user_id is null or p.id is null`)
    assert.equal(orphan.rowCount, 0)
    assert.equal((await as(owner, c => c.query<Record<string, unknown>>('select * from public.group_members'))).rowCount, 0)
  })
  let groupId: string
  await t.test('create_group is atomic and enforces first owner/input/context', async () => {
    groupId = await as(owner, async c => (await c.query<Record<string, unknown>>("select public.create_group('Fixture group',1::smallint,'futsal') as id")).rows[0].id as string)
    const rows = await as(owner, c => c.query<Record<string, unknown>>('select * from public.group_members where group_id=$1', [groupId]))
    assert.equal(rows.rowCount,1); assert.equal(rows.rows[0].user_id,ownerId!); assert.equal(rows.rows[0].role,'owner')
    await rejected(runtime.query<Record<string, unknown>>("select public.create_group('No actor',1::smallint,'futsal')"),'42501')
    for (const args of [[null,1,'futsal'],['x',1,'futsal'],['Valid',21,'futsal']]) {
      await rejected(as(owner, c => c.query<Record<string, unknown>>('select public.create_group($1,$2::smallint,$3)', args)), '22023')
    }
    await as(owner, c => c.query<Record<string, unknown>>("insert into public.group_members(group_id,user_id,role) values($1,$2,'admin'),($1,$3,'member')", [groupId,adminId!,memberId!]))
    await rejected(as(owner, c => c.query<Record<string, unknown>>("insert into public.group_members(group_id,user_id,role) values($1,$2,'owner')", [groupId,randomUUID()])), '42501')
  })
  const playerIds: string[] = [randomUUID(),randomUUID()]
  await t.test('owner/admin/member/outsider matrix and minimum column grants', async () => {
    for (const [index,p] of [owner,admin].entries()) {
      // Runtime cannot choose IDs; migration fixture supplies stable IDs after a normal insert.
      const row = await as(p,c => c.query<Record<string, unknown>>("insert into public.players(group_id,name,skill_rating) values($1,$2,3) returning id",[groupId,`Fixture ${index}`]))
      playerIds[index]=row.rows[0].id as string
    }
    for (const p of [member,outsider]) await rejected(as(p,c => c.query<Record<string, unknown>>("insert into public.players(group_id,name) values($1,'Denied')",[groupId])),'42501')
    assert.equal((await as(member,c => c.query<Record<string, unknown>>('select * from public.players'))).rowCount,2)
    assert.equal((await as(outsider,c => c.query<Record<string, unknown>>('select * from public.players'))).rowCount,0)
    assert.equal((await as(admin,c => c.query<Record<string, unknown>>("update public.groups set name='Denied' where id=$1",[groupId]))).rowCount,0)
    assert.equal((await as(owner,c => c.query<Record<string, unknown>>("update public.groups set name='Updated' where id=$1",[groupId]))).rowCount,1)
    await rejected(as(owner,c => c.query<Record<string, unknown>>('update public.groups set created_by=$1 where id=$2',[adminId!,groupId])),'42501')
    await rejected(as(owner,c => c.query<Record<string, unknown>>('delete from public.players')),'42501')
    for (const table of ['matches','match_players','teams','team_assignments','draw_runs']) {
      await rejected(as(owner,c => c.query<Record<string, unknown>>(`delete from public.${table}`)),'42501')
    }
  })
  const matchId = randomUUID()
  let payload: Record<string, unknown>
  await t.test('20 concurrent saves/retries are idempotent; graph atomic and snapshots immutable', async () => {
    payload = { group_id: groupId, match_date: '2026-10-17', team_count: 2, players_on_court: 1,
      participants: playerIds.map((player_id,index) => ({ player_id, player_name_snapshot: `Fixture ${index}`,
        skill_rating_snapshot: 3, is_goalkeeper_snapshot: false })),
      teams: [{team_index:1,name:'Team A'},{team_index:2,name:'Team B'}],
      assignments: playerIds.map((player_id,index) => ({player_id,team_index:index+1,starts_as_reserve:false,assignment_source:'draw'})),
      draw_runs: [{run_number:1,seed:'fixture-seed',algorithm_version:'fixture-v1',balance_score:0,accepted:true}] }
    const save = (p: typeof owner, value = payload, attemptId = matchId) => as(p,c => c.query<Record<string, unknown>>('select public.save_match_draw($1,$2::jsonb) as id',[attemptId,JSON.stringify(value)]))
    const results = await Promise.all(Array.from({length:20},()=>save(owner)))
    assert.ok(results.every(x=>x.rows[0].id===matchId))
    await rejected(save(owner,{...payload,name:'Different'}),'22023')
    await rejected(save(admin),'40001'); await rejected(save(member),'42501'); await rejected(save(outsider),'42501')
    await rejected(save(owner,{...payload,participants:[]},randomUUID()),'22023')
    const tables = ['matches','match_players','teams','team_assignments','draw_runs']
    for (const [index,table] of tables.entries()) {
      assert.equal((await as(owner,c=>c.query<Record<string, unknown>>(`select * from public.${table}`))).rowCount,[1,2,2,2,1][index])
      assert.equal((await as(outsider,c=>c.query<Record<string, unknown>>(`select * from public.${table}`))).rowCount,0)
    }
    await as(owner,c=>c.query<Record<string, unknown>>("update public.players set name='Changed after save',active=false where id=$1",[playerIds[0]]))
    assert.equal((await as(member,c=>c.query<Record<string, unknown>>('select player_name_snapshot from public.match_players where player_id=$1',[playerIds[0]]))).rows[0].player_name_snapshot,'Fixture 0')
    await save(owner) // payload identity is snapshot, independent of edited player
  })
  await t.test('membership FOR SHARE prevents demotion while save transaction is in flight', async () => {
    let release!: () => void, ready!: () => void
    const held = new Promise<void>(resolve=>{release=resolve}), locked = new Promise<void>(resolve=>{ready=resolve})
    const save = as(admin,async c=>{
      await c.query<Record<string, unknown>>('select public.save_match_draw($1,$2::jsonb)',[randomUUID(),JSON.stringify(payload)])
      ready(); await held
    })
    await locked
    try {
      await rejected(as(owner,async c=>{
        await c.query<Record<string, unknown>>("set local lock_timeout='150ms'")
        return c.query<Record<string, unknown>>("update public.group_members set role='member' where group_id=$1 and user_id=$2",[groupId,adminId!])
      }),'55P03')
    } finally { release(); await save }
    await as(owner,c=>c.query<Record<string, unknown>>("update public.group_members set role='member' where group_id=$1 and user_id=$2",[groupId,adminId!]))
    await rejected(as(admin,c=>c.query<Record<string, unknown>>('select public.save_match_draw($1,$2::jsonb)',[randomUUID(),JSON.stringify(payload)])),'42501')
  })
  await t.test('pool alternates users without leaking actor after commit or rollback; disabled actor denied', async () => {
    await Promise.all(Array.from({length:30},(_,i)=>as(i%2 ? owner : outsider,async(c,id)=>{
      const actor=(await c.query<Record<string, unknown>>('select private.actor_id() as id')).rows[0].id
      assert.equal(actor,id)
      assert.equal((await c.query<Record<string, unknown>>('select * from public.groups')).rowCount,i%2 ? 1 : 0)
    })))
    await assert.rejects(as(owner,()=>Promise.reject(new Error('fixture rollback'))),/fixture rollback/)
    const clients=await Promise.all(Array.from({length:3},()=>runtime.connect()))
    try { for(const c of clients) assert.equal((await c.query<Record<string, unknown>>('select private.actor_id() as id')).rows[0].id,null) }
    finally { clients.forEach(c=>c.release()) }
    await migration.query<Record<string, unknown>>('update private.app_users set disabled_at=now() where id=$1',[memberId!])
    await rejected(as(member,()=>Promise.resolve(true)),'42501')
  })
  await t.test('fixed API dispatch: body cannot inject identity/role; outsider cannot access graph', async () => {
    const dispatch=createDatabaseDispatch(runtime)
    const call=(p: typeof owner, method: string, path: string, body?: unknown)=>dispatch(p,method,new URL(path,'http://localhost:8787'),body)
    await assert.rejects(call(owner,'POST','/me',{user_id:randomUUID()}),/invalid_fields/)
    await assert.rejects(call(owner,'POST','/groups',{name:'Valid',sport:'futsal',defaultPlayersOnCourt:5,role:'owner'}),/invalid_fields/)
    await assert.rejects(call(outsider,'GET',`/groups/${groupId}/matches/${matchId}`),/unavailable/)
    assert.equal((await call(owner,'GET',`/groups/${groupId}/matches/${matchId}`) as {teams:unknown[]}).teams.length,2)
    await assert.rejects(call(owner,'GET',`/groups/${groupId}/matches?page=-1`),/invalid_page/)
  })
  await t.test('real local HTTP + signed fixture JWT + restricted PostgreSQL; rejected tokens never bootstrap', async () => {
    const keys=await generateKeyPair('RS256')
    const policy={issuer:owner.issuer,jwksUri:`${owner.issuer}/jwks`,audience:'fixture-api',clientId:'fixture-client',maxLifetimeSeconds:900}
    let dispatchCalls=0
    const dispatch=createDatabaseDispatch(runtime)
    const server=createApi({
      authenticate:createTokenValidator(policy,p=>Promise.resolve(p.fixture_kind==='user_access'),
        createLocalJWKSet({keys:[{...await exportJWK(keys.publicKey),alg:'RS256',kid:'fixture'}]})),
      dispatch:(...args)=>{dispatchCalls++;return dispatch(...args)},
    })
    server.listen(0,'127.0.0.1');await once(server,'listening')
    const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const now=Math.floor(Date.now()/1000)
    const sign=(claims:Record<string,unknown>={})=>new SignJWT({iss:owner.issuer,aud:policy.audience,azp:policy.clientId,
      sub:owner.subject,iat:now,exp:now+600,fixture_kind:'user_access',...claims})
      .setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(keys.privateKey)
    try {
      const before=await migration.query<{count:number}>('select count(*)::int as count from private.app_users')
      for(const claims of [{aud:'other-api'},{azp:'other-client'},{fixture_kind:'id'},{gty:['client_credentials']},{exp:now-60}]) {
        const response=await fetch(`${base}/me`,{headers:{Authorization:`Bearer ${await sign({...claims,sub:'must-not-provision'})}`}})
        assert.equal(response.status,401)
      }
      assert.equal(dispatchCalls,0)
      assert.equal((await migration.query<{count:number}>('select count(*)::int as count from private.app_users')).rows[0].count,before.rows[0].count)
      const auth={Authorization:`Bearer ${await sign()}`}
      const me=await fetch(`${base}/me`,{headers:auth})
      assert.equal(me.status,200);assert.equal((await me.json() as {id:string}).id,ownerId!)
      const detail=await fetch(`${base}/groups/${groupId}/matches/${matchId}`,{headers:auth})
      assert.equal(detail.status,200);assert.equal((await detail.json() as {teams:unknown[]}).teams.length,2)
      const outsiderAuth={Authorization:`Bearer ${await sign({sub:outsider.subject})}`}
      assert.equal((await fetch(`${base}/groups/${groupId}/matches/${matchId}`,{headers:outsiderAuth})).status,404)
      assert.equal((await fetch(`${base}/workspace`,{headers:outsiderAuth})).headers.get('cache-control'),'no-store')
    } finally {server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
  })
})
