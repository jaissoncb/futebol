-- Execute as the restricted runtime on the authorized, independently
-- verified DEV/PRD target. No domain rows, credentials or writes.
begin read only;
select current_database() as database_name, current_user as runtime_login,
       has_table_privilege('public.groups', 'DELETE') as group_delete,
       not has_table_privilege('public.profiles', 'DELETE') as no_profile_delete,
       not has_table_privilege('private.app_users', 'DELETE') as no_user_delete;
select tablename, policyname, roles, cmd, qual
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'groups' and cmd in ('DELETE', 'ALL')
  order by policyname;
select conrelid::regclass as child, confrelid::regclass as parent,
       conname, confdeltype, condeferrable, condeferred, convalidated
  from pg_catalog.pg_constraint
  where contype = 'f' and conrelid in ('public.groups'::regclass,
    'public.group_members'::regclass, 'public.players'::regclass, 'public.matches'::regclass,
    'public.match_players'::regclass, 'public.teams'::regclass,
    'public.team_assignments'::regclass, 'public.draw_runs'::regclass)
  order by conrelid::regclass::text, conname;
rollback;
