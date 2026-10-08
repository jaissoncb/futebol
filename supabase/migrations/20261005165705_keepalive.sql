create or replace function public.keepalive()
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select 'ok'::text
$$;

revoke all on function public.keepalive() from public, anon, authenticated, service_role;
grant execute on function public.keepalive() to anon;
