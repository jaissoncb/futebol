-- Phase 8B: controlled graph writes; SELECT policies and RLS remain unchanged.
create or replace function public.save_match_draw(target_match_id pg_catalog.uuid, payload pg_catalog.jsonb)
returns pg_catalog.uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id pg_catalog.uuid := auth.uid();
  actor_group_role public.group_role;
  normalized pg_catalog.jsonb;
  saved pg_catalog.jsonb;
  entry pg_catalog.jsonb;
  section pg_catalog.text;
  allowed_keys pg_catalog.text[];
  required_keys pg_catalog.text[];
  target_group_id pg_catalog.uuid;
  requested_team_count pg_catalog.int2;
  court_count pg_catalog.int2;
  participant_count pg_catalog.int4;
  run_count pg_catalog.int4;
  existing_match public.matches%rowtype;
  inserted_id pg_catalog.uuid;
  lineup_invalid pg_catalog.bool;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if target_match_id is null or pg_catalog.jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'match id and object payload required' using errcode = '22023';
  end if;
  if not (payload ?& array['group_id', 'match_date', 'team_count', 'players_on_court',
                          'participants', 'teams', 'assignments', 'draw_runs'])
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(payload) as keys(key)
      where key <> all (array['group_id', 'name', 'match_date', 'match_time', 'team_count',
        'players_on_court', 'participants', 'teams', 'assignments', 'draw_runs'])
    ) then
    raise exception 'invalid match payload fields' using errcode = '22023';
  end if;

  target_group_id := (payload ->> 'group_id')::pg_catalog.uuid;
  -- FOR SHARE conflicts with role UPDATE and membership DELETE, unlike KEY SHARE.
  -- A concurrent change committed first is rechecked by the locking SELECT.
  -- Once authorized, the membership cannot change until this transaction ends.
  select members.role into actor_group_role
  from public.group_members as members
  where members.group_id = target_group_id and members.user_id = actor_id
  for share;
  if target_group_id is null or actor_group_role is null
    or actor_group_role not in ('owner', 'admin') then
    raise exception 'group management required' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(payload -> 'team_count') is distinct from 'number'
    or pg_catalog.jsonb_typeof(payload -> 'players_on_court') is distinct from 'number'
    or pg_catalog.jsonb_typeof(payload -> 'match_date') is distinct from 'string'
    or (payload ? 'name' and pg_catalog.jsonb_typeof(payload -> 'name') not in ('string', 'null'))
    or (payload ? 'match_time' and pg_catalog.jsonb_typeof(payload -> 'match_time') not in ('string', 'null')) then
    raise exception 'invalid match configuration types' using errcode = '22023';
  end if;
  requested_team_count := (payload ->> 'team_count')::pg_catalog.int2;
  court_count := (payload ->> 'players_on_court')::pg_catalog.int2;

  -- Reject foreign identities and unknown fields, including on child records.
  foreach section in array array['participants', 'teams', 'assignments', 'draw_runs'] loop
    if pg_catalog.jsonb_typeof(payload -> section) is distinct from 'array'
      or pg_catalog.jsonb_array_length(payload -> section) = 0 then
      raise exception 'nonempty arrays required' using errcode = '22023';
    end if;
    case section
      when 'participants' then
        required_keys := array['player_id', 'player_name_snapshot', 'skill_rating_snapshot', 'is_goalkeeper_snapshot'];
        allowed_keys := required_keys || array['player_nickname_snapshot', 'preferred_position_snapshot'];
      when 'teams' then
        required_keys := array['team_index', 'name'];
        allowed_keys := required_keys || array['color'];
      when 'assignments' then
        required_keys := array['player_id', 'team_index', 'starts_as_reserve', 'assignment_source'];
        allowed_keys := required_keys;
      when 'draw_runs' then
        required_keys := array['run_number', 'seed', 'algorithm_version', 'balance_score', 'accepted'];
        allowed_keys := required_keys;
    end case;
    for entry in select value from pg_catalog.jsonb_array_elements(payload -> section) loop
      if pg_catalog.jsonb_typeof(entry) is distinct from 'object' then
        raise exception 'child object required' using errcode = '22023';
      end if;
      if not (entry ?& required_keys)
        or exists (select 1 from pg_catalog.jsonb_object_keys(entry) as keys(key) where key <> all (allowed_keys))
        or exists (select 1 from pg_catalog.unnest(required_keys) as keys(key) where entry -> key = 'null'::pg_catalog.jsonb) then
        raise exception 'invalid child payload fields' using errcode = '22023';
      end if;
      if section = 'participants' and (
        pg_catalog.jsonb_typeof(entry -> 'player_id') <> 'string'
        or pg_catalog.jsonb_typeof(entry -> 'player_name_snapshot') <> 'string'
        or pg_catalog.jsonb_typeof(entry -> 'skill_rating_snapshot') <> 'number'
        or pg_catalog.jsonb_typeof(entry -> 'is_goalkeeper_snapshot') <> 'boolean'
        or (entry ? 'player_nickname_snapshot' and pg_catalog.jsonb_typeof(entry -> 'player_nickname_snapshot') not in ('string', 'null'))
        or (entry ? 'preferred_position_snapshot' and pg_catalog.jsonb_typeof(entry -> 'preferred_position_snapshot') not in ('string', 'null'))
      ) then
        raise exception 'invalid participant types' using errcode = '22023';
      elsif section = 'teams' and (
        pg_catalog.jsonb_typeof(entry -> 'team_index') <> 'number' or pg_catalog.jsonb_typeof(entry -> 'name') <> 'string'
        or (entry ? 'color' and pg_catalog.jsonb_typeof(entry -> 'color') not in ('string', 'null'))
      ) then
        raise exception 'invalid team types' using errcode = '22023';
      elsif section = 'assignments' and (
        pg_catalog.jsonb_typeof(entry -> 'player_id') <> 'string' or pg_catalog.jsonb_typeof(entry -> 'team_index') <> 'number'
        or pg_catalog.jsonb_typeof(entry -> 'starts_as_reserve') <> 'boolean'
        or pg_catalog.jsonb_typeof(entry -> 'assignment_source') <> 'string'
      ) then
        raise exception 'invalid assignment types' using errcode = '22023';
      elsif section = 'draw_runs' and (
        pg_catalog.jsonb_typeof(entry -> 'run_number') <> 'number' or pg_catalog.jsonb_typeof(entry -> 'seed') <> 'string'
        or pg_catalog.jsonb_typeof(entry -> 'algorithm_version') <> 'string'
        or pg_catalog.jsonb_typeof(entry -> 'balance_score') <> 'number' or pg_catalog.jsonb_typeof(entry -> 'accepted') <> 'boolean'
      ) then
        raise exception 'invalid draw run types' using errcode = '22023';
      end if;
    end loop;
  end loop;

  -- Validate before typmod coercion: numeric(2,1) would round a rating such as
  -- 3.04 to 3.0, corrupting the draw input and making an identical retry differ.
  if exists (
    select 1 from pg_catalog.jsonb_to_recordset(payload -> 'participants') as p(skill_rating_snapshot pg_catalog.numeric)
    where skill_rating_snapshot not between 1 and 5
      or skill_rating_snapshot * 2 <> pg_catalog.trunc(skill_rating_snapshot * 2)
  ) then
    raise exception 'snapshot skill must be 1 to 5 in half steps' using errcode = '23514';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_to_recordset(payload -> 'draw_runs') as r(balance_score pg_catalog.numeric) where balance_score < 0
  ) then
    raise exception 'draw balance score must be nonnegative' using errcode = '23514';
  end if;

  -- Typed, ordered projections define logical equivalence, not JSON array order.
  -- Null/omitted optional fields are equivalent. Scores use the schema's 3 decimals.
  with participants as (
    select player_id, pg_catalog.btrim(player_name_snapshot) as player_name_snapshot,
      nullif(pg_catalog.btrim(player_nickname_snapshot), '') as player_nickname_snapshot,
      skill_rating_snapshot, is_goalkeeper_snapshot, preferred_position_snapshot,
      'present'::public.attendance_status as attendance_status
    from pg_catalog.jsonb_to_recordset(payload -> 'participants') as p(
      player_id pg_catalog.uuid, player_name_snapshot pg_catalog.text, player_nickname_snapshot pg_catalog.text,
      skill_rating_snapshot pg_catalog.numeric, is_goalkeeper_snapshot pg_catalog.bool,
      preferred_position_snapshot public.preferred_position)
  ), requested_teams as (
    select team_index, pg_catalog.btrim(name) as name, nullif(pg_catalog.btrim(color), '') as color
    from pg_catalog.jsonb_to_recordset(payload -> 'teams') as t(team_index pg_catalog.int2, name pg_catalog.text, color pg_catalog.text)
  ), assignments as (
    select * from pg_catalog.jsonb_to_recordset(payload -> 'assignments') as a(
      player_id pg_catalog.uuid, team_index pg_catalog.int2, starts_as_reserve pg_catalog.bool,
      assignment_source public.assignment_source)
  ), runs as (
    select * from pg_catalog.jsonb_to_recordset(payload -> 'draw_runs') as r(
      run_number pg_catalog.int4, seed pg_catalog.text, algorithm_version pg_catalog.text, balance_score pg_catalog.numeric(8, 3), accepted pg_catalog.bool)
  )
  select pg_catalog.jsonb_build_object(
    'group_id', target_group_id,
    'name', nullif(pg_catalog.btrim(payload ->> 'name'), ''),
    'match_date', (payload ->> 'match_date')::pg_catalog.date,
    'match_time', nullif(payload ->> 'match_time', '')::pg_catalog.time,
    'team_count', requested_team_count, 'players_on_court', court_count,
    'participants', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.player_id) from participants as p),
    'teams', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.team_index) from requested_teams as t),
    'assignments', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.player_id) from assignments as a),
    'draw_runs', (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.run_number) from runs as r)
  ) into normalized;

  participant_count := pg_catalog.jsonb_array_length(normalized -> 'participants');
  run_count := pg_catalog.jsonb_array_length(normalized -> 'draw_runs');
  if participant_count < requested_team_count
    or (select pg_catalog.count(distinct player_id) from pg_catalog.jsonb_to_recordset(normalized -> 'participants') as p(player_id pg_catalog.uuid)) <> participant_count then
    raise exception 'unique participants required, at least one per team' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(normalized -> 'teams') <> requested_team_count
    or (select pg_catalog.count(distinct team_index) from pg_catalog.jsonb_to_recordset(normalized -> 'teams') as t(team_index pg_catalog.int2)
        where team_index between 1 and requested_team_count) <> requested_team_count then
    raise exception 'teams must be indexed from one to team_count' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(normalized -> 'assignments') <> participant_count
    or (select pg_catalog.count(distinct player_id) from pg_catalog.jsonb_to_recordset(normalized -> 'assignments') as a(player_id pg_catalog.uuid)) <> participant_count
    or exists (
      select 1 from pg_catalog.jsonb_to_recordset(normalized -> 'assignments') as a(player_id pg_catalog.uuid, team_index pg_catalog.int2)
      where a.team_index not between 1 and requested_team_count
        or not exists (select 1 from pg_catalog.jsonb_to_recordset(normalized -> 'participants') as p(player_id pg_catalog.uuid) where p.player_id = a.player_id)
    ) then
    raise exception 'assign exactly every participant to one valid team' using errcode = '22023';
  end if;
  if (select pg_catalog.count(distinct run_number) from pg_catalog.jsonb_to_recordset(normalized -> 'draw_runs') as r(run_number pg_catalog.int4)
      where run_number between 1 and run_count) <> run_count
    or (select pg_catalog.count(*) from pg_catalog.jsonb_to_recordset(normalized -> 'draw_runs') as r(accepted pg_catalog.bool) where accepted) <> 1
    or not exists (
      select 1 from pg_catalog.jsonb_to_recordset(normalized -> 'draw_runs') as r(run_number pg_catalog.int4, accepted pg_catalog.bool)
      where run_number = run_count and accepted
    ) then
    raise exception 'contiguous draw runs with only the final run accepted required' using errcode = '22023';
  end if;

  -- Cross-row lineup rules absent from the initial table constraints.
  with lineup as (
    select a.*, p.is_goalkeeper_snapshot
    from pg_catalog.jsonb_to_recordset(normalized -> 'assignments') as a(player_id pg_catalog.uuid, team_index pg_catalog.int2, starts_as_reserve pg_catalog.bool)
    join pg_catalog.jsonb_to_recordset(normalized -> 'participants') as p(player_id pg_catalog.uuid, is_goalkeeper_snapshot pg_catalog.bool) using (player_id)
  ), sizes as (
    select team_index, pg_catalog.count(*) as size,
      pg_catalog.count(*) filter (where not starts_as_reserve) as starters,
      pg_catalog.count(*) filter (where is_goalkeeper_snapshot) as keepers,
      pg_catalog.count(*) filter (where is_goalkeeper_snapshot and not starts_as_reserve) as court_keepers
    from lineup group by team_index
  )
  select exists (
    select 1 from sizes where starters <> least(court_count, size) or (keepers > 0 and court_keepers = 0)
  ) or (select pg_catalog.count(*) from sizes) <> requested_team_count
    or (select pg_catalog.max(size) - pg_catalog.min(size) from sizes) > 1
    or (select pg_catalog.count(*) from sizes where court_keepers > 0) < least(
      requested_team_count, (select pg_catalog.count(*) from lineup where is_goalkeeper_snapshot)
    ) into lineup_invalid;
  if lineup_invalid then
    raise exception 'invalid team sizes, reserves or goalkeeper coverage' using errcode = '22023';
  end if;

  -- Serializes RPC calls for the UUID until commit/rollback, including lost responses.
  -- A hash collision only serializes unrelated UUIDs; it cannot conflate their data.
  -- At the Data API's READ COMMITTED isolation the next statement sees the winner.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_match_id::pg_catalog.text, 0));
  select * into existing_match from public.matches where id = target_match_id;
  if found then
    -- Never reconstruct another actor/group's graph. Use the same generic
    -- unavailable error as an INSERT conflict; return no existing row content.
    if existing_match.group_id <> target_group_id
      or existing_match.created_by is distinct from actor_id then
      raise exception 'match id unavailable; retry in a fresh transaction' using errcode = '40001';
    end if;
    if existing_match.status <> 'drawn' then
      raise exception 'match id conflicts with existing content' using errcode = '22023';
    end if;
    -- Reconstruct in one statement/snapshot; exclude generated IDs and timestamps.
    select pg_catalog.jsonb_build_object(
      'group_id', m.group_id, 'name', m.name, 'match_date', m.match_date,
      'match_time', m.match_time, 'team_count', m.team_count, 'players_on_court', m.players_on_court,
      'participants', (
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.player_id) from (
          select player_id, player_name_snapshot, player_nickname_snapshot, skill_rating_snapshot,
            is_goalkeeper_snapshot, preferred_position_snapshot, attendance_status
          from public.match_players where match_id = target_match_id
        ) as p
      ),
      'teams', (
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.team_index) from (
          select team_index, name, color from public.teams where match_id = target_match_id
        ) as t
      ),
      'assignments', (
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.player_id) from (
          select a.player_id, t.team_index, a.starts_as_reserve, a.assignment_source
          from public.team_assignments as a join public.teams as t on t.id = a.team_id
          where a.match_id = target_match_id
        ) as a
      ),
      'draw_runs', (
        select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.run_number) from (
          select run_number, seed, algorithm_version, balance_score, accepted
          from public.draw_runs where match_id = target_match_id
        ) as r
      )
    ) into saved from public.matches as m where m.id = target_match_id;
    if saved is distinct from normalized then
      raise exception 'match id conflicts with existing content' using errcode = '22023';
    end if;
    return target_match_id;
  end if;

  insert into public.matches (id, group_id, name, match_date, match_time, team_count,
                             players_on_court, status, created_by)
  values (target_match_id, target_group_id, normalized ->> 'name',
    (normalized ->> 'match_date')::pg_catalog.date, (normalized ->> 'match_time')::pg_catalog.time,
    requested_team_count, court_count, 'draft', actor_id)
  on conflict (id) do nothing
  returning id into inserted_id;
  if inserted_id is null then
    -- A hidden row, a direct writer not taking our lock, or an older transaction
    -- snapshot must never cause an overwrite. A fresh transaction may retry safely.
    raise exception 'match id unavailable; retry in a fresh transaction' using errcode = '40001';
  end if;

  insert into public.match_players (group_id, match_id, player_id, attendance_status,
    player_name_snapshot, player_nickname_snapshot, skill_rating_snapshot,
    is_goalkeeper_snapshot, preferred_position_snapshot)
  select target_group_id, target_match_id, p.player_id, p.attendance_status,
    p.player_name_snapshot, p.player_nickname_snapshot, p.skill_rating_snapshot,
    p.is_goalkeeper_snapshot, p.preferred_position_snapshot
  from pg_catalog.jsonb_to_recordset(normalized -> 'participants') as p(
    player_id pg_catalog.uuid, attendance_status public.attendance_status,
    player_name_snapshot pg_catalog.text, player_nickname_snapshot pg_catalog.text, skill_rating_snapshot pg_catalog.numeric,
    is_goalkeeper_snapshot pg_catalog.bool, preferred_position_snapshot public.preferred_position);

  insert into public.teams (group_id, match_id, team_index, name, color)
  select target_group_id, target_match_id, t.team_index, t.name, t.color
  from pg_catalog.jsonb_to_recordset(normalized -> 'teams') as t(team_index pg_catalog.int2, name pg_catalog.text, color pg_catalog.text);

  insert into public.team_assignments (group_id, match_id, team_id, player_id,
                                      starts_as_reserve, assignment_source)
  select target_group_id, target_match_id, t.id, a.player_id, a.starts_as_reserve, a.assignment_source
  from pg_catalog.jsonb_to_recordset(normalized -> 'assignments') as a(
    player_id pg_catalog.uuid, team_index pg_catalog.int2, starts_as_reserve pg_catalog.bool, assignment_source public.assignment_source)
  join public.teams as t on t.match_id = target_match_id and t.team_index = a.team_index;

  insert into public.draw_runs (group_id, match_id, run_number, seed, algorithm_version, balance_score, accepted)
  select target_group_id, target_match_id, r.run_number, r.seed, r.algorithm_version, r.balance_score, r.accepted
  from pg_catalog.jsonb_to_recordset(normalized -> 'draw_runs') as r(
    run_number pg_catalog.int4, seed pg_catalog.text, algorithm_version pg_catalog.text, balance_score pg_catalog.numeric(8, 3), accepted pg_catalog.bool);

  update public.matches set status = 'drawn' where id = target_match_id returning id into inserted_id;
  if inserted_id is null then
    raise exception 'match completion blocked' using errcode = '42501';
  end if;
  return target_match_id;
