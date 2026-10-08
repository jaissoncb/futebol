/** Local-only contract test: real frontend payload -> approved Postgres RPC.
 * Run with Node >=22.18 after local migrations: node scripts/test-draw-contract.mjs
 * The entire fixture and every match are rolled back; no remote credentials.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { buildDrawPayload } from '../src/matches/draw-payload.ts'
import { drawTeams } from '../src/draw/engine.ts'
import { swapPlayers, swapCourtStatus } from '../src/draw/adjustments.ts'

const localEndpoint = (value) => /^(unix:\/\/|npipe:\/\/)/.test(value)
if (process.env.DOCKER_HOST) assert.ok(localEndpoint(process.env.DOCKER_HOST), 'local Docker only')
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return result.stdout.trim()
}
assert.ok(localEndpoint(docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])), 'local Docker only')
const group = randomUUID(), actor = randomUUID()
const players = Array.from({ length: 12 }, (_, i) => ({ id: randomUUID(), group_id: group, name: `Fixture ${i}`, nickname: null,
  skill_rating: 1 + (i % 9) * 0.5, is_goalkeeper: i < 2, preferred_position: null, active: true, created_at: '', updated_at: '' }))
const drawPlayers = players.map((p) => ({ id: p.id, skillRating: p.skill_rating, isGoalkeeper: p.is_goalkeeper }))
const runs = ['A', 'B', 'C'].map((seed) => drawTeams({ players: drawPlayers, seed, playersOnCourt: 5, teamCount: 2 }))
const base = runs.at(-1)
const initial = { playersOnCourt: 5, teams: base.teams.map((t) => ({ playerIds: [...t.playerIds], reserveIds: [...t.reserveIds] })) }
const byId = new Map(drawPlayers.map((p) => [p.id, p]))
const a = initial.teams[0].playerIds.find((id) => !byId.get(id).isGoalkeeper && !initial.teams[0].reserveIds.includes(id))
const b = initial.teams[1].playerIds.find((id) => !byId.get(id).isGoalkeeper && !initial.teams[1].reserveIds.includes(id))
const swapped = swapPlayers(initial, 0, a, 1, b, byId)
assert.ok(swapped.ok)
const team = swapped.state.teams[0]
const starter = team.playerIds.find((id) => !byId.get(id).isGoalkeeper && !team.reserveIds.includes(id))
const changed = swapCourtStatus(swapped.state, 0, starter, team.reserveIds[0], byId)
assert.ok(changed.ok)
const payload = buildDrawPayload(group, { name: 'Contrato frontend local', matchDate: '2026-09-12', matchTime: '20:00', teamCount: 2, playersOnCourt: 5 }, players, runs, changed.state)
const id = randomUUID()
const quote = (value) => "'" + value.replaceAll("'", "''") + "'"
const call = (value) => `public.save_match_draw('${id}', ${quote(JSON.stringify(value))}::jsonb)`
const sql = `BEGIN;
INSERT INTO auth.users(id, raw_user_meta_data) VALUES ('${actor}', '{}');
INSERT INTO public.groups(id, name, created_by) VALUES ('${group}', 'Contrato local', '${actor}');
INSERT INTO public.group_members(group_id,user_id,role) VALUES ('${group}','${actor}','owner');
INSERT INTO public.players(id,group_id,name,skill_rating,is_goalkeeper) VALUES ${players.map((p) => `('${p.id}','${group}',${quote(p.name)},${p.skill_rating},${p.is_goalkeeper})`).join(',')};
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);
SELECT ${call(payload)};
SELECT ${call({ ...payload, participants: [...payload.participants].reverse(), draw_runs: [...payload.draw_runs].reverse() })};
SELECT 'CONTRACT:' || jsonb_build_array(
 (SELECT count(*) FROM public.matches WHERE id='${id}' AND status='drawn'),
 (SELECT count(*) FROM public.match_players WHERE match_id='${id}'),
 (SELECT count(*) FROM public.teams WHERE match_id='${id}'),
 (SELECT count(*) FROM public.team_assignments WHERE match_id='${id}'),
 (SELECT count(*) FROM public.team_assignments WHERE match_id='${id}' AND assignment_source='manual'),
 (SELECT count(*) FROM public.team_assignments WHERE match_id='${id}' AND starts_as_reserve),
 (SELECT count(*) FROM public.draw_runs WHERE match_id='${id}'),
 (SELECT count(*) FROM public.draw_runs WHERE match_id='${id}' AND accepted))::text;
ROLLBACK;`
const output = docker(['exec', '-i', 'supabase_db_futebol', 'psql', '-X', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], sql)
const manualCount = payload.assignments.filter((a) => a.assignment_source === 'manual').length
assert.ok(output.includes(`CONTRACT:[1, 12, 2, 12, ${manualCount}, 2, 3, 1]`), 'complete graph, final manual slots and equivalent retry')
console.log('PASS: actual frontend payload, three rerolls, manual team/slot changes, snapshots, reserves and equivalent retry accepted by LOCAL RPC; fixtures rolled back')
