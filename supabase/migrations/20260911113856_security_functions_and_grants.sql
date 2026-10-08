create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger groups_set_updated_at
before update on public.groups
for each row execute function private.set_updated_at();

create trigger players_set_updated_at
before update on public.players
for each row execute function private.set_updated_at();

create trigger matches_set_updated_at
before update on public.matches
for each row execute function private.set_updated_at();

create trigger team_assignments_set_updated_at
before update on public.team_assignments
for each row execute function private.set_updated_at();

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  metadata_name text;
begin
  metadata_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');

  insert into public.profiles (id, display_name)
  values (
    new.id,
    case
      when metadata_name is not null and char_length(metadata_name) between 2 and 80
        then metadata_name
      else null
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

alter function private.handle_new_user() owner to postgres;
revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create function private.current_user_group_role(target_group_id uuid)
returns public.group_role
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select members.role
  from public.group_members as members
  where members.group_id = target_group_id
    and members.user_id = (select auth.uid())
$$;

create function private.is_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select private.current_user_group_role(target_group_id) is not null
$$;

create function private.can_manage_group(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(
    private.current_user_group_role(target_group_id) in ('owner', 'admin'),
    false
  )
$$;

create function private.is_group_owner(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select coalesce(private.current_user_group_role(target_group_id) = 'owner', false)
$$;

create function private.shares_group_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.group_members as mine
    join public.group_members as theirs using (group_id)
    where mine.user_id = (select auth.uid())
      and theirs.user_id = target_user_id
  )
$$;

create function private.can_manage_match(target_group_id uuid, target_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select private.can_manage_group(target_group_id)
    and exists (
      select 1
      from public.matches as matches
      where matches.group_id = target_group_id
        and matches.id = target_match_id
        and matches.status in ('draft', 'drawn')
    )
$$;

alter function private.current_user_group_role(uuid) owner to postgres;
alter function private.is_group_member(uuid) owner to postgres;
alter function private.can_manage_group(uuid) owner to postgres;
alter function private.is_group_owner(uuid) owner to postgres;
alter function private.shares_group_with(uuid) owner to postgres;
alter function private.can_manage_match(uuid, uuid) owner to postgres;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.current_user_group_role(uuid) from public, anon, authenticated;
revoke all on function private.is_group_member(uuid) from public, anon, authenticated;
revoke all on function private.can_manage_group(uuid) from public, anon, authenticated;
revoke all on function private.is_group_owner(uuid) from public, anon, authenticated;
revoke all on function private.shares_group_with(uuid) from public, anon, authenticated;
revoke all on function private.can_manage_match(uuid, uuid) from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.current_user_group_role(uuid) to authenticated;
grant execute on function private.is_group_member(uuid) to authenticated;
grant execute on function private.can_manage_group(uuid) to authenticated;
grant execute on function private.is_group_owner(uuid) to authenticated;
grant execute on function private.shares_group_with(uuid) to authenticated;
grant execute on function private.can_manage_match(uuid, uuid) to authenticated;

create function public.create_group(
  group_name text,
  default_players_on_court smallint default 5,
  sport text default 'futsal'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_id uuid := auth.uid();
  created_group_id uuid;
  normalized_name text := btrim(group_name);
  normalized_sport text := btrim(sport);
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if char_length(normalized_name) not between 2 and 80 then
    raise exception 'group name must have between 2 and 80 characters'
      using errcode = '22023';
  end if;

  if char_length(normalized_sport) not between 2 and 40 then
    raise exception 'sport must have between 2 and 40 characters'
      using errcode = '22023';
  end if;

  if default_players_on_court not between 1 and 20 then
    raise exception 'players on court must be between 1 and 20'
      using errcode = '22023';
  end if;

  insert into public.groups (name, created_by, default_players_on_court, sport)
  values (normalized_name, actor_id, default_players_on_court, normalized_sport)
  returning id into created_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (created_group_id, actor_id, 'owner');

  return created_group_id;
end;
$$;

alter function public.create_group(text, smallint, text) owner to postgres;
revoke all on function public.create_group(text, smallint, text) from public, anon, authenticated;
grant execute on function public.create_group(text, smallint, text) to authenticated;

revoke all on table
  public.profiles,
  public.groups,
  public.group_members,
  public.players,
  public.matches,
  public.match_players,
  public.teams,
  public.team_assignments,
  public.draw_runs
from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select on public.groups to authenticated;
grant update (name, default_players_on_court, sport) on public.groups to authenticated;
grant delete on public.groups to authenticated;

grant select on public.group_members to authenticated;
grant insert (group_id, user_id, role) on public.group_members to authenticated;
grant update (role) on public.group_members to authenticated;
grant delete on public.group_members to authenticated;

grant select on public.players to authenticated;
grant insert (group_id, name, nickname, skill_rating, is_goalkeeper, preferred_position, active)
  on public.players to authenticated;
grant update (name, nickname, skill_rating, is_goalkeeper, preferred_position, active)
  on public.players to authenticated;

grant select on public.matches to authenticated;
grant insert (group_id, name, match_date, match_time, team_count, players_on_court, status, created_by)
  on public.matches to authenticated;
grant update (name, match_date, match_time, team_count, players_on_court, status)
  on public.matches to authenticated;
grant delete on public.matches to authenticated;

grant select on public.match_players to authenticated;
grant insert (
  group_id,
  match_id,
  player_id,
  attendance_status,
  player_name_snapshot,
  player_nickname_snapshot,
  skill_rating_snapshot,
  is_goalkeeper_snapshot,
  preferred_position_snapshot
) on public.match_players to authenticated;
grant update (attendance_status) on public.match_players to authenticated;
grant delete on public.match_players to authenticated;

grant select on public.teams to authenticated;
grant insert (group_id, match_id, team_index, name, color) on public.teams to authenticated;
grant update (team_index, name, color) on public.teams to authenticated;
grant delete on public.teams to authenticated;

grant select on public.team_assignments to authenticated;
grant insert (group_id, match_id, team_id, player_id, starts_as_reserve, assignment_source)
  on public.team_assignments to authenticated;
grant update (team_id, starts_as_reserve, assignment_source)
  on public.team_assignments to authenticated;
grant delete on public.team_assignments to authenticated;

grant select on public.draw_runs to authenticated;
grant insert (group_id, match_id, run_number, seed, algorithm_version, balance_score, accepted)
  on public.draw_runs to authenticated;
grant update (accepted) on public.draw_runs to authenticated;
