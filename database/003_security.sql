begin;
set local role futebol_owner;

-- These few definer functions deliberately use table ownership to avoid RLS
-- recursion and bootstrap the first owner. The NOLOGIN owner cannot be assumed
-- by runtime. Runtime never owns a table and has no BYPASSRLS/DDL/role membership.
create function private.bootstrap_user(verified_issuer text, verified_subject text)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare result uuid;
begin
  if verified_issuer is null or length(verified_issuer) not between 1 and 512
    or verified_subject is null or length(btrim(verified_subject)) not between 1 and 256 then
    raise exception 'identity required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(verified_issuer, verified_subject)::text, 1));
  select user_id into result from private.external_identities
    where issuer=verified_issuer and subject=verified_subject;
  if result is null then
    insert into private.app_users default values returning id into result;
    insert into private.external_identities(issuer, subject, user_id) values(verified_issuer, verified_subject, result);
    insert into public.profiles(id) values(result);
  end if;
  if exists(select 1 from private.app_users where id=result and disabled_at is not null) then
    raise exception 'actor unavailable' using errcode='42501';
  end if;
  return result;
end $$;

create function private.current_user_group_role(target_group_id uuid) returns public.group_role
language sql stable security definer set search_path=pg_catalog as $$
  select role from public.group_members where group_id=target_group_id and user_id=private.actor_id()
$$;
create function private.is_group_member(target_group_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select private.current_user_group_role(target_group_id) is not null
$$;
create function private.can_manage_group(target_group_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select coalesce(private.current_user_group_role(target_group_id) in ('owner','admin'), false)
$$;
create function private.is_group_owner(target_group_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select coalesce(private.current_user_group_role(target_group_id)='owner', false)
$$;
create function private.shares_group_with(target_user_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from public.group_members mine join public.group_members theirs using(group_id)
    where mine.user_id=private.actor_id() and theirs.user_id=target_user_id)
$$;

create function private.set_updated_at() returns trigger language plpgsql set search_path=pg_catalog as $$
begin new.updated_at=now(); return new; end $$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger groups_set_updated_at before update on public.groups for each row execute function private.set_updated_at();
create trigger players_set_updated_at before update on public.players for each row execute function private.set_updated_at();
create trigger matches_set_updated_at before update on public.matches for each row execute function private.set_updated_at();
create trigger assignments_set_updated_at before update on public.team_assignments for each row execute function private.set_updated_at();

create function public.create_group(group_name text, default_players_on_court smallint default 5, sport text default 'futsal')
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid := private.actor_id(); result uuid;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if group_name is null or char_length(btrim(group_name)) not between 2 and 80
    or sport is null or char_length(btrim(sport)) not between 2 and 40
    or default_players_on_court is null or default_players_on_court not between 1 and 20 then
    raise exception 'invalid group input' using errcode='22023';
  end if;
  insert into public.groups(name, created_by, default_players_on_court, sport)
    values(btrim(group_name), actor, default_players_on_court, btrim(sport)) returning id into result;
  insert into public.group_members(group_id,user_id,role) values(result,actor,'owner');
  return result;
end $$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.teams enable row level security;
alter table public.team_assignments enable row level security;
alter table public.draw_runs enable row level security;

create policy profiles_read on public.profiles for select to futebol_runtime
using(id=private.actor_id() or private.shares_group_with(id));
create policy profiles_edit on public.profiles for update to futebol_runtime
using(id=private.actor_id()) with check(id=private.actor_id());
create policy groups_read on public.groups for select to futebol_runtime using(private.is_group_member(id));
create policy groups_edit on public.groups for update to futebol_runtime
using(private.is_group_owner(id)) with check(private.is_group_owner(id));
create policy groups_remove on public.groups for delete to futebol_runtime using(private.is_group_owner(id));
create policy members_read on public.group_members for select to futebol_runtime using(private.is_group_member(group_id));
create policy members_add on public.group_members for insert to futebol_runtime
with check(private.is_group_owner(group_id) and role in ('admin','member') and user_id<>private.actor_id());
create policy members_edit on public.group_members for update to futebol_runtime
using(private.is_group_owner(group_id) and role<>'owner')
with check(private.is_group_owner(group_id) and role in ('admin','member'));
create policy members_remove on public.group_members for delete to futebol_runtime
using(private.is_group_owner(group_id) and role<>'owner');
create policy players_read on public.players for select to futebol_runtime using(private.is_group_member(group_id));
create policy players_add on public.players for insert to futebol_runtime with check(private.can_manage_group(group_id));
create policy players_edit on public.players for update to futebol_runtime
using(private.can_manage_group(group_id)) with check(private.can_manage_group(group_id));
create policy matches_read on public.matches for select to futebol_runtime using(private.is_group_member(group_id));
create policy participants_read on public.match_players for select to futebol_runtime using(private.is_group_member(group_id));
create policy teams_read on public.teams for select to futebol_runtime using(private.is_group_member(group_id));
create policy assignments_read on public.team_assignments for select to futebol_runtime using(private.is_group_member(group_id));
create policy runs_read on public.draw_runs for select to futebol_runtime using(private.is_group_member(group_id));

-- Explicit grants only; no blanket future-table CRUD grants.
revoke all on all tables in schema public, private from public, futebol_runtime;
grant select on public.profiles, public.groups, public.group_members, public.players,
  public.matches, public.match_players, public.teams, public.team_assignments, public.draw_runs to futebol_runtime;
grant update(display_name) on public.profiles to futebol_runtime;
grant update(name, default_players_on_court, sport) on public.groups to futebol_runtime;
grant delete on public.groups to futebol_runtime;
grant insert(group_id,user_id,role), update(role), delete on public.group_members to futebol_runtime;
grant insert(group_id,name,nickname,skill_rating,is_goalkeeper,preferred_position,active),
  update(name,nickname,skill_rating,is_goalkeeper,preferred_position,active) on public.players to futebol_runtime;
revoke all on all functions in schema public, private from public;
grant execute on function private.bootstrap_user(text,text), private.actor_id(),
  private.current_user_group_role(uuid), private.is_group_member(uuid), private.can_manage_group(uuid),
  private.is_group_owner(uuid), private.shares_group_with(uuid), public.create_group(text,smallint,text) to futebol_runtime;
commit;
