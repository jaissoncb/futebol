-- Run as migration/database owner, never runtime; fresh dedicated DEV database only.
-- PUBLIC otherwise receives TEMPORARY by default in PostgreSQL.
begin;
do $$
begin
  execute format('revoke all on database %I from public', current_database());
  execute format('grant connect on database %I to futebol_runtime', current_database());
end $$;
commit;
