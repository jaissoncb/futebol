/** Local-only integration test. Run after local reset + pgTAP:
 * node supabase/tests/save-match-draw-concurrency.mjs
 * Requires Docker on PATH and the project's local Supabase DB container.
 * Uses psql inside that container; no DB passwords, URLs or remote SQL endpoints.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const container = 'supabase_db_futebol'
const localEndpoint = (host) => /^(unix:\/\/|npipe:\/\/)/.test(host)
if (process.env.DOCKER_HOST && !localEndpoint(process.env.DOCKER_HOST)) {
  throw new Error('This test requires a local Docker socket/pipe.')
}

function processCommand(args) {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stdout = ''
  let stderr = ''
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
  return { child, done, output: () => stdout }
}

async function command(args) {
  const proc = processCommand(args)
  proc.child.stdin.end()
  const result = await proc.done
  assert.equal(result.code, 0, result.stderr)
  return result.stdout.trim()
}

assert.ok(localEndpoint(await command(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])),
  'Docker context must target a local socket/pipe')
assert.equal(await command(['inspect', '--format', '{{.State.Running}}', container]), 'true', 'local DB must be running')

function session(sql, keepOpen = false) {
  const proc = processCommand(['exec', '-i', container, 'psql', '-X', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'])
  // Prevent an unbounded wait if a local database/psql session is broken.
  proc.child.stdin.write("\\set VERBOSITY verbose\nSET statement_timeout = '15s';\n" + sql + '\n')
  if (!keepOpen) proc.child.stdin.end()
  return proc
}

async function query(sql) {
  const result = await session(sql).done
  assert.equal(result.code, 0, result.stderr)
  return result.stdout
}

async function until(predicate, message) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

const group = randomUUID()
const actor = randomUUID()
const admin = randomUUID()
const otherActor = randomUUID()
const otherGroup = randomUUID()
const playerIds = Array.from({ length: 4 }, () => randomUUID())
const payload = {
  group_id: group, name: 'Concurrency fixture', match_date: '2026-09-12', match_time: null,
  team_count: 2, players_on_court: 1,
  participants: playerIds.map((id, index) => ({
    player_id: id, player_name_snapshot: `Fixture ${index}`, player_nickname_snapshot: null,
    skill_rating_snapshot: 3, is_goalkeeper_snapshot: false, preferred_position_snapshot: null,
  })),
  teams: [{ team_index: 1, name: 'Azul' }, { team_index: 2, name: 'Vermelho' }],
  assignments: playerIds.map((id, index) => ({
    player_id: id, team_index: index % 2 + 1, starts_as_reserve: index >= 2,
    assignment_source: index >= 2 ? 'manual' : 'draw',
  })),
  draw_runs: [
    { run_number: 1, seed: 'base-A', algorithm_version: 'balanced-candidates-v1', balance_score: 0, accepted: false },
    { run_number: 2, seed: 'base-B', algorithm_version: 'balanced-candidates-v1', balance_score: 0, accepted: true },
  ],
}
const quote = (value) => "'" + value.replaceAll("'", "''") + "'"
const call = (matchId, content) => `public.save_match_draw('${matchId}'::uuid, ${quote(JSON.stringify(content))}::jsonb)`
const identity = `SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', '{"sub":"${actor}","role":"authenticated"}', true);`
const identityFor = (id) => `SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated"}', true);`

async function membershipRace(operation, saveFirst, commitChange = true) {
  // Restore this invocation's admin before each independent ordering scenario.
  await query(`INSERT INTO public.group_members(group_id,user_id,role) VALUES ('${group}','${admin}','admin')
    ON CONFLICT(group_id,user_id) DO UPDATE SET role='admin';`)
  const match = randomUUID(), applicationName = `phase8b_${randomUUID()}`
  const change = operation === 'demotion'
    ? `UPDATE public.group_members SET role='member' WHERE group_id='${group}' AND user_id='${admin}';`
    : `DELETE FROM public.group_members WHERE group_id='${group}' AND user_id='${admin}';`
  const save = `SELECT ${call(match,payload)};`
  const first = session(`BEGIN ISOLATION LEVEL READ COMMITTED;
    ${identityFor(saveFirst ? admin : actor)}
    ${saveFirst ? save : change}
    SELECT 'FIRST_READY';`,true)
  let second
  try {
    await until(() => first.output().includes('FIRST_READY'),'membership race first transaction did not acquire its lock')
    second = session(`SET application_name='${applicationName}'; BEGIN ISOLATION LEVEL READ COMMITTED;
      ${identityFor(saveFirst ? actor : admin)} ${saveFirst ? change : save} COMMIT;`)
    await until(async () => (await query(`SELECT 'BLOCKED:' || count(*) FROM pg_catalog.pg_stat_activity
      WHERE application_name='${applicationName}' AND cardinality(pg_catalog.pg_blocking_pids(pid))>0;`)).includes('BLOCKED:1'),
      `${operation}: second transaction must wait for the membership lock`)
    first.child.stdin.end(!saveFirst && !commitChange ? 'ROLLBACK;\n' : 'COMMIT;\n')
    const [winner,waiter] = await Promise.all([first.done,second.done])
    assert.equal(winner.code,0,winner.stderr)
    const authorized = saveFirst || !commitChange
    if (authorized) {
      assert.equal(waiter.code,0,waiter.stderr)
    } else {
      assert.notEqual(waiter.code,0,'save after committed membership change must fail')
      assert.match(waiter.stderr,/42501/)
      assert.match(waiter.stderr,/group management required/)
      assert.ok(!waiter.stdout.includes(match),'unauthorized call returns no match UUID')
    }
    const count = await query(`SELECT 'SAVED:' || count(*) FROM public.matches WHERE id='${match}' AND created_by='${admin}' AND status='drawn';`)
    assert.ok(count.includes(`SAVED:${authorized ? 1 : 0}`),count)
    const membership = await query(`SELECT 'ADMIN:' || count(*) FROM public.group_members WHERE group_id='${group}' AND user_id='${admin}' AND role='admin';`)
    assert.ok(membership.includes(`ADMIN:${!saveFirst && !commitChange ? 1 : 0}`),membership)
    if (saveFirst) {
      const retry = await session(`BEGIN; ${identityFor(admin)} ${save} COMMIT;`).done
      assert.notEqual(retry.code,0,'removed/demoted actor cannot retry after authorization is revoked')
      assert.match(retry.stderr,/42501/)
    }
    console.log(`PASS: ${operation}, ${saveFirst ? 'save lock first; change waits; save commits' : commitChange ? 'change lock first; save waits then denied' : 'change lock first; rollback restores authorization'}`)
  } finally {
    if (!first.child.stdin.destroyed && !first.child.stdin.writableEnded) first.child.stdin.end('ROLLBACK;\n')
    await first.done.catch(() => {})
    if (second) await second.done.catch(() => {})
  }
}

async function collisions() {
  const match = randomUUID()
  await query(`BEGIN; ${identity} SELECT ${call(match,payload)}; COMMIT;`)
  const forbidden = ['Concurrency fixture','base-A','base-B',...playerIds]
  for (const [label,id,content] of [
    ['another actor in the same group',admin,payload],
    ['another group',otherActor,{...payload,group_id:otherGroup}],
  ]) {
    const response = await session(`BEGIN; ${identityFor(id)} SELECT ${call(match,content)}; COMMIT;`).done
    assert.notEqual(response.code,0,'colliding UUID must not be accepted')
    assert.match(response.stderr,/40001/)
    assert.match(response.stderr,/match id unavailable; retry in a fresh transaction/)
    assert.ok(!response.stdout.includes(match),'collision must not return existing UUID')
    for (const value of forbidden) assert.ok(!(response.stdout+response.stderr).includes(value),'collision disclosed existing content')
    console.log(`PASS: collision from ${label} rejected generically without graph disclosure`)
  }
  const retry = await query(`BEGIN; ${identity} SELECT ${call(match,payload)}; COMMIT;`)
  assert.ok(retry.includes(match),'collisions preserved original content and owner retry')
}

async function race(label, equivalent, commitWinner = true) {
  const match = randomUUID()
  const applicationName = `phase7_${randomUUID()}`
  const reordered = {
    ...payload,
    participants: [...payload.participants].reverse(), teams: [...payload.teams].reverse(),
    assignments: [...payload.assignments].reverse(), draw_runs: [...payload.draw_runs].reverse(),
  }
  const candidate = equivalent ? reordered : { ...payload, name: 'Different content' }
  const first = session(`BEGIN ISOLATION LEVEL READ COMMITTED;
    ${identity}
    SELECT ${call(match, payload)};
    SELECT 'FIRST_READY';`, true)
  let second
  try {
    await until(() => first.output().includes('FIRST_READY'), 'first session did not hold its transaction')
    second = session(`SET application_name = '${applicationName}';
      BEGIN ISOLATION LEVEL READ COMMITTED;
      ${identity}
      SELECT ${call(match, candidate)};
      COMMIT;`)
    await until(async () => (await query(`SELECT 'WAITING:' || count(*) FROM pg_catalog.pg_stat_activity
      WHERE application_name = '${applicationName}' AND wait_event_type = 'Lock' AND wait_event = 'advisory';`)).includes('WAITING:1'),
    'second session never waited on the UUID advisory lock')
    const hidden = await query(`SELECT 'HIDDEN:' || (
      (SELECT count(*) FROM public.matches WHERE id = '${match}') +
      (SELECT count(*) FROM public.match_players WHERE match_id = '${match}') +
      (SELECT count(*) FROM public.teams WHERE match_id = '${match}') +
      (SELECT count(*) FROM public.team_assignments WHERE match_id = '${match}') +
      (SELECT count(*) FROM public.draw_runs WHERE match_id = '${match}'));`)
    assert.ok(hidden.includes('HIDDEN:0'), 'uncommitted graph must be invisible')
    first.child.stdin.end(commitWinner ? 'COMMIT;\n' : 'ROLLBACK;\n')
    const [winner, waiter] = await Promise.all([first.done, second.done])
    assert.equal(winner.code, 0, winner.stderr)
    if (equivalent || !commitWinner) {
      assert.equal(waiter.code, 0, waiter.stderr)
      assert.ok(waiter.stdout.includes(match), 'waiter returns the same retry key')
    } else {
      assert.notEqual(waiter.code, 0, 'divergent request must fail')
      assert.match(waiter.stderr, /22023/, 'divergence has consistent SQLSTATE')
    }
    const counts = await query(`SELECT 'COUNTS:'::text || jsonb_build_array(
      (SELECT count(*) FROM public.matches WHERE id = '${match}' AND status = 'drawn'),
      (SELECT count(*) FROM public.match_players WHERE match_id = '${match}'),
      (SELECT count(*) FROM public.teams WHERE match_id = '${match}'),
      (SELECT count(*) FROM public.team_assignments WHERE match_id = '${match}'),
      (SELECT count(*) FROM public.draw_runs WHERE match_id = '${match}'),
      (SELECT count(*) FROM public.draw_runs WHERE match_id = '${match}' AND accepted))::text;
      SELECT 'NAME:' || name FROM public.matches WHERE id = '${match}';`)
    assert.ok(counts.includes('COUNTS:[1, 4, 2, 4, 2, 1]'), counts)
    assert.ok(counts.includes('NAME:Concurrency fixture'), 'divergent caller cannot overwrite the winner')
    console.log(`PASS: ${label}`)
  } finally {
    if (!first.child.stdin.destroyed && !first.child.stdin.writableEnded) first.child.stdin.end('ROLLBACK;\n')
    await first.done.catch(() => {})
    if (second) await second.done.catch(() => {})
  }
}

async function lostResponseCase() {
  const match = randomUUID()
  // First session COMMITs; deliberately ignore its returned UUID/response.
  await query(`BEGIN; ${identity} SELECT ${call(match, payload)}; COMMIT;`)
  const retry = await query(`BEGIN; ${identity} SELECT ${call(match, payload)}; COMMIT;`)
  assert.ok(retry.includes(match))
  const result = await query(`SELECT 'RETRY:'::text || jsonb_build_array(
    (SELECT count(*) FROM public.matches WHERE id = '${match}' AND status = 'drawn'),
    (SELECT count(*) FROM public.match_players WHERE match_id = '${match}'),
    (SELECT count(*) FROM public.teams WHERE match_id = '${match}'),
    (SELECT count(*) FROM public.team_assignments WHERE match_id = '${match}'),
    (SELECT count(*) FROM public.draw_runs WHERE match_id = '${match}'),
    (SELECT count(*) FROM public.draw_runs WHERE match_id = '${match}' AND accepted))::text;`)
  assert.ok(result.includes('RETRY:[1, 4, 2, 4, 2, 1]'), result)
  console.log('PASS: committed response lost, retry in a new session does not duplicate data')
}

let testError
try {
  // Fixtures are committed so separate DB sessions can see them.
  await query(`BEGIN;
    INSERT INTO auth.users (id, raw_user_meta_data) VALUES ('${actor}', '{}'),('${admin}','{}'),('${otherActor}','{}');
    INSERT INTO public.groups (id, name, created_by) VALUES ('${group}', 'Concurrency fixture', '${actor}'),('${otherGroup}','Other group','${otherActor}');
    INSERT INTO public.group_members (group_id, user_id, role) VALUES ('${group}', '${actor}', 'owner'),('${group}','${admin}','admin'),('${otherGroup}','${otherActor}','owner');
    INSERT INTO public.players (id, group_id, name, skill_rating) VALUES
      ${playerIds.map((id, index) => `('${id}', '${group}', 'Fixture ${index}', 3)`).join(',')};
    COMMIT;`)
  await lostResponseCase()
  await race('equivalent concurrent calls share one graph', true)
  await race('divergent concurrent call fails after waiting', false)
  await race('waiter recovers after the first transaction rolls back', true, false)
  await collisions()
  for (const operation of ['demotion','removal']) {
    await membershipRace(operation,true)
    await membershipRace(operation,false)
    await membershipRace(operation,false,false)
  }
} catch (error) {
  testError = error
} finally {
  // Remove only synthetic fixtures belonging to this invocation, even on failure.
  try {
    await query(`BEGIN;
      DELETE FROM public.matches WHERE group_id = '${group}' AND created_by IN ('${actor}','${admin}');
      DELETE FROM public.groups WHERE id IN ('${group}','${otherGroup}');
      DELETE FROM auth.users WHERE id IN ('${actor}','${admin}','${otherActor}');
      COMMIT;
      SELECT 'CLEAN:' || (
        (SELECT count(*) FROM auth.users WHERE id IN ('${actor}','${admin}','${otherActor}')) +
        (SELECT count(*) FROM public.groups WHERE id IN ('${group}','${otherGroup}')) +
        (SELECT count(*) FROM public.matches WHERE group_id IN ('${group}','${otherGroup}')));`).then((output) => assert.ok(output.includes('CLEAN:0'),'fixture cleanup incomplete'))
  } catch (cleanupError) {
    throw new AggregateError([testError, cleanupError].filter(Boolean), 'Local test/fixture cleanup failed')
  }
}
if (testError) throw testError
