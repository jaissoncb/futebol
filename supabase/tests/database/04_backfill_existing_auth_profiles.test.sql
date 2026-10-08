begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '40000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'backfill-name@example.test',
    '',
    now(),
    '{}',
    '{"display_name":"  Existing Player  "}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '40000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'preserve@example.test',
    '',
    now(),
    '{}',
    '{"display_name":"Metadata Must Not Win"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '40000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'backfill-null@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

delete from public.profiles
where id in (
  '40000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000003'
);

update public.profiles
set display_name = 'Existing Profile'
where id = '40000000-0000-0000-0000-000000000002';

insert into public.profiles (id, display_name)
select
  users.id,
  case
    when nullif(btrim(users.raw_user_meta_data ->> 'display_name'), '') is not null
      and char_length(btrim(users.raw_user_meta_data ->> 'display_name')) between 2 and 80
      then btrim(users.raw_user_meta_data ->> 'display_name')
    else null
  end
from auth.users as users
on conflict (id) do nothing;

select ok(
  exists (
    select 1
    from public.profiles
    where id = '40000000-0000-0000-0000-000000000001'
  ),
  'backfill cria profile para usuário Auth preexistente'
);

select is(
  (
    select display_name
    from public.profiles
    where id = '40000000-0000-0000-0000-000000000001'
  ),
  'Existing Player',
  'backfill usa display_name válido e normalizado como a trigger'
);

select is(
  (
    select display_name
    from public.profiles
    where id = '40000000-0000-0000-0000-000000000003'
  ),
  null,
  'backfill mantém display_name nulo sem metadado apropriado'
);

select ok(
  not exists (
    select 1
    from auth.users as users
    left join public.profiles as profiles on profiles.id = users.id
    where profiles.id is null
  ),
  'todo usuário Auth possui profile após o backfill'
);

select ok(
  not exists (
    select 1
    from public.profiles as profiles
    left join auth.users as users on users.id = profiles.id
    where users.id is null
  ),
  'todo profiles.id corresponde a auth.users.id'
);

insert into public.profiles (id, display_name)
select
  users.id,
  case
    when nullif(btrim(users.raw_user_meta_data ->> 'display_name'), '') is not null
      and char_length(btrim(users.raw_user_meta_data ->> 'display_name')) between 2 and 80
      then btrim(users.raw_user_meta_data ->> 'display_name')
    else null
  end
from auth.users as users
on conflict (id) do nothing;

select is(
  (
    select display_name
    from public.profiles
    where id = '40000000-0000-0000-0000-000000000002'
  ),
  'Existing Profile',
  'rerodar o backfill não sobrescreve profile existente'
);

select is(
  (
    select count(*)
    from public.profiles
    where id in (
      '40000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000003'
    )
  ),
  3::bigint,
  'rerodar o backfill não cria profiles duplicados'
);

select hasnt_column(
  'public',
  'profiles',
  'email',
  'profiles não possui coluna de email'
);

select * from finish();
rollback;
