begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

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
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'a@example.test', '', now(), '{}', '{"display_name":"User A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b@example.test', '', now(), '{}', '{"display_name":"User B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'c@example.test', '', now(), '{}', '{"display_name":"Member C"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'd@example.test', '', now(), '{}', '{"display_name":"Admin D"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'e@example.test', '', now(), '{}', '{"display_name":"Admin E"}', now(), now());

set local role anon;
select throws_ok(
  $$select public.create_group('Grupo anônimo', 5::smallint, 'futsal')$$,
  '42501',
  null,
  'usuário não autenticado não executa create_group'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.group_a', public.create_group('Grupo A', 5::smallint, 'futsal')::text, true);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('test.group_b', public.create_group('Grupo B', 5::smallint, 'futsal')::text, true);

select is(
  (select count(*)::integer from public.group_members where group_id = current_setting('test.group_b')::uuid and user_id = auth.uid() and role = 'owner'),
  1,
  'User B recebe owner atomicamente no Grupo B'
);

insert into public.players (group_id, name, skill_rating)
values (current_setting('test.group_b')::uuid, 'Jogador B', 3.5);
select set_config('test.player_b', (select id::text from public.players where name = 'Jogador B'), true);
select is((select count(*)::integer from public.groups where id = current_setting('test.group_b')::uuid), 1, 'User B lê Grupo B');
select is((select count(*)::integer from public.players where id = current_setting('test.player_b')::uuid), 1, 'User B lê jogador do Grupo B');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.groups where id = current_setting('test.group_a')::uuid),
  1,
  'User A lê Grupo A'
);
select is(
  (select count(*)::integer from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = auth.uid() and role = 'owner'),
  1,
  'User A recebe owner atomicamente no Grupo A'
);
select throws_ok(
  $$select public.create_group('x', 5::smallint, 'futsal')$$,
  '22023',
  null,
  'falha na criação não deixa grupo parcial'
);
select is((select count(*)::integer from public.groups where name = 'x'), 0, 'RPC inválida não persiste grupo');
select throws_ok(
  $$insert into public.groups (name, created_by) values ('Bypass', auth.uid())$$,
  '42501',
  null,
  'authenticated não contorna a RPC com INSERT direto em groups'
);

insert into public.players (group_id, name, skill_rating)
values (current_setting('test.group_a')::uuid, 'Jogador A', 3.5);
select set_config('test.player_a', (select id::text from public.players where name = 'Jogador A'), true);

select is((select count(*)::integer from public.players where id = current_setting('test.player_a')::uuid), 1, 'User A lê jogador do Grupo A');
select is((select count(*)::integer from public.groups where id = current_setting('test.group_b')::uuid), 0, 'User A não lê Grupo B');
select is((select count(*)::integer from public.players where id = current_setting('test.player_b')::uuid), 0, 'User A não lê jogador do Grupo B');
update public.groups set name = 'Ataque A' where id = current_setting('test.group_b')::uuid;
select throws_ok(
  $$insert into public.players (group_id, name, skill_rating) values (current_setting('test.group_b')::uuid, 'Intruso A', 3.0)$$,
  '42501',
  null,
  'User A não cria player no Grupo B conhecendo o UUID'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select name from public.groups where id = current_setting('test.group_b')::uuid), 'Grupo B', 'User A não altera Grupo B');
select is((select count(*)::integer from public.groups where id = current_setting('test.group_a')::uuid), 0, 'User B não lê Grupo A');
select is((select count(*)::integer from public.players where id = current_setting('test.player_a')::uuid), 0, 'User B não lê jogador do Grupo A');
update public.groups set name = 'Ataque B' where id = current_setting('test.group_a')::uuid;
select throws_ok(
  $$insert into public.players (group_id, name, skill_rating) values (current_setting('test.group_a')::uuid, 'Intruso B', 3.0)$$,
  '42501',
  null,
  'User B não cria player no Grupo A conhecendo o UUID'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select name from public.groups where id = current_setting('test.group_a')::uuid), 'Grupo A', 'User B não altera Grupo A');

insert into public.group_members (group_id, user_id, role)
values
  (current_setting('test.group_a')::uuid, '10000000-0000-0000-0000-000000000003', 'member'),
  (current_setting('test.group_a')::uuid, '10000000-0000-0000-0000-000000000004', 'admin');
