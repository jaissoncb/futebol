create schema if not exists private;

drop event trigger if exists ensure_rls;

create or replace function private.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  created_table record;
begin
  for created_table in
    select distinct
      namespaces.nspname as schema_name,
      relations.relname as relation_name
    from pg_catalog.pg_event_trigger_ddl_commands() as commands
    join pg_catalog.pg_class as relations
      on commands.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
      and relations.oid = commands.objid
    join pg_catalog.pg_namespace as namespaces
      on namespaces.oid = relations.relnamespace
    where commands.command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and namespaces.nspname = 'public'
      and relations.relkind in ('r', 'p')
  loop
    execute pg_catalog.format(
      'alter table %I.%I enable row level security',
      created_table.schema_name,
      created_table.relation_name
    );
  end loop;
end;
$$;

alter function private.rls_auto_enable() owner to postgres;
revoke all on function private.rls_auto_enable() from public, anon, authenticated;

create event trigger ensure_rls
on ddl_command_end
when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
execute function private.rls_auto_enable();

drop function if exists public.rls_auto_enable();
