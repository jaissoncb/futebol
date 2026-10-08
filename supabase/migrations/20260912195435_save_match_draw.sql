-- Client-generated UUID is the retry key; ownership remains subject to RLS.
grant insert (id) on public.matches to authenticated;

create function public.save_match_draw(target_match_id uuid, payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  actor_id uuid := auth.uid();
  normalized jsonb;
  saved jsonb;
  entry jsonb;
  section text;
  allowed_keys text[];
  required_keys text[];
  target_group_id uuid;
  requested_team_count smallint;
  court_count smallint;
  participant_count integer;
  run_count integer;
  existing_match public.matches%rowtype;
  inserted_id uuid;
  lineup_invalid boolean;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if target_match_id is null or jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'match id and object payload required' using errcode = '22023';
  end if;
  if not (payload ?& array['group_id', 'match_date', 'team_count', 'players_on_court',
                          'participants', 'teams', 'assignments', 'draw_runs'])
    or exists (
      select 1 from jsonb_object_keys(payload) as keys(key)
      where key <> all (array['group_id', 'name', 'match_date', 'match_time', 'team_count',
        'players_on_court', 'participants', 'teams', 'assignments', 'draw_runs'])
    ) then
    raise exception 'invalid match payload fields' using errcode = '22023';
  end if;

  target_group_id := (payload ->> 'group_id')::uuid;
  if target_group_id is null or not private.can_manage_group(target_group_id) then
    raise exception 'group management required' using errcode = '42501';
  end if;
  if jsonb_typeof(payload -> 'team_count') is distinct from 'number'
    or jsonb_typeof(payload -> 'players_on_court') is distinct from 'number'
    or jsonb_typeof(payload -> 'match_date') is distinct from 'string'
    or (payload ? 'name' and jsonb_typeof(payload -> 'name') not in ('string', 'null'))
    or (payload ? 'match_time' and jsonb_typeof(payload -> 'match_time') not in ('string', 'null')) then
    raise exception 'invalid match configuration types' using errcode = '22023';
  end if;
  requested_team_count := (payload ->> 'team_count')::smallint;
  court_count := (payload ->> 'players_on_court')::smallint;

  -- Reject foreign identities and unknown fields, including on child records.
  foreach section in array array['participants', 'teams', 'assignments', 'draw_runs'] loop
    if jsonb_typeof(payload -> section) is distinct from 'array'
      or jsonb_array_length(payload -> section) = 0 then
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
    for entry in select value from jsonb_array_elements(payload -> section) loop
      if jsonb_typeof(entry) is distinct from 'object' then
        raise exception 'child object required' using errcode = '22023';
      end if;
      if not (entry ?& required_keys)
        or exists (select 1 from jsonb_object_keys(entry) as keys(key) where key <> all (allowed_keys))
        or exists (select 1 from unnest(required_keys) as keys(key) where entry -> key = 'null'::jsonb) then
        raise exception 'invalid child payload fields' using errcode = '22023';
      end if;
      if section = 'participants' and (
        jsonb_typeof(entry -> 'player_id') <> 'string'
        or jsonb_typeof(entry -> 'player_name_snapshot') <> 'string'
        or jsonb_typeof(entry -> 'skill_rating_snapshot') <> 'number'
        or jsonb_typeof(entry -> 'is_goalkeeper_snapshot') <> 'boolean'
        or (entry ? 'player_nickname_snapshot' and jsonb_typeof(entry -> 'player_nickname_snapshot') not in ('string', 'null'))
        or (entry ? 'preferred_position_snapshot' and jsonb_typeof(entry -> 'preferred_position_snapshot') not in ('string', 'null'))
      ) then
        raise exception 'invalid participant types' using errcode = '22023';
      elsif section = 'teams' and (
        jsonb_typeof(entry -> 'team_index') <> 'number' or jsonb_typeof(entry -> 'name') <> 'string'
        or (entry ? 'color' and jsonb_typeof(entry -> 'color') not in ('string', 'null'))
      ) then
        raise exception 'invalid team types' using errcode = '22023';
      elsif section = 'assignments' and (
        jsonb_typeof(entry -> 'player_id') <> 'string' or jsonb_typeof(entry -> 'team_index') <> 'number'
        or jsonb_typeof(entry -> 'starts_as_reserve') <> 'boolean'
        or jsonb_typeof(entry -> 'assignment_source') <> 'string'
      ) then
        raise exception 'invalid assignment types' using errcode = '22023';
      elsif section = 'draw_runs' and (
        jsonb_typeof(entry -> 'run_number') <> 'number' or jsonb_typeof(entry -> 'seed') <> 'string'
        or jsonb_typeof(entry -> 'algorithm_version') <> 'string'
        or jsonb_typeof(entry -> 'balance_score') <> 'number' or jsonb_typeof(entry -> 'accepted') <> 'boolean'
      ) then
        raise exception 'invalid draw run types' using errcode = '22023';
      end if;
    end loop;
  end loop;

  -- Validate before typmod coercion: numeric(2,1) would round a rating such as
  -- 3.04 to 3.0, corrupting the draw input and making an identical retry differ.
  if exists (
    select 1 from jsonb_to_recordset(payload -> 'participants') as p(skill_rating_snapshot numeric)
    where skill_rating_snapshot not between 1 and 5
      or skill_rating_snapshot * 2 <> trunc(skill_rating_snapshot * 2)
  ) then
    raise exception 'snapshot skill must be 1 to 5 in half steps' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(payload -> 'draw_runs') as r(balance_score numeric) where balance_score < 0
  ) then
    raise exception 'draw balance score must be nonnegative' using errcode = '23514';
  end if;

  -- Typed, ordered projections define logical equivalence, not JSON array order.
  -- Null/omitted optional fields are equivalent. Scores use the schema's 3 decimals.
  with participants as (
    select player_id, btrim(player_name_snapshot) as player_name_snapshot,
      nullif(btrim(player_nickname_snapshot), '') as player_nickname_snapshot,
      skill_rating_snapshot, is_goalkeeper_snapshot, preferred_position_snapshot,
      'present'::public.attendance_status as attendance_status
    from jsonb_to_recordset(payload -> 'participants') as p(
      player_id uuid, player_name_snapshot text, player_nickname_snapshot text,
      skill_rating_snapshot numeric, is_goalkeeper_snapshot boolean,
      preferred_position_snapshot public.preferred_position)
  ), requested_teams as (
    select team_index, btrim(name) as name, nullif(btrim(color), '') as color
    from jsonb_to_recordset(payload -> 'teams') as t(team_index smallint, name text, color text)
  ), assignments as (
    select * from jsonb_to_recordset(payload -> 'assignments') as a(
      player_id uuid, team_index smallint, starts_as_reserve boolean,
      assignment_source public.assignment_source)
  ), runs as (
    select * from jsonb_to_recordset(payload -> 'draw_runs') as r(
      run_number integer, seed text, algorithm_version text, balance_score numeric(8, 3), accepted boolean)
  )
  select jsonb_build_object(
    'group_id', target_group_id,
    'name', nullif(btrim(payload ->> 'name'), ''),
    'match_date', (payload ->> 'match_date')::date,
    'match_time', nullif(payload ->> 'match_time', '')::time,
    'team_count', requested_team_count, 'players_on_court', court_count,
    'participants', (select jsonb_agg(to_jsonb(p) order by p.player_id) from participants as p),
    'teams', (select jsonb_agg(to_jsonb(t) order by t.team_index) from requested_teams as t),
    'assignments', (select jsonb_agg(to_jsonb(a) order by a.player_id) from assignments as a),
    'draw_runs', (select jsonb_agg(to_jsonb(r) order by r.run_number) from runs as r)
  ) into normalized;

  participant_count := jsonb_array_length(normalized -> 'participants');
  run_count := jsonb_array_length(normalized -> 'draw_runs');
  if participant_count < requested_team_count
    or (select count(distinct player_id) from jsonb_to_recordset(normalized -> 'participants') as p(player_id uuid)) <> participant_count then
    raise exception 'unique participants required, at least one per team' using errcode = '22023';
  end if;
  if jsonb_array_length(normalized -> 'teams') <> requested_team_count
    or (select count(distinct team_index) from jsonb_to_recordset(normalized -> 'teams') as t(team_index smallint)
        where team_index between 1 and requested_team_count) <> requested_team_count then
    raise exception 'teams must be indexed from one to team_count' using errcode = '22023';
  end if;
  if jsonb_array_length(normalized -> 'assignments') <> participant_count
    or (select count(distinct player_id) from jsonb_to_recordset(normalized -> 'assignments') as a(player_id uuid)) <> participant_count
    or exists (
      select 1 from jsonb_to_recordset(normalized -> 'assignments') as a(player_id uuid, team_index smallint)
      where a.team_index not between 1 and requested_team_count
        or not exists (select 1 from jsonb_to_recordset(normalized -> 'participants') as p(player_id uuid) where p.player_id = a.player_id)
    ) then
    raise exception 'assign exactly every participant to one valid team' using errcode = '22023';
  end if;
  if (select count(distinct run_number) from jsonb_to_recordset(normalized -> 'draw_runs') as r(run_number integer)
      where run_number between 1 and run_count) <> run_count
    or (select count(*) from jsonb_to_recordset(normalized -> 'draw_runs') as r(accepted boolean) where accepted) <> 1
    or not exists (
      select 1 from jsonb_to_recordset(normalized -> 'draw_runs') as r(run_number integer, accepted boolean)
      where run_number = run_count and accepted
    ) then
    raise exception 'contiguous draw runs with only the final run accepted required' using errcode = '22023';
  end if;

  -- Cross-row lineup rules absent from the initial table constraints.
  with lineup as (
    select a.*, p.is_goalkeeper_snapshot
    from jsonb_to_recordset(normalized -> 'assignments') as a(player_id uuid, team_index smallint, starts_as_reserve boolean)
    join jsonb_to_recordset(normalized -> 'participants') as p(player_id uuid, is_goalkeeper_snapshot boolean) using (player_id)
  ), sizes as (
    select team_index, count(*) as size,
      count(*) filter (where not starts_as_reserve) as starters,
      count(*) filter (where is_goalkeeper_snapshot) as keepers,
      count(*) filter (where is_goalkeeper_snapshot and not starts_as_reserve) as court_keepers
    from lineup group by team_index
  )
  select exists (
    select 1 from sizes where starters <> least(court_count, size) or (keepers > 0 and court_keepers = 0)
  ) or (select count(*) from sizes) <> requested_team_count
    or (select max(size) - min(size) from sizes) > 1
    or (select count(*) from sizes where court_keepers > 0) < least(
      requested_team_count, (select count(*) from lineup where is_goalkeeper_snapshot)
    ) into lineup_invalid;
  if lineup_invalid then
    raise exception 'invalid team sizes, reserves or goalkeeper coverage' using errcode = '22023';
  end if;

  -- Serializes RPC calls for the UUID until commit/rollback, including lost responses.
  -- A hash collision only serializes unrelated UUIDs; it cannot conflate their data.
  -- At the Data API's READ COMMITTED isolation the next statement sees the winner.
  perform pg_advisory_xact_lock(hashtextextended(target_match_id::text, 0));
  select * into existing_match from public.matches where id = target_match_id;
  if found then
    if existing_match.group_id <> target_group_id or existing_match.created_by is distinct from actor_id
      or existing_match.status <> 'drawn' then
      raise exception 'match id conflicts with existing content' using errcode = '22023';
    end if;
    -- Reconstruct in one statement/snapshot; exclude generated IDs and timestamps.
    select jsonb_build_object(
      'group_id', m.group_id, 'name', m.name, 'match_date', m.match_date,
      'match_time', m.match_time, 'team_count', m.team_count, 'players_on_court', m.players_on_court,
      'participants', (
        select jsonb_agg(to_jsonb(p) order by p.player_id) from (
          select player_id, player_name_snapshot, player_nickname_snapshot, skill_rating_snapshot,
            is_goalkeeper_snapshot, preferred_position_snapshot, attendance_status
          from public.match_players where match_id = target_match_id
        ) as p
      ),
      'teams', (
        select jsonb_agg(to_jsonb(t) order by t.team_index) from (
          select team_index, name, color from public.teams where match_id = target_match_id
        ) as t
      ),
      'assignments', (
        select jsonb_agg(to_jsonb(a) order by a.player_id) from (
          select a.player_id, t.team_index, a.starts_as_reserve, a.assignment_source
          from public.team_assignments as a join public.teams as t on t.id = a.team_id
          where a.match_id = target_match_id
        ) as a
      ),
      'draw_runs', (
        select jsonb_agg(to_jsonb(r) order by r.run_number) from (
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
    (normalized ->> 'match_date')::date, (normalized ->> 'match_time')::time,
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
  from jsonb_to_recordset(normalized -> 'participants') as p(
    player_id uuid, attendance_status public.attendance_status,
    player_name_snapshot text, player_nickname_snapshot text, skill_rating_snapshot numeric,
    is_goalkeeper_snapshot boolean, preferred_position_snapshot public.preferred_position);

  insert into public.teams (group_id, match_id, team_index, name, color)
  select target_group_id, target_match_id, t.team_index, t.name, t.color
  from jsonb_to_recordset(normalized -> 'teams') as t(team_index smallint, name text, color text);

  insert into public.team_assignments (group_id, match_id, team_id, player_id,
                                      starts_as_reserve, assignment_source)
  select target_group_id, target_match_id, t.id, a.player_id, a.starts_as_reserve, a.assignment_source
  from jsonb_to_recordset(normalized -> 'assignments') as a(
    player_id uuid, team_index smallint, starts_as_reserve boolean, assignment_source public.assignment_source)
  join public.teams as t on t.match_id = target_match_id and t.team_index = a.team_index;

  insert into public.draw_runs (group_id, match_id, run_number, seed, algorithm_version, balance_score, accepted)
  select target_group_id, target_match_id, r.run_number, r.seed, r.algorithm_version, r.balance_score, r.accepted
  from jsonb_to_recordset(normalized -> 'draw_runs') as r(
    run_number integer, seed text, algorithm_version text, balance_score numeric(8, 3), accepted boolean);

  update public.matches set status = 'drawn' where id = target_match_id returning id into inserted_id;
  if inserted_id is null then
    raise exception 'match completion blocked' using errcode = '42501';
  end if;
  return target_match_id;
end;
$$;

revoke all on function public.save_match_draw(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.save_match_draw(uuid, jsonb) from service_role;
grant execute on function public.save_match_draw(uuid, jsonb) to authenticated;