end;
$$;

alter function public.save_match_draw(pg_catalog.uuid, pg_catalog.jsonb) owner to postgres;

revoke all on function public.save_match_draw(pg_catalog.uuid, pg_catalog.jsonb) from public, anon, authenticated;
revoke execute on function public.save_match_draw(pg_catalog.uuid, pg_catalog.jsonb) from service_role;
grant execute on function public.save_match_draw(pg_catalog.uuid, pg_catalog.jsonb) to authenticated;

-- Client graph access is SELECT only. PostgreSQL also revokes matching column grants.
revoke insert, update, delete on table
  public.matches,
  public.match_players,
  public.teams,
  public.team_assignments,
  public.draw_runs
from authenticated;

drop policy matches_insert_managers on public.matches;
drop policy matches_update_managers on public.matches;
drop policy matches_delete_owner on public.matches;
drop policy match_players_insert_managers on public.match_players;
drop policy match_players_update_managers on public.match_players;
drop policy match_players_delete_managers on public.match_players;
drop policy teams_insert_managers on public.teams;
drop policy teams_update_managers on public.teams;
drop policy teams_delete_managers on public.teams;
drop policy team_assignments_insert_managers on public.team_assignments;
drop policy team_assignments_update_managers on public.team_assignments;
drop policy team_assignments_delete_managers on public.team_assignments;
drop policy draw_runs_insert_managers on public.draw_runs;
drop policy draw_runs_update_managers on public.draw_runs;
