import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { withActor, assertRuntimeRole, assertDatabaseBoundary } from '../api/database.ts'
import { createDatabaseDispatch } from '../api/routes.ts'

export async function runNeonDomainPreflight(migration: Pool, runtime: Pool,
  record: (event: Record<string, string | boolean>) => void) {
  const prefix = `neon-domain-fixture:${randomUUID()}:`
  const principal = (name: string) => ({ issuer: 'https://fixture.test', subject: prefix + name })
  const owner = principal('owner'), admin = principal('admin'), member = principal('member'), outsider = principal('outsider')
  const as = <T>(p: typeof owner, work: Parameters<typeof withActor<T>>[2]) => withActor(runtime, p, work)
  const rejected = (work: Promise<unknown>, code: string) => assert.rejects(work, (error: unknown) => Boolean(error
    && typeof error === 'object' && 'code' in error && error.code === code))
  let groupId: string | undefined
  let cleanupFailed = false
  let cleanupFailure: unknown
  let stage = 'current_database_boundary'
  const pass = () => record({ event: 'domain_preflight', test: stage, status: 'PASS' })
  const cleanupFixtures = async () => {
    const cleanup = await migration.connect()
    try {
      await cleanup.query('BEGIN')
      if (groupId) {
        // Delete our historical graphs before our roster; keep the FKs intact.
        await cleanup.query('delete from public.matches where group_id=$1',[groupId])
        await cleanup.query('delete from public.groups where id=$1',[groupId])
      }
      const removed = await cleanup.query<{ user_id: string }>(
        "delete from private.external_identities where issuer='https://fixture.test' and subject like $1 returning user_id",[`${prefix}%`])
      if (removed.rows.length) await cleanup.query('delete from private.app_users where id=any($1::uuid[])',[removed.rows.map(row => row.user_id)])
      await cleanup.query('COMMIT')
      record({ event: 'domain_fixture_cleanup', completed: true })
    } catch (error) { await cleanup.query('ROLLBACK').catch(() => undefined); throw error }
    finally { cleanup.release() }
  }
  try {
    await assertRuntimeRole(runtime); await assertDatabaseBoundary(runtime); pass()
    const ownerId = await as(owner, (_client, id) => Promise.resolve(id))
    const adminId = await as(admin, (_client, id) => Promise.resolve(id))
    const memberId = await as(member, (_client, id) => Promise.resolve(id))
    await as(outsider, () => Promise.resolve(true))
    groupId = await as(owner, async client => (await client.query<{ id: string }>(
      "select public.create_group('Neon domain fixture',1::smallint,'futsal') as id")).rows[0].id)
    await migration.query("insert into public.group_members(group_id,user_id,role) values($1,$2,'admin'),($1,$3,'member')", [groupId,adminId,memberId])
    stage = 'owner_admin_member_outsider_matrix'
    const players: string[] = []
    for (const [index, actor] of [owner,admin].entries()) {
      const inserted = await as(actor, client => client.query<{ id: string }>(
        "insert into public.players(group_id,name,skill_rating) values($1,$2,3) returning id",[groupId,`Fixture ${index}`]))
      players.push(inserted.rows[0].id)
    }
    for (const actor of [member,outsider]) await rejected(as(actor,client => client.query(
      "insert into public.players(group_id,name) values($1,'Denied fixture')",[groupId])),'42501')
    assert.equal((await as(member,client => client.query('select id from public.players where group_id=$1',[groupId]))).rowCount,2)
    assert.equal((await as(outsider,client => client.query('select id from public.players where group_id=$1',[groupId]))).rowCount,0)
    assert.equal((await as(admin,client => client.query("update public.groups set name='Denied' where id=$1",[groupId]))).rowCount,0)
    await rejected(as(owner,client => client.query('update public.groups set created_by=$1 where id=$2',[adminId,groupId])),'42501')
    for (const table of ['matches','match_players','teams','team_assignments','draw_runs']) await rejected(
      as(owner,client => client.query(`delete from public.${table}`)),'42501')
    assert.notEqual(ownerId, adminId); pass()
    stage = 'save_20_concurrent_idempotency_and_snapshots'
    const matchId = randomUUID()
    const payload = { group_id: groupId, match_date: '2026-10-18', team_count: 2, players_on_court: 1,
      participants: players.map((player_id,index) => ({ player_id, player_name_snapshot: `Fixture ${index}`,
        skill_rating_snapshot: 3, is_goalkeeper_snapshot: false })),
      teams: [{team_index:1,name:'Team A'},{team_index:2,name:'Team B'}],
      assignments: players.map((player_id,index) => ({ player_id,team_index:index+1,starts_as_reserve:false,assignment_source:'draw' })),
      draw_runs: [{run_number:1,seed:'fixture-seed',algorithm_version:'fixture-v1',balance_score:0,accepted:true}] }
    const save = (actor: typeof owner, value: unknown = payload, attempt = matchId) => as(actor, client => client.query<{ id: string }>(
      'select public.save_match_draw($1,$2::jsonb) as id',[attempt,JSON.stringify(value)]))
    const results = await Promise.all(Array.from({length:20},() => save(owner)))
    assert.ok(results.every(result => result.rows[0].id === matchId))
    await rejected(save(owner,{...payload,name:'Different'}),'22023')
    await rejected(save(admin),'40001'); await rejected(save(member),'42501'); await rejected(save(outsider),'42501')
    for (const [index,table] of ['matches','match_players','teams','team_assignments','draw_runs'].entries()) {
      assert.equal((await as(owner,client => client.query(`select * from public.${table} where group_id=$1`,[groupId]))).rowCount,[1,2,2,2,1][index])
      assert.equal((await as(outsider,client => client.query(`select * from public.${table} where group_id=$1`,[groupId]))).rowCount,0)
    }
    await as(owner,client => client.query("update public.players set name='Edited fixture',active=false where id=$1",[players[0]]))
    assert.equal((await as(member,client => client.query<{ player_name_snapshot: string }>(
      'select player_name_snapshot from public.match_players where player_id=$1',[players[0]]))).rows[0].player_name_snapshot,'Fixture 0')
    await save(owner); pass()
    stage = 'membership_share_lock_and_demotion'
    let release!: () => void, ready!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const locked = new Promise<void>(resolve => { ready = resolve })
    const saving = as(admin,async client => {
      await client.query('select public.save_match_draw($1,$2::jsonb)',[randomUUID(),JSON.stringify(payload)])
      ready(); await held
    })
    // Fail the wait if the save itself rejects; no unbounded lock wait.
    await Promise.race([locked, saving])
    try {
      await rejected(as(owner,async client => {
        await client.query("set local lock_timeout='300ms'")
        return client.query("update public.group_members set role='member' where group_id=$1 and user_id=$2",[groupId,adminId])
      }),'55P03')
    } finally { release(); await saving }
    await as(owner,client => client.query("update public.group_members set role='member' where group_id=$1 and user_id=$2",[groupId,adminId]))
    await rejected(save(admin,payload,randomUUID()),'42501'); pass()
    stage = 'fixed_api_dispatch_no_identity_or_role_injection'
    const dispatch = createDatabaseDispatch(runtime)
    const call = (actor: typeof owner, method: string, path: string, body?: unknown) => dispatch(actor,method,new URL(path,'http://localhost:8787'),body)
    await assert.rejects(call(owner,'POST','/me',{user_id:randomUUID()}),/invalid_fields/)
    await assert.rejects(call(owner,'POST','/groups',{name:'Valid fixture',sport:'futsal',defaultPlayersOnCourt:1,role:'owner'}),/invalid_fields/)
    await assert.rejects(call(outsider,'GET',`/groups/${groupId}/matches/${matchId}`),/unavailable/)
    assert.equal((await call(owner,'GET',`/groups/${groupId}/matches/${matchId}`) as { teams: unknown[] }).teams.length,2)
    pass()
  } catch (error) {
    record({ event: 'domain_preflight', test: stage, status: 'FAIL' }); throw error
  } finally {
    await cleanupFixtures().catch(error => {
      cleanupFailed = true; cleanupFailure = error
      record({ event: 'domain_fixture_cleanup', completed: false })
    })
  }
  if (cleanupFailed) throw cleanupFailure
}
