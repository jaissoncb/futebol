begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Effective privileges include PUBLIC and inherited roles, not just textual ACLs.
select ok(has_table_privilege('authenticated', 'public.' || t, 'SELECT'), t || ': SELECT preserved')
from unnest(array['matches','match_players','teams','team_assignments','draw_runs']) as tables(t);
select ok(not has_table_privilege(r, 'public.' || t, privilege), r || ': no ' || privilege || ' on ' || t)
from unnest(array['matches','match_players','teams','team_assignments','draw_runs']) as tables(t)
cross join unnest(array['authenticated','anon']) as roles(r)
cross join unnest(array['INSERT','UPDATE','DELETE']) as privileges(privilege);
select ok(not has_column_privilege(r, c.oid, a.attnum, privilege), r || ': no column ' || privilege || ' on ' || c.relname || '.' || a.attname)
from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
cross join unnest(array['authenticated','anon']) as roles(r)
cross join unnest(array['INSERT','UPDATE']) as privileges(privilege)
where c.relnamespace='public'::regnamespace
  and c.relname in ('matches','match_players','teams','team_assignments','draw_runs');
select ok(not exists (
  select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
  where c.relnamespace='public'::regnamespace and c.relname in ('matches','match_players','teams','team_assignments','draw_runs')
    and acl.grantee=0 and acl.privilege_type in ('INSERT','UPDATE','DELETE')
), 'PUBLIC has no graph DML');
select is((select count(*)::integer from pg_policies where schemaname='public'
  and tablename in ('matches','match_players','teams','team_assignments','draw_runs')), 5, 'only five SELECT policies remain');
select ok((select bool_and(cmd='SELECT' and roles=array['authenticated']::name[]
  and qual='private.is_group_member(group_id)') from pg_policies where schemaname='public'
  and tablename in ('matches','match_players','teams','team_assignments','draw_runs')), 'member SELECT policies unchanged');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.matches'::regclass,'public.match_players'::regclass,'public.teams'::regclass,
  'public.team_assignments'::regclass,'public.draw_runs'::regclass)), 'RLS remains enabled');

insert into auth.users(id,raw_user_meta_data) values
  ('80000000-0000-0000-0000-000000000001','{}'),
  ('80000000-0000-0000-0000-000000000002','{}'),
  ('80000000-0000-0000-0000-000000000003','{}'),
  ('80000000-0000-0000-0000-000000000004','{}');
insert into public.groups(id,name,created_by) values
  ('81000000-0000-0000-0000-000000000001','Boundary group','80000000-0000-0000-0000-000000000001');
insert into public.group_members(group_id,user_id,role) values
  ('81000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','owner'),
  ('81000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002','admin'),
  ('81000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000003','member');
insert into public.players(id,group_id,name) values
  ('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','Player one'),
  ('82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001','Player two');
select set_config('test.boundary_payload', jsonb_build_object(
  'group_id','81000000-0000-0000-0000-000000000001','match_date','2026-09-13','team_count',2,'players_on_court',1,
  'participants',(select jsonb_agg(jsonb_build_object('player_id',id,'player_name_snapshot',name,
    'skill_rating_snapshot',skill_rating,'is_goalkeeper_snapshot',false)) from public.players
    where group_id='81000000-0000-0000-0000-000000000001'),
  'teams','[{"team_index":1,"name":"One"},{"team_index":2,"name":"Two"}]'::jsonb,
  'assignments','[{"player_id":"82000000-0000-0000-0000-000000000001","team_index":1,"starts_as_reserve":false,"assignment_source":"draw"},
    {"player_id":"82000000-0000-0000-0000-000000000002","team_index":2,"starts_as_reserve":false,"assignment_source":"manual"}]'::jsonb,
  'draw_runs','[{"run_number":1,"seed":"boundary","algorithm_version":"balanced-candidates-v1","balance_score":0,"accepted":true}]'::jsonb
)::text,true);

