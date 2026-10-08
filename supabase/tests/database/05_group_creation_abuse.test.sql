begin;
select no_plan();

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.create_group('Sem identidade')$$, '42501', null,
  'role authenticated sem auth.uid nao cria grupo');
reset role;

insert into auth.users (id, raw_user_meta_data)
values ('20000000-0000-0000-0000-000000000001', '{}');

-- Simula falha na segunda escrita para comprovar rollback, exclusivamente local.
create function pg_temp.reject_membership() returns trigger language plpgsql as $$
begin
  raise exception 'test membership rejected' using errcode = '23514';
end;
$$;
create trigger test_reject_membership before insert on public.group_members
for each row execute function pg_temp.reject_membership();

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.create_group('Atomic rollback probe')$$, '23514', null,
  'falha do membership propaga pela RPC');
reset role;
select is((select count(*)::integer from public.groups where name = 'Atomic rollback probe'), 0,
  'falha da segunda escrita nao deixa grupo orfao');
drop trigger test_reject_membership on public.group_members;

set local role authenticated;
select throws_ok($$select public.create_group(null)$$, '23502', null, 'nome nulo rejeitado por NOT NULL');
select throws_ok($$select public.create_group('Teste', 0::smallint)$$, '22023', null, 'quantidade invalida rejeitada');
select throws_ok($$select public.create_group('Teste', 5::smallint, ' ')$$, '22023', null, 'esporte vazio rejeitado');
select set_config('test.created', public.create_group('Valid abuse probe')::text, true);
select throws_ok($$insert into public.group_members (group_id, user_id, role)
values (current_setting('test.created')::uuid, auth.uid(), 'owner')$$,
  '42501', null, 'cliente nao cria membership owner diretamente');
select * from finish();
rollback;
