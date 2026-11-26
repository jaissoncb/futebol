-- Apply as the migration identity. A dedicated schema keeps the existing
-- public/private runtime readiness contract valid during a staged release.
begin;
set local lock_timeout = '5s';
create schema futebol_sharing authorization futebol_owner;
set local role futebol_owner;
revoke all on schema futebol_sharing from public, futebol_runtime;
grant usage on schema futebol_sharing to futebol_runtime;

create table futebol_sharing.publications (
  address_hash bytea primary key,
  group_id uuid,
  match_id uuid,
  version integer not null check (version > 0),
  schema_version smallint not null default 1,
  slug text,
  snapshot jsonb,
  options jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  unique (match_id, version),
  constraint publication_match_fk foreign key (group_id, match_id)
    references public.matches (group_id, id) match full on delete set null,
  check ((slug is null) = (snapshot is null)),
  check (revoked_at is null or snapshot is null),
  check (match_id is not null or (snapshot is null and options is null and revoked_at is not null))
);
alter table futebol_sharing.publications enable row level security;
revoke all on table futebol_sharing.publications from public, futebol_runtime;
create index publications_expiration on futebol_sharing.publications (expires_at) where snapshot is not null;
create index publications_match_fk on futebol_sharing.publications (group_id, match_id);

create function futebol_sharing.unlink_match() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  new.snapshot := null;
  new.slug := null;
  new.options := null;
  new.revoked_at := coalesce(old.revoked_at, clock_timestamp());
  return new;
end $$;
create trigger unlink_deleted_match before update of match_id on futebol_sharing.publications
for each row when (old.match_id is not null and new.match_id is null)
execute function futebol_sharing.unlink_match();

create function futebol_sharing.snapshot_for(target_group uuid, target_match uuid, group_name text)
returns jsonb language sql stable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'groupName', regexp_replace(group_name, '[[:cntrl:]]+', ' ', 'g'),
    'matchDate', to_char(m.match_date, 'YYYY-MM-DD'),
    'teams', (select jsonb_agg(jsonb_build_object(
      'name', regexp_replace(t.name, '[[:cntrl:]]+', ' ', 'g'),
      'color', case when t.color ~ '^(blue|red|green|#[0-9A-Fa-f]{6})$' then lower(t.color) end,
      'players', (select jsonb_agg(jsonb_build_object(
        'name', regexp_replace(coalesce(p.player_nickname_snapshot, p.player_name_snapshot), '[[:cntrl:]]+', ' ', 'g'),
        'reserve', a.starts_as_reserve,
        'goalkeeper', p.is_goalkeeper_snapshot
      ) order by a.starts_as_reserve, coalesce(p.player_nickname_snapshot, p.player_name_snapshot) collate "C", a.player_id)
        from public.team_assignments a
        join public.match_players p using (group_id, match_id, player_id)
        where a.group_id = t.group_id and a.match_id = t.match_id and a.team_id = t.id)
    ) order by t.team_index) from public.teams t where t.group_id = m.group_id and t.match_id = m.id)
  )
  from public.matches m where m.group_id = target_group and m.id = target_match and m.status = 'drawn'
$$;

create function futebol_sharing.project_snapshot(full_snapshot jsonb, disclosure jsonb)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object('teams', case when (disclosure->>'goalkeepers')::boolean
    then full_snapshot->'teams'
    else (select jsonb_agg(
      jsonb_set(t.team, '{players}', (select jsonb_agg(p.player - 'goalkeeper' order by p.position)
        from jsonb_array_elements(t.team->'players') with ordinality p(player, position)))
      order by t.position)
      from jsonb_array_elements(full_snapshot->'teams') with ordinality t(team, position))
    end)
    || case when (disclosure->>'groupName')::boolean then jsonb_build_object('groupName', full_snapshot->'groupName') else '{}'::jsonb end
    || case when (disclosure->>'matchDate')::boolean then jsonb_build_object('matchDate', full_snapshot->'matchDate') else '{}'::jsonb end
$$;

