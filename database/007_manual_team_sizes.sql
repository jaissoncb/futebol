-- Keep the existing RPC and ACL. Replace only the size rule in the reviewed 004 definition.
begin;
set local lock_timeout = '5s';
set local role futebol_owner;

do $migration$
declare
  rpc constant pg_catalog.regprocedure := 'public.save_match_draw(uuid,jsonb)'::pg_catalog.regprocedure;
  old_rule constant pg_catalog.text := 'or (select pg_catalog.max(size) - pg_catalog.min(size) from sizes) > 1';
  new_rule constant pg_catalog.text := $rule$or ((select pg_catalog.max(size) - pg_catalog.min(size) from sizes) > 1
      and not ((normalized -> 'assignments') @> '[{"assignment_source":"manual"}]'::pg_catalog.jsonb))$rule$;
  expected_body_sha256 constant pg_catalog.text := 'a8f2bd6acc477a38aa430ab67503ebc22a77aa87fc6e5eee0113dbc3b2c95786';
  definition pg_catalog.text := pg_catalog.pg_get_functiondef(rpc);
begin
  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid = rpc and proowner = 'futebol_owner'::pg_catalog.regrole and prosecdef
      and proconfig = array['search_path=pg_catalog']
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc, 'UTF8')), 'hex') = expected_body_sha256
  ) then
    raise exception 'unexpected save_match_draw definition before migration 007';
  end if;

  -- pg_get_functiondef emits CREATE OR REPLACE FUNCTION with the current signature and settings.
  execute pg_catalog.replace(definition, old_rule, new_rule);
end
$migration$;

commit;