select throws_ok(
  $$insert into public.group_members (group_id, user_id, role) values (current_setting('test.group_a')::uuid, '10000000-0000-0000-0000-000000000003', 'member')$$,
  '23505',
  null,
  'duplicate membership falha'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.groups where id = current_setting('test.group_a')::uuid), 1, 'Member lê o grupo permitido');
select is((select count(*)::integer from public.players where id = current_setting('test.player_a')::uuid), 1, 'Member lê players permitidos');
select throws_ok(
  $$insert into public.players (group_id, name, skill_rating) values (current_setting('test.group_a')::uuid, 'Player do member', 3.0)$$,
  '42501',
  null,
  'Member não cria player'
);
update public.players set skill_rating = 1.0 where id = current_setting('test.player_a')::uuid;
select is((select skill_rating::text from public.players where id = current_setting('test.player_a')::uuid), '3.5', 'Member não edita player');
update public.group_members set role = 'admin' where group_id = current_setting('test.group_a')::uuid and user_id = auth.uid();
select is((select role::text from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = auth.uid()), 'member', 'Member não vira admin');
update public.group_members set role = 'owner' where group_id = current_setting('test.group_a')::uuid and user_id = auth.uid();
select is((select role::text from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = auth.uid()), 'member', 'Member não vira owner');
delete from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000004';

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select role::text from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = auth.uid()), 'admin', 'Member não altera memberships');
select lives_ok(
  $$insert into public.players (group_id, name, skill_rating) values (current_setting('test.group_a')::uuid, 'Criado pelo admin', 4.0)$$,
  'Admin cria player'
);
select set_config('test.player_admin', (select id::text from public.players where name = 'Criado pelo admin'), true);
update public.players set skill_rating = 4.5 where id = current_setting('test.player_admin')::uuid;
select is((select skill_rating::text from public.players where id = current_setting('test.player_admin')::uuid), '4.5', 'Admin edita player');

select throws_ok($$insert into public.matches (group_id, match_date, created_by)
  values (current_setting('test.group_a')::uuid, current_date, auth.uid())$$,
  '42501', null, 'Admin cria grafo somente via RPC');
-- Privileged local fixture; graph DML is no longer a client capability.
reset role;
insert into public.matches (group_id, name, match_date, team_count, created_by)
values (current_setting('test.group_a')::uuid, 'Jogo Admin', current_date, 2, auth.uid());
select set_config('test.match_a', (select id::text from public.matches where name = 'Jogo Admin'), true);
update public.matches set name = 'Jogo Admin editado' where id = current_setting('test.match_a')::uuid;
select is((select name from public.matches where id = current_setting('test.match_a')::uuid), 'Jogo Admin editado', 'fixture local de jogo preparada');
set local role authenticated;

