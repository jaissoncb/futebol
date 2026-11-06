-- Read-only guard. Run on the direct endpoint pinned to Production, never neondb.
begin read only;
do $$
begin
  if current_database() <> 'futebol_prd' or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner'
     or current_setting('server_version_num')::int / 10000 <> 17 then
    raise exception 'prd_target_rejected';
  end if;
  if not exists (select 1 from pg_database where datname=current_database()
      and pg_get_userbyid(datdba)='neondb_owner')
     or not exists (select 1 from pg_roles where rolname=current_user and rolcreaterole) then
    raise exception 'prd_migration_identity_rejected';
  end if;
  if exists (select 1 from pg_namespace where nspname='private')
     or exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
     or exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public')
     or exists (select 1 from pg_roles where rolname in ('futebol_owner','futebol_runtime','futebol_api_prd_functions')) then
    raise exception 'prd_not_fresh';
  end if;
end $$;
commit;