create function futebol_sharing.new_slug(prefix text) returns text
language plpgsql volatile set search_path = pg_catalog as $$
declare
  -- Random v4 UUID bytes 0–5 are entirely random. Mask five bits per byte.
  alphabet constant text := '23456789abcdefghijkmnpqrstuvwxyz';
  random_bytes bytea := uuid_send(gen_random_uuid());
  suffix text := '';
  part integer;
begin
  for part in 0..5 loop
    suffix := suffix || substr(alphabet, (get_byte(random_bytes, part) & 31) + 1, 1);
  end loop;
  return prefix || '-' || suffix;
end $$;

create function futebol_sharing.lookup(public_slug text) returns jsonb
language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object('snapshot', s.snapshot, 'expiresAt', s.expires_at)
  from futebol_sharing.publications s
  where public_slug ~ '^[a-z0-9][a-z0-9-]{0,39}-[23456789abcdefghijkmnpqrstuvwxyz]{6}$'
    and s.address_hash = sha256(convert_to(public_slug, 'UTF8'))
    and s.slug = public_slug and s.schema_version = 1 and s.revoked_at is null
    and s.expires_at > statement_timestamp()
$$;

create function futebol_sharing.purge_expired() returns integer
language plpgsql security definer set search_path = pg_catalog as $$
declare removed integer;
begin
  update futebol_sharing.publications set snapshot = null, slug = null
  where snapshot is not null and expires_at <= statement_timestamp();
  get diagnostics removed = row_count;
  return removed;
end $$;

