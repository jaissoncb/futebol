-- Read-only, run as the ACTUAL runtime login, first pooled then direct.
-- No SET ROLE, actor/bootstrap, writes, fixtures or secret catalog access.
begin read only;
do $$
declare
  item record;
  col record;
  privilege text;
  expected boolean;
  insert_columns text[];
  update_columns text[];
  allowed_functions oid[] := array[
    'private.bootstrap_user(text,text)'::regprocedure::oid,
    'private.actor_id()'::regprocedure::oid,
    'private.current_user_group_role(uuid)'::regprocedure::oid,
    'private.is_group_member(uuid)'::regprocedure::oid,
    'private.can_manage_group(uuid)'::regprocedure::oid,
    'private.is_group_owner(uuid)'::regprocedure::oid,
    'private.shares_group_with(uuid)'::regprocedure::oid,
    'public.create_group(text,smallint,text)'::regprocedure::oid,
    'public.save_match_draw(uuid,jsonb)'::regprocedure::oid
  ];
begin
  if current_database()<>'futebol_prd' or current_user<>'futebol_api_prd_functions'
     or session_user<>current_user or current_setting('server_version_num')::int / 10000<>17 then
    raise exception 'prd_runtime_target_rejected';
  end if;
  if not exists (select 1 from pg_roles r where r.rolname=current_user and r.rolcanlogin
      and r.rolinherit and not r.rolsuper and not r.rolbypassrls and not r.rolcreatedb
      and not r.rolcreaterole and not r.rolreplication and r.rolconfig is null)
     or not pg_has_role(current_user,'futebol_runtime','USAGE')
     or exists (select 1 from pg_roles r where r.rolname not in (current_user,'futebol_runtime')
       and pg_has_role(current_user,r.oid,'MEMBER'))
     or exists (select 1 from pg_auth_members m where m.member=(current_user::regrole)::oid
       and (pg_get_userbyid(m.roleid)<>'futebol_runtime' or m.admin_option or m.set_option or not m.inherit_option)) then
    raise exception 'prd_runtime_role_rejected';
  end if;
  if exists (select 1 from pg_roles where rolname in ('futebol_owner','futebol_runtime')
      and (rolcanlogin or rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication))
     or exists (select 1 from pg_auth_members where member=('futebol_runtime'::regrole)::oid)
     or exists (select 1 from pg_namespace where nspowner=(current_user::regrole)::oid)
     or exists (select 1 from pg_class where relowner=(current_user::regrole)::oid)
     or exists (select 1 from pg_proc where proowner=(current_user::regrole)::oid)
     or exists (select 1 from pg_type where typowner=(current_user::regrole)::oid)
     or exists (select 1 from pg_database where datdba=(current_user::regrole)::oid)
     or not has_database_privilege(current_user,current_database(),'CONNECT')
     or has_database_privilege(current_user,current_database(),'CREATE')
     or has_database_privilege(current_user,current_database(),'TEMPORARY')
     or exists (select 1 from pg_namespace where has_schema_privilege(current_user,oid,'CREATE'))
     or not has_schema_privilege(current_user,'public','USAGE')
     or not has_schema_privilege(current_user,'private','USAGE') then
    raise exception 'prd_runtime_boundary_rejected';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and c.relkind='r')<>11
     or exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('public','private') and c.relkind='r'
       and (not c.relrowsecurity or pg_get_userbyid(c.relowner)<>'futebol_owner')) then
    raise exception 'prd_rls_boundary_rejected';
  end if;
  for item in select c.oid,n.nspname,c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='r'
  loop
    if item.nspname='public' and item.relname not in ('profiles','groups','group_members','players',
      'matches','match_players','teams','team_assignments','draw_runs') then
      raise exception 'prd_unexpected_table';
    end if;
    foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      expected := item.nspname='public' and (privilege='SELECT'
        or (privilege='DELETE' and item.relname in ('groups','group_members')));
      if has_table_privilege(current_user,item.oid,privilege)<>expected then
        raise exception 'prd_table_grant_rejected';
      end if;
    end loop;
    insert_columns := case when item.nspname='public' and item.relname='group_members'
      then array['group_id','user_id','role']
      when item.nspname='public' and item.relname='players'
      then array['group_id','name','nickname','skill_rating','is_goalkeeper','preferred_position','active']
      else array[]::text[] end;
    update_columns := case when item.nspname<>'public' then array[]::text[]
      when item.relname='profiles' then array['display_name']
      when item.relname='groups' then array['name','default_players_on_court','sport']
      when item.relname='group_members' then array['role']
      when item.relname='players' then array['name','nickname','skill_rating','is_goalkeeper','preferred_position','active']
      else array[]::text[] end;
    for col in select attnum,attname from pg_attribute where attrelid=item.oid and attnum>0 and not attisdropped loop
      if has_column_privilege(current_user,item.oid,col.attnum,'SELECT')<>(item.nspname='public')
         or has_column_privilege(current_user,item.oid,col.attnum,'INSERT')<>(col.attname=any(insert_columns))
         or has_column_privilege(current_user,item.oid,col.attnum,'UPDATE')<>(col.attname=any(update_columns))
         or has_column_privilege(current_user,item.oid,col.attnum,'REFERENCES') then
        raise exception 'prd_column_grant_rejected';
      end if;
    end loop;
    if item.nspname='public' then
      if not exists (select 1 from pg_policy where polrelid=item.oid
          and ('futebol_runtime'::regrole)::oid=any(polroles)) then
        raise exception 'prd_policy_missing';
      end if;
      execute format('select exists(select 1 from %I.%I)',item.nspname,item.relname) into expected;
      if expected then raise exception 'prd_no_actor_rls_rejected'; end if;
    end if;
  end loop;
  if private.actor_id() is not null then raise exception 'prd_actor_context_rejected'; end if;
  for item in select p.oid,p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private')
  loop
    if has_function_privilege(current_user,item.oid,'EXECUTE')<>(item.oid=any(allowed_functions))
       or pg_get_userbyid(item.proowner)<>'futebol_owner' then
      raise exception 'prd_function_grant_rejected';
    end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where n.nspname in ('public','private') and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'prd_public_execute_rejected';
  end if;
  if exists (select 1 from pg_database d,
      lateral aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
      where d.datname=current_database() and a.grantee=0)
     or exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace,
       lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
       where n.nspname in ('public','private') and a.grantee=0)
     or exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace,
       lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
       where n.nspname in ('public','private') and a.is_grantable
       and a.grantee in ((current_user::regrole)::oid,('futebol_runtime'::regrole)::oid))
     or exists (select 1 from pg_attribute attribute_acl join pg_class c on c.oid=attribute_acl.attrelid
       join pg_namespace n on n.oid=c.relnamespace, lateral aclexplode(attribute_acl.attacl) a
       where n.nspname in ('public','private') and (a.grantee=0 or (a.is_grantable
         and a.grantee in ((current_user::regrole)::oid,('futebol_runtime'::regrole)::oid)))) then
    raise exception 'prd_public_or_grant_option_rejected';
  end if;
end $$;
commit;
select 'prd_effective_grants_and_no_actor_rls_pass' as status;
-- This proves effective permissions/no-actor behavior, not a multi-user policy test.
