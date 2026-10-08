begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select has_table('public', 'profiles', 'profiles existe');
select has_table('public', 'groups', 'groups existe');
select has_table('public', 'group_members', 'group_members existe');
select has_table('public', 'players', 'players existe');
select has_table('public', 'matches', 'matches existe');
select has_table('public', 'match_players', 'match_players existe');
select has_table('public', 'teams', 'teams existe');
select has_table('public', 'team_assignments', 'team_assignments existe');
select has_table('public', 'draw_runs', 'draw_runs existe');

select ok(
  (select bool_and(relrowsecurity)
   from pg_class
   where oid in (
     'public.profiles'::regclass,
     'public.groups'::regclass,
     'public.group_members'::regclass,
     'public.players'::regclass,
     'public.matches'::regclass,
     'public.match_players'::regclass,
     'public.teams'::regclass,
     'public.team_assignments'::regclass,
     'public.draw_runs'::regclass
   )),
  'RLS está ativo em todas as tabelas expostas'
);

select ok(not has_table_privilege('anon', 'public.groups', 'select'), 'anon não lê groups');
select ok(not has_table_privilege('anon', 'public.players', 'select'), 'anon não lê players');
select ok(has_table_privilege('authenticated', 'public.groups', 'select'), 'authenticated pode ler groups via RLS');
select ok(not has_table_privilege('authenticated', 'public.groups', 'insert'), 'groups só são criados pela RPC');
select ok(has_function_privilege(
  'authenticated',
  'public.create_group(text,smallint,text)',
  'execute'
), 'authenticated executa create_group');
select ok(not has_function_privilege(
  'anon',
  'public.create_group(text,smallint,text)',
  'execute'
), 'anon não executa create_group');
select ok(not has_table_privilege('authenticated', 'public.players', 'delete'), 'players não são removidos pelo cliente');
select ok(not has_table_privilege('authenticated', 'public.draw_runs', 'delete'), 'draw_runs são histórico auditável');

select ok(
  not (select prosecdef from pg_proc where oid = 'private.set_updated_at()'::regprocedure),
  'set_updated_at permanece SECURITY INVOKER'
);
select is(
  (select count(*)::integer
   from pg_proc as procedures
   join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
   where namespaces.nspname = 'private' and procedures.prosecdef),
  8,
  'somente os oito helpers necessários no schema private são SECURITY DEFINER'
);
select ok(
  (select bool_and(pg_get_userbyid(procedures.proowner) = 'postgres')
   from pg_proc as procedures
   join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
   where namespaces.nspname = 'private' and procedures.prosecdef),
  'SECURITY DEFINER privados têm owner postgres explícito'
);
select ok(
  (select bool_and(procedures.proconfig @> array['search_path=pg_catalog'])
   from pg_proc as procedures
   join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
   where namespaces.nspname = 'private' and procedures.prosecdef),
  'SECURITY DEFINER privados fixam search_path em pg_catalog'
);
select ok(
  not exists (
    select 1
   from pg_proc as procedures
   join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    cross join lateral aclexplode(coalesce(procedures.proacl, acldefault('f', procedures.proowner))) as acl
    where namespaces.nspname = 'private'
      and procedures.prosecdef
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC não executa SECURITY DEFINER privados'
);
select ok(
  (select bool_and(not has_function_privilege('anon', procedures.oid, 'execute'))
   from pg_proc as procedures
   join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
   where namespaces.nspname = 'private' and procedures.prosecdef),
  'anon não executa SECURITY DEFINER privados'
);
select is(
  (select count(*)::integer
   from pg_proc as procedures
   join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
   where namespaces.nspname = 'private'
     and procedures.prosecdef
     and has_function_privilege('authenticated', procedures.oid, 'execute')),
  6,
  'authenticated executa somente os seis helpers RLS privados'
);
select ok(
  not has_function_privilege('authenticated', 'private.handle_new_user()', 'execute'),
  'authenticated não chama diretamente o trigger de profile'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.create_group(text,smallint,text)'::regprocedure),
  'create_group é SECURITY DEFINER'
);
select is(
  (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.create_group(text,smallint,text)'::regprocedure),
  'postgres',
  'create_group tem owner postgres explícito'
);
select ok(
  (select proconfig @> array['search_path=pg_catalog']
   from pg_proc where oid = 'public.create_group(text,smallint,text)'::regprocedure),
  'create_group fixa search_path em pg_catalog'
);
select ok(
  not exists (
    select 1
    from aclexplode(coalesce(
      (select proacl from pg_proc where oid = 'public.create_group(text,smallint,text)'::regprocedure),
      acldefault('f', (select proowner from pg_proc where oid = 'public.create_group(text,smallint,text)'::regprocedure))
    )) as acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC não executa create_group'
);
select is(
  (select pronargs::integer from pg_proc where oid = 'public.create_group(text,smallint,text)'::regprocedure),
  3,
  'create_group não aceita UUID de owner'
);
select ok(
  (select pg_get_functiondef('public.create_group(text,smallint,text)'::regprocedure)
    ~ 'actor_id uuid := auth.uid\(\)'
   and pg_get_functiondef('public.create_group(text,smallint,text)'::regprocedure)
    ~ 'insert into public.groups'
   and pg_get_functiondef('public.create_group(text,smallint,text)'::regprocedure)
    ~ 'insert into public.group_members'),
  'create_group deriva o owner de auth.uid e qualifica as duas tabelas'
);
select ok(
  (select count(*) = 0
   from pg_policies
   where schemaname = 'public'
     and cmd = 'UPDATE'
     and (qual is null or with_check is null)),
  'todas as UPDATE policies possuem USING e WITH CHECK'
);
select ok(
  (select count(*) = 0
   from pg_policies as updates
   where updates.schemaname = 'public'
     and updates.cmd = 'UPDATE'
     and not exists (
       select 1
       from pg_policies as reads
       where reads.schemaname = updates.schemaname
         and reads.tablename = updates.tablename
         and reads.cmd = 'SELECT'
     )),
  'toda tabela atualizável por RLS possui SELECT correspondente'
);
select ok(
  not has_column_privilege('authenticated', 'public.groups', 'created_by', 'update')
  and not has_column_privilege('authenticated', 'public.players', 'group_id', 'update')
  and not has_column_privilege('authenticated', 'public.matches', 'group_id', 'update')
  and not has_column_privilege('authenticated', 'public.match_players', 'group_id', 'update')
  and not has_column_privilege('authenticated', 'public.teams', 'match_id', 'update')
  and not has_column_privilege('authenticated', 'public.team_assignments', 'match_id', 'update'),
  'grants impedem mover ownership/identidade entre grupos e partidas'
);

select * from finish();
rollback;