create function futebol_sharing.manage(
  target_group uuid, target_match uuid, action text, disclosure jsonb, days integer,
  expected_version text, expected_revision text
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  full_snapshot jsonb;
  candidate jsonb;
  previous futebol_sharing.publications%rowtype;
  group_name text;
  revision text;
  state_token text;
  published boolean;
  changed boolean;
  prefix text;
  address text;
  current_time_at timestamptz;
  attempt integer;
begin
  if action is null or action not in ('status', 'publish', 'renew', 'replace', 'revoke') then
    raise exception 'invalid sharing action' using errcode = '22023';
  end if;
  if not private.is_group_owner(target_group) then
    raise exception 'group owner required' using errcode = '42501';
  end if;

  if action = 'status' then
    select g.name into group_name from public.groups g where g.id = target_group;
  else
    -- Group first, then the match. This is also the order of group deletion.
    select g.name into group_name from public.groups g where g.id = target_group for share;
    perform 1 from public.group_members
      where group_id = target_group and user_id = private.actor_id() and role = 'owner' for share;
    if not found then raise exception 'group owner required' using errcode = '42501'; end if;

    perform 1 from public.matches m where m.group_id = target_group and m.id = target_match and m.status = 'drawn' for update;
    if not found then raise exception 'saved draw unavailable' using errcode = 'P0804'; end if;
  end if;

  full_snapshot := futebol_sharing.snapshot_for(target_group, target_match, group_name);
  if full_snapshot is null or full_snapshot->'teams' = 'null'::jsonb or exists (
    select 1 from jsonb_array_elements(full_snapshot->'teams') t where t->'players' = 'null'::jsonb
  ) then
    raise exception 'saved draw unavailable' using errcode = 'P0804';
  end if;
  revision := encode(sha256(convert_to(full_snapshot::text, 'UTF8')), 'hex');

  select * into previous from futebol_sharing.publications s
    where s.match_id = target_match and s.group_id = target_group order by s.version desc limit 1;
  current_time_at := clock_timestamp();
  if previous.address_hash is not null then
    state_token := encode(sha256(convert_to(jsonb_build_array(
      encode(previous.address_hash, 'hex'), extract(epoch from previous.expires_at),
      extract(epoch from previous.revoked_at)
    )::text, 'UTF8')), 'hex');
  end if;
  published := previous.snapshot is not null and previous.revoked_at is null and previous.expires_at > current_time_at;
  changed := published and previous.snapshot - 'groupName' is distinct from
    futebol_sharing.project_snapshot(full_snapshot, previous.options) - 'groupName';

  if action = 'status' then
    return jsonb_build_object(
      'status', case when previous.address_hash is null then 'private'
        when previous.revoked_at is not null then 'revoked'
        when not published then 'expired' else 'published' end,
      'version', state_token, 'revision', revision, 'preview', full_snapshot,
      'options', previous.options, 'changed', changed,
      'publication', case when published then jsonb_build_object(
        'slug', previous.slug, 'snapshot', previous.snapshot, 'expiresAt', previous.expires_at)
      end
    );
  end if;

  if action <> 'revoke' then
    if days is null or days not in (7, 30, 90) or jsonb_typeof(disclosure) is distinct from 'object'
      or disclosure - array['groupName','matchDate','goalkeepers'] <> '{}'::jsonb
      or jsonb_typeof(disclosure->'groupName') is distinct from 'boolean'
      or jsonb_typeof(disclosure->'matchDate') is distinct from 'boolean'
      or jsonb_typeof(disclosure->'goalkeepers') is distinct from 'boolean' then
      raise exception 'invalid disclosure' using errcode = '22023';
    end if;
    if expected_revision is distinct from revision then
      raise exception 'preview changed' using errcode = '40001';
    end if;
    if action = 'publish' and published and not changed and disclosure = previous.options then
      return futebol_sharing.manage(target_group, target_match, 'status', null, null, null, null);
    end if;
  end if;

  if expected_version is distinct from state_token then
    raise exception 'publication changed' using errcode = '40001';
  end if;

  if action = 'revoke' then
    update futebol_sharing.publications set revoked_at = current_time_at, snapshot = null, slug = null
    where address_hash = previous.address_hash and revoked_at is null;
  elsif action = 'renew' then
    if not published or changed or disclosure is distinct from previous.options then
      raise exception 'publication requires a new link' using errcode = '40001';
    end if;
    update futebol_sharing.publications set expires_at = expires_at + make_interval(days => days)
      where address_hash = previous.address_hash;
  else
    if action = 'replace' and not published then
      raise exception 'publication unavailable for replacement' using errcode = '40001';
    end if;
    candidate := futebol_sharing.project_snapshot(full_snapshot, disclosure);
    -- Contact details pasted into a display-name field must not reach the public DTO.
    if exists (
      select 1 from (
        select candidate->>'groupName' as label
        union all select t->>'name' from jsonb_array_elements(candidate->'teams') t
        union all select p->>'name' from jsonb_array_elements(candidate->'teams') t,
          lateral jsonb_array_elements(t->'players') p
      ) labels where label ~* '[@]|([0-9][(). +/-]*){7,}'
    ) then raise exception 'contact in public names' using errcode = 'P0805'; end if;

    prefix := coalesce(nullif(trim(both '-' from left(
      regexp_replace(lower(regexp_replace(normalize(candidate->>'groupName', NFKD), U&'[\0300-\036F]', '', 'g') collate "C"),
        '[^a-z0-9]+', '-', 'g'), 40)), ''), 'sorteio');
    -- Keep the last public version immutable until the new one commits.
    update futebol_sharing.publications set revoked_at = current_time_at, snapshot = null, slug = null
    where address_hash = previous.address_hash and revoked_at is null;
    for attempt in 1..8 loop
      address := futebol_sharing.new_slug(prefix);
      insert into futebol_sharing.publications(address_hash, group_id, match_id, version, slug, snapshot, options, expires_at)
      values (sha256(convert_to(address, 'UTF8')), target_group, target_match, coalesce(previous.version, 0) + 1,
        address, candidate, disclosure, current_time_at + make_interval(days => days))
      on conflict (address_hash) do nothing;
      if found then exit; end if;
      if attempt = 8 then raise exception 'public address allocation failed' using errcode = '40001'; end if;
    end loop;
  end if;
  return futebol_sharing.manage(target_group, target_match, 'status', null, null, null, null);
end $$;

revoke all on all functions in schema futebol_sharing from public, futebol_runtime;
grant execute on function futebol_sharing.lookup(text),
  futebol_sharing.manage(uuid, uuid, text, jsonb, integer, text, text),
  futebol_sharing.purge_expired() to futebol_runtime;
commit;
