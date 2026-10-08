/** LOCAL ONLY: exercise the seventh migration against the six-migration graph
 * boundary with valid and invalid preexisting fixtures. Everything, including
 * the temporary reconstruction of the previous boundary, is rolled back.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const local = (host) => /^(unix:\/\/|npipe:\/\/)/.test(host)
function docker(args,input) {
  const result=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:30_000})
  assert.equal(result.status,0,result.stderr || result.error?.message)
  return result.stdout.trim()
}
assert.ok(!process.env.DOCKER_HOST || local(process.env.DOCKER_HOST),'local Docker only')
assert.ok(local(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}'])),'local Docker only')
const root = new URL('../',import.meta.url)
const read = (path) => readFileSync(new URL(path,root),'utf8')
const oldRpc=read('migrations/20260912195435_save_match_draw.sql').replace('create function','create or replace function')
const oldSecurity=read('migrations/20260911113856_security_functions_and_grants.sql')
const oldGrants=oldSecurity.slice(oldSecurity.indexOf('grant select on public.matches'))
const policies=read('migrations/20260911113900_row_level_security.sql').match(/create policy[\s\S]*?;/g)
  .filter((sql)=>/on public\.(matches|match_players|teams|team_assignments|draw_runs) for (insert|update|delete)\b/.test(sql))
assert.equal(policies.length,14,'previous graph policy boundary must be understood exactly')
const migration=read('migrations/20260913081632_harden_save_match_draw.sql')
const audit=read('audits/drawn_match_integrity.sql').trim().replace(/;$/,'')
const actor=randomUUID(),group=randomUUID(),good=randomUUID(),bad=randomUUID()
const players=[randomUUID(),randomUUID()]
const payload={group_id:group,match_date:'2026-09-13',team_count:2,players_on_court:1,
  participants:players.map((id)=>({player_id:id,player_name_snapshot:'Upgrade player',skill_rating_snapshot:3,is_goalkeeper_snapshot:false})),
  teams:[{team_index:1,name:'One'},{team_index:2,name:'Two'}],
  assignments:players.map((id,index)=>({player_id:id,team_index:index+1,starts_as_reserve:false,assignment_source:'draw'})),
  draw_runs:[{run_number:1,seed:'upgrade',algorithm_version:'balanced-candidates-v1',balance_score:0,accepted:true}]}
const quote=(value)=>"'"+value.replaceAll("'","''")+"'"
const sql=`BEGIN;
-- Reconstruct ONLY the previous graph write boundary, transactionally.
${oldRpc}
${oldGrants}
${policies.join('\n')}
INSERT INTO auth.users(id,raw_user_meta_data) VALUES ('${actor}','{}');
INSERT INTO public.groups(id,name,created_by) VALUES ('${group}','Upgrade fixture','${actor}');
INSERT INTO public.group_members(group_id,user_id,role) VALUES ('${group}','${actor}','owner');
INSERT INTO public.players(id,group_id,name) VALUES ${players.map(id=>`('${id}','${group}','Upgrade player')`).join(',')};
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);
SELECT public.save_match_draw('${good}',${quote(JSON.stringify(payload))}::jsonb);
SELECT public.save_match_draw('${bad}',${quote(JSON.stringify(payload))}::jsonb);
UPDATE public.team_assignments SET starts_as_reserve=true WHERE match_id='${bad}';
UPDATE public.draw_runs SET accepted=false WHERE match_id='${bad}';
INSERT INTO public.matches(group_id,match_date,status,created_by) VALUES ('${group}','2026-09-13','drawn',auth.uid());
RESET ROLE;
SELECT 'BEFORE:' || count(*) FROM (${audit}) audit WHERE group_id='${group}';
${migration}
SELECT 'AFTER:' || count(*) FROM (${audit}) audit WHERE group_id='${group}';
SELECT 'ROWS:' || count(*) FROM public.matches WHERE group_id='${group}';
SELECT 'REASONS:' || violations::text FROM (${audit}) audit WHERE match_id='${bad}';
SET LOCAL ROLE authenticated;
SELECT public.save_match_draw('${good}',${quote(JSON.stringify(payload))}::jsonb);
ROLLBACK;
SELECT 'CLEAN:' || ((SELECT count(*) FROM auth.users WHERE id='${actor}')+
  (SELECT count(*) FROM public.groups WHERE id='${group}')+
  (SELECT count(*) FROM public.matches WHERE group_id='${group}'));
SELECT 'HARDENED:' || (prosecdef AND proconfig @> ARRAY['search_path=pg_catalog'])
  FROM pg_proc WHERE oid='public.save_match_draw(uuid,jsonb)'::regprocedure;`
const output=docker(['exec','-i','supabase_db_futebol','psql','-X','-A','-t','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],sql)
for(const marker of ['BEFORE:2','AFTER:2','ROWS:3','CLEAN:0','HARDENED:true']) assert.ok(output.includes(marker),marker)
assert.ok(output.includes('accepted_run') && output.includes('starters_reserves_goalkeepers'),'audit must detect the original corrupted graph')
console.log('PASS: upgrade from six-migration write boundary preserves valid graph/retry, detects two invalid preexisting graphs without repairing/deleting them, and rolls back fixtures/schema probe.')