delete from public.group_members where group_id = current_setting('test.group_a')::uuid and role = 'owner';
select is((select count(*)::integer from public.group_members where group_id = current_setting('test.group_a')::uuid and role = 'owner'), 1, 'Admin não remove owner');
update public.group_members set role = 'owner' where group_id = current_setting('test.group_a')::uuid and user_id = auth.uid();
select is((select role::text from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = auth.uid()), 'admin', 'Admin não transforma a si próprio em owner');
update public.group_members set role = 'owner' where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000003';
select is((select role::text from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000003'), 'member', 'Admin não transforma outro usuário em owner');
delete from public.groups where id = current_setting('test.group_a')::uuid;
select is((select count(*)::integer from public.groups where id = current_setting('test.group_a')::uuid), 1, 'Admin não exclui grupo');
select is((select count(*)::integer from public.groups where id = current_setting('test.group_b')::uuid), 0, 'Admin do Grupo A não lê Grupo B');
update public.groups set name = 'Admin cruzado' where id = current_setting('test.group_b')::uuid;
select throws_ok(
  $$insert into public.players (group_id, name, skill_rating) values (current_setting('test.group_b')::uuid, 'Admin cruzado', 3.0)$$,
  '42501',
  null,
  'Admin do Grupo A não cria player no Grupo B'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select name from public.groups where id = current_setting('test.group_b')::uuid), 'Grupo B', 'Admin do Grupo A não altera Grupo B');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.groups set name = 'Grupo A administrado' where id = current_setting('test.group_a')::uuid;
select is((select name from public.groups where id = current_setting('test.group_a')::uuid), 'Grupo A administrado', 'Owner edita o grupo');
delete from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000003';
select is((select count(*)::integer from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000003'), 0, 'Owner remove member');
insert into public.group_members (group_id, user_id, role)
values (current_setting('test.group_a')::uuid, '10000000-0000-0000-0000-000000000003', 'member');
update public.group_members set role = 'admin' where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000003';
select is((select role::text from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000003'), 'admin', 'Owner promove member a admin');
update public.group_members set role = 'member' where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000003';
select is((select role::text from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000003'), 'member', 'Owner rebaixa admin a member');
delete from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000004';
select is((select count(*)::integer from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000004'), 0, 'Owner remove admin');
insert into public.group_members (group_id, user_id, role)
values (current_setting('test.group_a')::uuid, '10000000-0000-0000-0000-000000000004', 'admin');
select is((select role::text from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = '10000000-0000-0000-0000-000000000004'), 'admin', 'Owner adiciona admin novamente');
delete from public.group_members where group_id = current_setting('test.group_a')::uuid and user_id = auth.uid();
select is((select count(*)::integer from public.group_members where group_id = current_setting('test.group_a')::uuid and role = 'owner'), 1, 'Owner não remove o próprio vínculo e mantém o grupo consistente');

select lives_ok(
  $$insert into public.players (group_id, name, skill_rating) values (current_setting('test.group_a')::uuid, 'Nível válido', 3.5)$$,
  'skill 3.5 funciona'
);
select throws_ok(
  $$insert into public.players (group_id, name, skill_rating) values (current_setting('test.group_a')::uuid, 'Nível inválido', 3.2)$$,
  '23514', null, 'skill 3.2 falha'
);
select throws_ok(
  $$insert into public.players (group_id, name, skill_rating) values (current_setting('test.group_a')::uuid, 'Nível baixo', 0.5)$$,
  '23514', null, 'skill menor que 1 falha'
);
select throws_ok(
  $$insert into public.players (group_id, name, skill_rating) values (current_setting('test.group_a')::uuid, 'Nível alto', 5.5)$$,
  '23514', null, 'skill maior que 5 falha'
);
-- Exercise constraints as postgres, independently of client permission denials.
reset role;
select throws_ok(
  $$insert into public.matches (group_id, name, match_date, team_count, created_by) values (current_setting('test.group_a')::uuid, 'Times inválidos', current_date, 4, auth.uid())$$,
  '23514', null, 'team_count inválido falha'
);

insert into public.match_players (
  group_id, match_id, player_id, attendance_status, player_name_snapshot,
  skill_rating_snapshot, is_goalkeeper_snapshot
)
values (
  current_setting('test.group_a')::uuid, current_setting('test.match_a')::uuid,
  current_setting('test.player_a')::uuid, 'present', 'Jogador A', 3.5, false
);
select throws_ok(
  $$insert into public.match_players (group_id, match_id, player_id, attendance_status, player_name_snapshot, skill_rating_snapshot, is_goalkeeper_snapshot) values (current_setting('test.group_a')::uuid, current_setting('test.match_a')::uuid, current_setting('test.player_b')::uuid, 'present', 'Jogador B', 3.5, false)$$,
  '23503', null, 'match_player de outro grupo falha'
);

insert into public.teams (group_id, match_id, team_index, name)
values
  (current_setting('test.group_a')::uuid, current_setting('test.match_a')::uuid, 1, 'Time A1'),
  (current_setting('test.group_a')::uuid, current_setting('test.match_a')::uuid, 2, 'Time A2');
select set_config('test.team_a1', (select id::text from public.teams where match_id = current_setting('test.match_a')::uuid and team_index = 1), true);
select set_config('test.team_a2', (select id::text from public.teams where match_id = current_setting('test.match_a')::uuid and team_index = 2), true);

insert into public.team_assignments (group_id, match_id, team_id, player_id)
values (current_setting('test.group_a')::uuid, current_setting('test.match_a')::uuid, current_setting('test.team_a1')::uuid, current_setting('test.player_a')::uuid);
select throws_ok(
  $$insert into public.team_assignments (group_id, match_id, team_id, player_id) values (current_setting('test.group_a')::uuid, current_setting('test.match_a')::uuid, current_setting('test.team_a2')::uuid, current_setting('test.player_a')::uuid)$$,
  '23505', null, 'jogador não aparece em dois times do mesmo match'
);
select throws_ok(
  $$insert into public.team_assignments (group_id, match_id, team_id, player_id) values (current_setting('test.group_a')::uuid, current_setting('test.match_a')::uuid, current_setting('test.team_a1')::uuid, current_setting('test.player_a')::uuid)$$,
  '23505', null, 'duplicate assignment falha'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
insert into public.matches (group_id, name, match_date, team_count, created_by)
values (current_setting('test.group_b')::uuid, 'Jogo B', current_date, 2, auth.uid());
select set_config('test.match_b', (select id::text from public.matches where name = 'Jogo B'), true);
insert into public.match_players (
  group_id, match_id, player_id, attendance_status, player_name_snapshot,
  skill_rating_snapshot, is_goalkeeper_snapshot
)
values (
  current_setting('test.group_b')::uuid, current_setting('test.match_b')::uuid,
  current_setting('test.player_b')::uuid, 'present', 'Jogador B', 3.5, false
);
insert into public.teams (group_id, match_id, team_index, name)
values (current_setting('test.group_b')::uuid, current_setting('test.match_b')::uuid, 1, 'Time B1');
select throws_ok(
  $$insert into public.team_assignments (group_id, match_id, team_id, player_id) values (current_setting('test.group_b')::uuid, current_setting('test.match_b')::uuid, current_setting('test.team_a1')::uuid, current_setting('test.player_b')::uuid)$$,
  '23503', null, 'team de Match A não pode ser atribuído a Match B'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$delete from public.players where id = current_setting('test.player_a')::uuid$$,
  '42501', null, 'cliente autenticado não apaga player histórico'
);
update public.players set active = false where id = current_setting('test.player_a')::uuid;
select is((select active from public.players where id = current_setting('test.player_a')::uuid), false, 'active=false funciona');

reset role;
select throws_ok(
  $$delete from public.players where id = current_setting('test.player_a')::uuid$$,
  '23503', null, 'FK impede apagar player historicamente referenciado até como postgres'
);
select throws_ok(
  $$delete from auth.users where id = '10000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'excluir usuário criador de grupo é bloqueado por RESTRICT'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.group_members (group_id, user_id, role)
values (current_setting('test.group_a')::uuid, '10000000-0000-0000-0000-000000000005', 'admin');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
reset role;
insert into public.matches (group_id, name, match_date, team_count, created_by)
values (current_setting('test.group_a')::uuid, 'Jogo E', current_date, 2, auth.uid());
select set_config('test.match_e', (select id::text from public.matches where name = 'Jogo E'), true);

reset role;
delete from auth.users where id = '10000000-0000-0000-0000-000000000005';
select ok(
  exists (select 1 from public.matches where id = current_setting('test.match_e')::uuid and created_by is null),
  'matches.created_by SET NULL preserva a partida ao excluir autor não criador do grupo'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$delete from public.matches where id = current_setting('test.match_a')::uuid$$,
  '42501', null, 'owner não exclui grafo diretamente');
reset role;
insert into public.draw_runs (group_id, match_id, run_number, seed, algorithm_version, accepted)
values (current_setting('test.group_a')::uuid, current_setting('test.match_a')::uuid, 1, 'seed-a', 'v1', true);
delete from public.matches where id = current_setting('test.match_a')::uuid;

reset role;
select ok(
  not exists (select 1 from public.matches where id = current_setting('test.match_a')::uuid)
  and not exists (select 1 from public.match_players where match_id = current_setting('test.match_a')::uuid)
  and not exists (select 1 from public.teams where match_id = current_setting('test.match_a')::uuid)
  and not exists (select 1 from public.team_assignments where match_id = current_setting('test.match_a')::uuid)
  and not exists (select 1 from public.draw_runs where match_id = current_setting('test.match_a')::uuid),
  'excluir match remove somente suas dependências'
);
select ok(exists (select 1 from public.matches where id = current_setting('test.match_b')::uuid), 'excluir Match A preserva Match B');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.group_c', public.create_group('Grupo C descartável', 5::smallint, 'futsal')::text, true);
insert into public.players (group_id, name, skill_rating)
values (current_setting('test.group_c')::uuid, 'Jogador C', 3.0);
select set_config('test.player_c', (select id::text from public.players where name = 'Jogador C'), true);
delete from public.groups where id = current_setting('test.group_c')::uuid;

reset role;
select ok(
  not exists (select 1 from public.groups where id = current_setting('test.group_c')::uuid)
  and not exists (select 1 from public.players where id = current_setting('test.player_c')::uuid),
  'excluir grupo remove seu próprio conjunto de dados'
);
select ok(
  exists (select 1 from public.groups where id = current_setting('test.group_a')::uuid)
  and exists (select 1 from public.groups where id = current_setting('test.group_b')::uuid),
  'excluir Grupo C preserva Grupos A e B'
);

select * from finish();
rollback;
