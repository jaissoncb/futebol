-- Explicitly selected Futebol DEV only. No secrets, real users or persistent fixtures.
-- SQL Editor proof is not a native restricted-login/pool/concurrency test.
begin;
grant futebol_runtime to current_user;
do $$
declare
  actor uuid;
  repeat_actor uuid;
  other_actor uuid;
  fixture_group uuid;
  fixture text := 'neon-sql-fixture:' || gen_random_uuid()::text;
  denied boolean;
begin
  if current_database() <> 'futebol_dev' then raise exception 'wrong DEV database'; end if;
  if exists (select 1 from pg_roles where rolname in ('futebol_owner','futebol_runtime')
    and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication or rolcanlogin)) then
    raise exception 'unsafe roles';
  end if;
  if pg_has_role('futebol_runtime','futebol_owner','MEMBER') then raise exception 'runtime owner membership'; end if;
  if has_schema_privilege('futebol_runtime','public','CREATE')
    or has_schema_privilege('futebol_runtime','private','CREATE')
    or has_database_privilege('futebol_runtime',current_database(),'CREATE')
    or has_database_privilege('futebol_runtime',current_database(),'TEMPORARY')
    or has_table_privilege('futebol_runtime','private.external_identities','SELECT')
    or has_column_privilege('futebol_runtime','public.groups','created_by','UPDATE') then
    raise exception 'excess runtime grants';
  end if;
  if (select count(*) from pg_tables where schemaname in ('public','private')) <> 11 then
    raise exception 'unexpected schema';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='r'
      and (not c.relrowsecurity or pg_get_userbyid(c.relowner) <> 'futebol_owner')) then
    raise exception 'unsafe RLS or ownership';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where n.nspname in ('public','private') and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'PUBLIC execute';
  end if;
  execute 'set local role futebol_runtime';
  actor := private.bootstrap_user('https://fixture.test',fixture);
  repeat_actor := private.bootstrap_user('https://fixture.test',fixture);
  other_actor := private.bootstrap_user('https://other-fixture.test',fixture);
  if actor <> repeat_actor or actor = other_actor then raise exception 'identity uniqueness'; end if;
  perform set_config('futebol.actor_id',actor::text,true);
  fixture_group := public.create_group('Neon DEV SQL fixture',1::smallint,'futsal');
  if (select count(*) from public.group_members m where m.group_id=fixture_group and m.user_id=actor and m.role='owner') <> 1 then
    raise exception 'first owner';
  end if;
  denied := false;
  begin
    execute 'create table public.forbidden_neon_fixture(id int)';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'runtime DDL allowed'; end if;
  denied := false;
  begin
    execute 'select * from private.external_identities';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'identity table leaked'; end if;
  perform set_config('futebol.actor_id',other_actor::text,true);
  if exists(select 1 from public.groups g where g.id=fixture_group) then raise exception 'outsider RLS leaked'; end if;
  denied := false;
  begin
    insert into public.players(group_id,name) values(fixture_group,'Denied fixture');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'outsider write allowed'; end if;
  perform set_config('futebol.actor_id',actor::text,true);
  begin
    insert into public.players(group_id,name) values(fixture_group,'Rollback fixture');
    raise exception 'fixture rollback' using errcode='P0002';
  exception when no_data_found then null; end;
  if exists(select 1 from public.players p where p.group_id=fixture_group) then raise exception 'subtransaction leaked'; end if;
  execute 'reset role';
  execute 'set local role futebol_owner';
  update private.app_users set disabled_at=now() where id=actor;
  execute 'reset role';
  execute 'set local role futebol_runtime';
  if private.actor_id() is not null then raise exception 'disabled actor accepted'; end if;
  denied := false;
  begin
    perform private.bootstrap_user('https://fixture.test',fixture);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'disabled bootstrap accepted'; end if;
  execute 'reset role';
end $$;
rollback;
select 'PASS' as sql_editor_checks,
  (select count(*) from public.profiles)::int as profiles_after_rollback,
  (select count(*) from public.groups)::int as groups_after_rollback,
  (select nullif(current_setting('futebol.actor_id',true), '') is null) as actor_cleared,
  'NOT_RUN' as native_runtime_login_pool_concurrency;