-- Caller-created names must not shadow any relation/type/function used by the RPC.
create temp table group_members as select * from public.group_members with no data;
create temp table matches as select * from public.matches with no data;
create temp table match_players as select * from public.match_players with no data;
create temp table teams as select * from public.teams with no data;
create temp table team_assignments as select * from public.team_assignments with no data;
create temp table draw_runs as select * from public.draw_runs with no data;
create domain pg_temp.uuid as text;
create function pg_temp.jsonb_typeof(jsonb) returns text language plpgsql as $$
begin raise exception 'shadowed function must never run'; end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
-- Supabase's trusted auth.uid() has an internal unqualified uuid cast. A caller
-- shadowing that type must fail closed, not change the actor or write a graph.
select throws_ok($$select public.save_match_draw('83000000-0000-0000-0000-000000000001',current_setting('test.boundary_payload')::jsonb)$$,
  '42P13', null, 'temporary uuid shadow fails closed in auth.uid; no privileged write');
reset role;
select is((select count(*)::integer from public.matches where id='83000000-0000-0000-0000-000000000001'),0,
  'type shadow failure left no graph');
drop domain pg_temp.uuid;
set local role authenticated;
select is(public.save_match_draw('83000000-0000-0000-0000-000000000001',current_setting('test.boundary_payload')::jsonb),
  '83000000-0000-0000-0000-000000000001'::pg_catalog.uuid, 'owner saves despite temporary shadow objects');

-- Run realistic previously granted DML against a saved graph for every app role.
reset role;
create function pg_temp.boundary_actor(actor text) returns setof text language plpgsql as $$
declare statement text; table_name text;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  for statement in select value from unnest(array[
    'insert into public.matches(group_id,match_date,status,created_by) values (''81000000-0000-0000-0000-000000000001'',current_date,''drawn'',auth.uid())',
    'insert into public.match_players(group_id,match_id,player_id,player_name_snapshot,skill_rating_snapshot,is_goalkeeper_snapshot) select group_id,match_id,player_id,player_name_snapshot,skill_rating_snapshot,is_goalkeeper_snapshot from public.match_players',
    'insert into public.teams(group_id,match_id,team_index,name) select group_id,match_id,team_index,name from public.teams',
    'insert into public.team_assignments(group_id,match_id,team_id,player_id,starts_as_reserve,assignment_source) select group_id,match_id,team_id,player_id,true,assignment_source from public.team_assignments',
    'insert into public.draw_runs(group_id,match_id,run_number,seed,algorithm_version,accepted) select group_id,match_id,run_number+1,seed,algorithm_version,false from public.draw_runs',
    'update public.matches set status=''draft''',
    'update public.match_players set attendance_status=''absent''',
    'update public.teams set team_index=team_index+10',
    'update public.team_assignments set starts_as_reserve=true',
    'update public.draw_runs set accepted=false',
    'delete from public.matches','delete from public.match_players','delete from public.teams',
    'delete from public.team_assignments','delete from public.draw_runs'
  ]) value loop
    return next throws_ok(statement,'42501',null,actor || ': direct DML rejected: ' || statement);
  end loop;
  for table_name in select unnest(array['matches','match_players','teams','team_assignments','draw_runs']) loop
    -- Query every graph resource under the actor's RLS, using generated SQL only in this local test.
    return next results_eq(format('select count(*)::integer from public.%I where group_id=''81000000-0000-0000-0000-000000000001''',table_name),
      format('values (%s::integer)', case when actor='80000000-0000-0000-0000-000000000004' then 0
        when table_name in ('match_players','teams','team_assignments') then 2 else 1 end),actor || ': scoped read ' || table_name);
  end loop;
end $$;
set local role authenticated;
select result.* from unnest(array[
  '80000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002',
  '80000000-0000-0000-0000-000000000003','80000000-0000-0000-0000-000000000004']) actors(actor)
cross join lateral pg_temp.boundary_actor(actor) result;
reset role;
set local role anon;
select throws_ok(format('select * from public.%I',t),'42501',null,'anon cannot read ' || t)
from unnest(array['matches','match_players','teams','team_assignments','draw_runs']) tables(t);
reset role;
select * from finish();
rollback;
