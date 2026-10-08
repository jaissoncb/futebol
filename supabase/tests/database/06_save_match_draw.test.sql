begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Synthetic, transaction-scoped identities only. No real Auth data is used.
insert into auth.users (id, raw_user_meta_data) values
  ('70000000-0000-0000-0000-000000000001', '{}'),
  ('70000000-0000-0000-0000-000000000002', '{}'),
  ('70000000-0000-0000-0000-000000000003', '{}'),
  ('70000000-0000-0000-0000-000000000004', '{}');

select ok((select prosecdef from pg_proc where oid = 'public.save_match_draw(uuid,jsonb)'::regprocedure),
  'save_match_draw é SECURITY DEFINER');
select is((select pg_get_userbyid(proowner) from pg_proc where oid = 'public.save_match_draw(uuid,jsonb)'::regprocedure),
  'postgres', 'owner explícito controlado');
select ok((select proconfig @> array['search_path=pg_catalog'] from pg_proc
  where oid = 'public.save_match_draw(uuid,jsonb)'::regprocedure), 'search_path fixo');
select ok(has_function_privilege('authenticated', 'public.save_match_draw(uuid,jsonb)', 'execute'), 'authenticated executa RPC');
select ok(not has_function_privilege('anon', 'public.save_match_draw(uuid,jsonb)', 'execute'), 'anon não executa RPC');
select ok(not has_function_privilege('service_role', 'public.save_match_draw(uuid,jsonb)', 'execute'), 'service_role não executa RPC');
select ok(not exists (select 1 from pg_proc as p,
  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
  where p.oid = 'public.save_match_draw(uuid,jsonb)'::regprocedure and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  'PUBLIC não executa RPC');
select ok(not has_column_privilege('authenticated', 'public.matches', 'id', 'insert'), 'sem INSERT id direto');
select ok(not has_column_privilege('anon', 'public.matches', 'id', 'insert'), 'anon não insere id');
select ok(not has_column_privilege('authenticated', 'public.matches', 'id', 'update'), 'id continua imutável');
select ok(not has_column_privilege('authenticated', 'public.matches', 'created_by', 'update'), 'creator continua imutável');
select ok(not has_column_privilege('authenticated', 'public.matches', 'created_at', 'insert'), 'sem grant adicional de timestamps');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.phase7_group', public.create_group('Grupo RPC local')::text, true);
insert into public.group_members (group_id, user_id, role) values
  (current_setting('test.phase7_group')::uuid, '70000000-0000-0000-0000-000000000002', 'admin'),
  (current_setting('test.phase7_group')::uuid, '70000000-0000-0000-0000-000000000003', 'member');
reset role;

-- Stable UUIDs make all mutation/rollback assertions reproducible.
insert into public.players (id, group_id, name, nickname, skill_rating, is_goalkeeper, preferred_position) values
  ('71000000-0000-0000-0000-000000000001', current_setting('test.phase7_group')::uuid, 'Goleiro Um', 'G1', 3.5, true, 'goalkeeper'),
  ('71000000-0000-0000-0000-000000000002', current_setting('test.phase7_group')::uuid, 'Jogador Dois', 'J2', 4, false, 'attack'),
  ('71000000-0000-0000-0000-000000000003', current_setting('test.phase7_group')::uuid, 'Goleiro Três', null, 2.5, true, 'goalkeeper'),
  ('71000000-0000-0000-0000-000000000004', current_setting('test.phase7_group')::uuid, 'Jogador Quatro', null, 3, false, null);

select set_config('test.phase7_payload', jsonb_build_object(
  'group_id', current_setting('test.phase7_group')::uuid,
  'name', 'Partida RPC', 'match_date', '2026-09-12', 'match_time', '20:00',
  'team_count', 2, 'players_on_court', 1,
  'participants', (select jsonb_agg(jsonb_build_object(
    'player_id', p.id, 'player_name_snapshot', p.name, 'player_nickname_snapshot', p.nickname,
    'skill_rating_snapshot', p.skill_rating, 'is_goalkeeper_snapshot', p.is_goalkeeper,
    'preferred_position_snapshot', p.preferred_position) order by p.id)
    from public.players as p where p.group_id = current_setting('test.phase7_group')::uuid),
  'teams', '[{"team_index":1,"name":"Azul","color":"blue"},{"team_index":2,"name":"Vermelho","color":"red"}]'::jsonb,
  'assignments', '[
    {"player_id":"71000000-0000-0000-0000-000000000001","team_index":1,"starts_as_reserve":false,"assignment_source":"draw"},
    {"player_id":"71000000-0000-0000-0000-000000000002","team_index":2,"starts_as_reserve":true,"assignment_source":"manual"},
    {"player_id":"71000000-0000-0000-0000-000000000003","team_index":2,"starts_as_reserve":false,"assignment_source":"draw"},
    {"player_id":"71000000-0000-0000-0000-000000000004","team_index":1,"starts_as_reserve":true,"assignment_source":"manual"}
  ]'::jsonb,
  'draw_runs', '[
    {"run_number":1,"seed":"seed-A","algorithm_version":"balanced-candidates-v1","balance_score":0.25,"accepted":false},
    {"run_number":2,"seed":"seed-B","algorithm_version":"balanced-candidates-v1","balance_score":0.5,"accepted":false},
    {"run_number":3,"seed":"seed-C","algorithm_version":"balanced-candidates-v1","balance_score":0.333333,"accepted":true}
  ]'::jsonb
)::text, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.save_match_draw('72000000-0000-0000-0000-000000000001', current_setting('test.phase7_payload')::jsonb),
  '72000000-0000-0000-0000-000000000001'::uuid, 'owner salva');
select is((select status::text from public.matches where id = '72000000-0000-0000-0000-000000000001'), 'drawn', 'somente drawn ao concluir');
select ok(exists (select 1 from public.matches where id = '72000000-0000-0000-0000-000000000001'
  and group_id = current_setting('test.phase7_group')::uuid and name = 'Partida RPC'
  and match_date = '2026-09-12'::date and match_time = '20:00'::time
  and team_count = 2 and players_on_court = 1 and created_by = auth.uid()), 'configuração e creator corretos');
select is((select count(*)::integer from public.match_players where match_id = '72000000-0000-0000-0000-000000000001' and attendance_status = 'present'), 4, 'todos participantes presentes');
select is((select count(*)::integer from public.teams where match_id = '72000000-0000-0000-0000-000000000001'), 2, 'dois times');
select is((select count(*)::integer from public.team_assignments where match_id = '72000000-0000-0000-0000-000000000001'), 4, 'quatro assignments');
select is((select count(*)::integer from public.team_assignments where match_id = '72000000-0000-0000-0000-000000000001' and starts_as_reserve), 2, 'reservas persistidas');
select is((select count(*)::integer from public.team_assignments where match_id = '72000000-0000-0000-0000-000000000001' and assignment_source = 'manual'), 2, 'origem manual preservada');
select ok(exists (select 1 from public.team_assignments as a join public.teams as t on t.id = a.team_id
  where a.match_id = '72000000-0000-0000-0000-000000000001'
  and a.player_id = '71000000-0000-0000-0000-000000000002' and t.team_index = 2
  and a.starts_as_reserve and a.assignment_source = 'manual'), 'escalação final após troca manual');
select is((select jsonb_agg(jsonb_build_array(run_number, seed, algorithm_version, balance_score, accepted) order by run_number)
  from public.draw_runs where match_id = '72000000-0000-0000-0000-000000000001'),
  '[[1,"seed-A","balanced-candidates-v1",0.250,false],[2,"seed-B","balanced-candidates-v1",0.500,false],[3,"seed-C","balanced-candidates-v1",0.333,true]]'::jsonb,
  'todos rerolls em ordem, seed/versão/score preservados na precisão do schema');
select is((select count(*)::integer from public.draw_runs where match_id = '72000000-0000-0000-0000-000000000001' and accepted), 1, 'um accepted');

-- Original failure case: discard the return value as if the response was lost.
select lives_ok($$do $retry$ begin
  perform public.save_match_draw('72000000-0000-0000-0000-000000000002', current_setting('test.phase7_payload')::jsonb);
end $retry$;$$, 'primeira resposta descartada pelo cliente simulado');
select is(public.save_match_draw('72000000-0000-0000-0000-000000000002', current_setting('test.phase7_payload')::jsonb),
  '72000000-0000-0000-0000-000000000002'::uuid, 'retry após resposta perdida');
select ok(
  (select count(*) from public.matches where id = '72000000-0000-0000-0000-000000000002') = 1
  and (select count(*) from public.match_players where match_id = '72000000-0000-0000-0000-000000000002') = 4
  and (select count(*) from public.teams where match_id = '72000000-0000-0000-0000-000000000002') = 2
  and (select count(*) from public.team_assignments where match_id = '72000000-0000-0000-0000-000000000002') = 4
  and (select count(*) from public.draw_runs where match_id = '72000000-0000-0000-0000-000000000002') = 3,
  'retry não duplica nenhuma entidade');

-- Logical equivalence: reorder every array, normalize time/name, numeric precision.
select set_config('test.phase7_reordered', (
  select jsonb_set(jsonb_set(jsonb_set(current_setting('test.phase7_payload')::jsonb,
      '{name}', '"  Partida RPC  "'), '{match_time}', '"20:00:00"'), '{draw_runs,2,balance_score}', '0.333')
    || jsonb_object_agg(section, reversed)
  from (select section, (select jsonb_agg(value order by ord desc)
    from jsonb_array_elements(current_setting('test.phase7_payload')::jsonb -> section)
      with ordinality as entries(value, ord)) as reversed
    from unnest(array['participants','teams','assignments']) as sections(section)) as reversed_arrays
)::text, true);
select is(public.save_match_draw('72000000-0000-0000-0000-000000000002', current_setting('test.phase7_reordered')::jsonb),
  '72000000-0000-0000-0000-000000000002'::uuid, 'ordem irrelevante e formatos equivalentes não geram conflito');
select is(public.save_match_draw('72000000-0000-0000-0000-000000000002', jsonb_set(current_setting('test.phase7_payload')::jsonb,
  '{draw_runs}', (select jsonb_agg(value order by ord desc) from jsonb_array_elements(current_setting('test.phase7_payload')::jsonb -> 'draw_runs')
    with ordinality as entries(value, ord)))), '72000000-0000-0000-0000-000000000002'::uuid, 'run_number determina ordem, não posição no JSON');

select throws_ok($$select public.save_match_draw('72000000-0000-0000-0000-000000000002',
  jsonb_set(current_setting('test.phase7_payload')::jsonb, '{name}', '"Outro nome"'))$$,
  '22023', 'match id conflicts with existing content', 'conteúdo divergente nunca sobrescreve');
select is((select name from public.matches where id = '72000000-0000-0000-0000-000000000002'), 'Partida RPC', 'conflito preserva conteúdo original');
select is(public.save_match_draw('72000000-0000-0000-0000-000000000002',
  current_setting('test.phase7_payload')::jsonb #- '{participants,2,player_nickname_snapshot}'
    #- '{participants,3,player_nickname_snapshot}' #- '{participants,3,preferred_position_snapshot}'),
  '72000000-0000-0000-0000-000000000002'::uuid, 'opcionais omitidos equivalem a null');
select throws_ok(format('select public.save_match_draw(%L::uuid,%L::jsonb)',
  '72000000-0000-0000-0000-000000000002', candidate), '22023', 'match id conflicts with existing content', label)
from (values
  ('snapshot divergente', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{participants,0,player_name_snapshot}', '"Outro nome"')),
  ('nível divergente', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{participants,0,skill_rating_snapshot}', '4')),
  ('time divergente', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{teams,0,name}', '"Verde"')),
  ('origem divergente', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{assignments,0,assignment_source}', '"manual"')),
  ('seed divergente', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,2,seed}', '"outro-seed"')),
  ('versão divergente', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,2,algorithm_version}', '"v2"')),
  ('score divergente', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,2,balance_score}', '0.444'))
) as cases(label, candidate);

update public.players set name = 'Nome Atual', nickname = null, skill_rating = 1,
  is_goalkeeper = false, preferred_position = 'defense', active = false
  where id = '71000000-0000-0000-0000-000000000001';
select ok(exists (select 1 from public.match_players where match_id = '72000000-0000-0000-0000-000000000001'
  and player_id = '71000000-0000-0000-0000-000000000001' and player_name_snapshot = 'Goleiro Um'
  and player_nickname_snapshot = 'G1' and skill_rating_snapshot = 3.5 and is_goalkeeper_snapshot
  and preferred_position_snapshot = 'goalkeeper'), 'cadastro alterado não reescreve snapshots');
select is(public.save_match_draw('72000000-0000-0000-0000-000000000001', current_setting('test.phase7_payload')::jsonb),
  '72000000-0000-0000-0000-000000000001'::uuid, 'retry compara snapshots salvos, não cadastro atual');

select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.save_match_draw('72000000-0000-0000-0000-000000000003', current_setting('test.phase7_payload')::jsonb),
  '72000000-0000-0000-0000-000000000003'::uuid, 'admin salva');
select is((select created_by from public.matches where id = '72000000-0000-0000-0000-000000000003'), auth.uid(), 'creator deriva da identidade real do admin');
select throws_ok($$select public.save_match_draw('72000000-0000-0000-0000-000000000001', current_setting('test.phase7_payload')::jsonb)$$,
  '40001', 'match id unavailable; retry in a fresh transaction', 'admin não toma chave idempotente criada por outro actor');

select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.matches where group_id = current_setting('test.phase7_group')::uuid and status = 'drawn'), 3, 'member lê partidas finais do grupo');
select is((select count(*)::integer from public.match_players where match_id = '72000000-0000-0000-0000-000000000001'), 4, 'member lê detalhe e snapshots');
select throws_ok($$select public.save_match_draw('72000000-0000-0000-0000-000000000004', current_setting('test.phase7_payload')::jsonb)$$,
  '42501', null, 'member não salva');
select throws_ok($$insert into public.matches (id, group_id, match_date, created_by)
  values ('72000000-0000-0000-0000-000000000004', current_setting('test.phase7_group')::uuid, current_date, auth.uid())$$,
  '42501', null, 'grant de id não permite INSERT direto por member');
select throws_ok($$update public.matches set status = 'draft' where id = '72000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'member não altera status diretamente');
select is((select status::text from public.matches where id = '72000000-0000-0000-0000-000000000001'), 'drawn', 'member não altera status');
select throws_ok($$update public.draw_runs set accepted = false where match_id = '72000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'member não altera aceite diretamente');
select is((select count(*)::integer from public.draw_runs where match_id = '72000000-0000-0000-0000-000000000001' and accepted), 1, 'member não altera aceite');
select throws_ok($$delete from public.matches where id = '72000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'member não exclui diretamente');
select is((select count(*)::integer from public.matches where id = '72000000-0000-0000-0000-000000000001'), 1, 'member não exclui');

select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.matches where group_id = current_setting('test.phase7_group')::uuid), 0, 'outsider não lê histórico');
select throws_ok($$select public.save_match_draw('72000000-0000-0000-0000-000000000004', current_setting('test.phase7_payload')::jsonb)$$,
  '42501', null, 'outsider não salva conhecendo UUID');
select set_config('test.phase7_other_group', public.create_group('Outro Grupo RPC')::text, true);
select throws_ok($$select public.save_match_draw('72000000-0000-0000-0000-000000000004',
  jsonb_set(current_setting('test.phase7_payload')::jsonb, '{group_id}', to_jsonb(current_setting('test.phase7_other_group')::uuid)))$$,
  '23503', null, 'owner de outro grupo não cruza participantes por UUID');
reset role;
select ok(not exists (select 1 from public.matches where id = '72000000-0000-0000-0000-000000000004'), 'FK cross-group faz rollback até do draft inicial');

set local role anon;
select throws_ok($$select public.save_match_draw('72000000-0000-0000-0000-000000000004', '{}'::jsonb)$$, '42501', null, 'anon bloqueado pela ACL');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.save_match_draw('72000000-0000-0000-0000-000000000004', current_setting('test.phase7_payload')::jsonb)$$,
  '42501', null, 'authenticated sem auth.uid bloqueado');
select set_config('request.jwt.claims', '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Every invalid call uses the same still-unused UUID; none can leave a draft.
select throws_ok(format('select public.save_match_draw(%L::uuid,%L::jsonb)',
  '72000000-0000-0000-0000-000000000004', candidate), expected_code, null, label)
from (values
  ('payload nulo', 'null'::jsonb, '22023'),
  ('snapshot obrigatório ausente', current_setting('test.phase7_payload')::jsonb #- '{participants,0,skill_rating_snapshot}', '22023'),
  ('snapshot obrigatório nulo', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{participants,0,is_goalkeeper_snapshot}', 'null'), '22023'),
  ('booleano deve ser booleano JSON', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{assignments,0,starts_as_reserve}', '"false"'), '22023'),
  ('creator não é campo de entrada', current_setting('test.phase7_payload')::jsonb || '{"created_by":"70000000-0000-0000-0000-000000000004"}', '22023'),
  ('user_id não é campo de entrada', current_setting('test.phase7_payload')::jsonb || '{"user_id":"70000000-0000-0000-0000-000000000004"}', '22023'),
  ('owner_id não é campo de entrada', current_setting('test.phase7_payload')::jsonb || '{"owner_id":"70000000-0000-0000-0000-000000000004"}', '22023'),
  ('role não é campo de entrada', current_setting('test.phase7_payload')::jsonb || '{"role":"owner"}', '22023'),
  ('status não é campo de entrada', current_setting('test.phase7_payload')::jsonb || '{"status":"completed"}', '22023'),
  ('filhos não podem declarar outro match', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,0,match_id}', '"72000000-0000-0000-0000-000000000001"'), '22023'),
  ('participante duplicado', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{participants,1,player_id}', '"71000000-0000-0000-0000-000000000001"'), '22023'),
  ('participante perdido', current_setting('test.phase7_payload')::jsonb #- '{assignments,3}', '22023'),
  ('assignment duplicado', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{assignments,3,player_id}', '"71000000-0000-0000-0000-000000000001"'), '22023'),
  ('assignment externo', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{assignments,3,player_id}', '"71000000-0000-0000-0000-000000000005"'), '22023'),
  ('time_count inconsistente', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{team_count}', '3'), '22023'),
  ('time_index inválido', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{teams,0,team_index}', '3'), '22023'),
  ('time_index duplicado', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{teams,1,team_index}', '1'), '22023'),
  ('assignment time externo', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{assignments,0,team_index}', '3'), '22023'),
  ('reserva deixa quadra incompleta', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{players_on_court}', '2'), '22023'),
  ('goleiro fora da quadra', jsonb_set(jsonb_set(current_setting('test.phase7_payload')::jsonb, '{assignments,0,starts_as_reserve}', 'true'), '{assignments,3,starts_as_reserve}', 'false'), '22023'),
  ('tamanhos inválidos', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{assignments,1,team_index}', '1'), '22023'),
  ('concentração de goleiros', jsonb_set(jsonb_set(jsonb_set(jsonb_set(current_setting('test.phase7_payload')::jsonb,
      '{assignments,2,team_index}', '1'), '{assignments,3,team_index}', '2'),
      '{assignments,2,starts_as_reserve}', 'true'), '{assignments,1,starts_as_reserve}', 'false'), '22023'),
  ('run_number duplicado', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,1,run_number}', '1'), '22023'),
  ('run_number com lacuna', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,1,run_number}', '4'), '22023'),
  ('dois accepted', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,0,accepted}', 'true'), '22023'),
  ('nenhum accepted', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,2,accepted}', 'false'), '22023'),
  ('accepted deve ser final', jsonb_set(jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,0,accepted}', 'true'), '{draw_runs,2,accepted}', 'false'), '22023'),
  ('skill constraint mantida', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{participants,0,skill_rating_snapshot}', '3.2'), '23514'),
  ('skill não pode ser arredondada para parecer válida', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{participants,0,skill_rating_snapshot}', '3.04'), '23514'),
  ('seed constraint mantida', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,2,seed}', '" "'), '23514'),
  ('algorithm constraint mantida', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,2,algorithm_version}', '" "'), '23514'),
  ('score constraint mantida', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,2,balance_score}', '-1'), '23514'),
  ('score negativo não pode arredondar para zero', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{draw_runs,2,balance_score}', '-0.00001'), '23514'),
  ('config constraint mantida', jsonb_set(current_setting('test.phase7_payload')::jsonb, '{name}', '"x"'), '23514')
) as cases(label, candidate, expected_code);
reset role;
select ok(not exists (select 1 from public.matches where id = '72000000-0000-0000-0000-000000000004')
  and not exists (select 1 from public.match_players where match_id = '72000000-0000-0000-0000-000000000004')
  and not exists (select 1 from public.teams where match_id = '72000000-0000-0000-0000-000000000004')
  and not exists (select 1 from public.team_assignments where match_id = '72000000-0000-0000-0000-000000000004')
  and not exists (select 1 from public.draw_runs where match_id = '72000000-0000-0000-0000-000000000004'), 'todas falhas de validação/constraints fazem rollback completo');

-- Late failure injection covers writes beyond the initial match INSERT.
create function pg_temp.phase7_reject_write() returns trigger language plpgsql as $$
begin
  raise exception 'local test failure' using errcode = '23514';
end;
$$;
create function pg_temp.phase7_rollback_case(target_table text, trigger_event text) returns setof text
language plpgsql as $$
begin
  execute format('create trigger phase7_fail %s on public.%I for each row execute function pg_temp.phase7_reject_write()', trigger_event, target_table);
  set local role authenticated;
  return next throws_ok($q$select public.save_match_draw('72000000-0000-0000-0000-000000000005', current_setting('test.phase7_payload')::jsonb)$q$,
    '23514', null, 'falha injetada: ' || target_table || ' ' || trigger_event);
  reset role;
  return next ok(
    not exists (select 1 from public.matches where id = '72000000-0000-0000-0000-000000000005')
    and not exists (select 1 from public.match_players where match_id = '72000000-0000-0000-0000-000000000005')
    and not exists (select 1 from public.teams where match_id = '72000000-0000-0000-0000-000000000005')
    and not exists (select 1 from public.team_assignments where match_id = '72000000-0000-0000-0000-000000000005')
    and not exists (select 1 from public.draw_runs where match_id = '72000000-0000-0000-0000-000000000005'),
    'rollback completo: ' || target_table || ' ' || trigger_event);
  execute format('drop trigger phase7_fail on public.%I', target_table);
end;
$$;
select * from pg_temp.phase7_rollback_case('matches', 'before insert');
select * from pg_temp.phase7_rollback_case('match_players', 'before insert');
select * from pg_temp.phase7_rollback_case('teams', 'before insert');
select * from pg_temp.phase7_rollback_case('team_assignments', 'before insert');
select * from pg_temp.phase7_rollback_case('draw_runs', 'before insert');
select * from pg_temp.phase7_rollback_case('matches', 'before update');

set local role authenticated;
-- Valid incomplete three-team lineup with fewer keepers than teams.
select set_config('test.phase7_three_teams', jsonb_set(jsonb_set(jsonb_set(jsonb_set(
  current_setting('test.phase7_payload')::jsonb, '{team_count}', '3'),
  '{teams}', current_setting('test.phase7_payload')::jsonb -> 'teams' || '[{"team_index":3,"name":"Verde"}]'::jsonb),
  '{assignments,1,team_index}', '3'), '{assignments,1,starts_as_reserve}', 'false')::text, true);
select lives_ok($$select public.save_match_draw('72000000-0000-0000-0000-000000000006', current_setting('test.phase7_three_teams')::jsonb)$$,
  'três times incompletos e goleiros insuficientes são válidos');
select is((select count(*)::integer from public.team_assignments where match_id = '72000000-0000-0000-0000-000000000006'), 4, 'nenhum jogador fictício no time incompleto');
select lives_ok($$select public.save_match_draw('72000000-0000-0000-0000-000000000007',
  jsonb_set(jsonb_set(current_setting('test.phase7_payload')::jsonb,
    '{participants,0,is_goalkeeper_snapshot}', 'false'), '{participants,2,is_goalkeeper_snapshot}', 'false'))$$,
  'sem goleiros é válido');
select lives_ok($$select public.save_match_draw('72000000-0000-0000-0000-000000000008',
  jsonb_set(jsonb_set(current_setting('test.phase7_payload')::jsonb,
    '{participants,1,is_goalkeeper_snapshot}', 'true'), '{participants,3,is_goalkeeper_snapshot}', 'true'))$$,
  'todos goleiros, incluindo reservas, é válido');
reset role;

select * from finish();
rollback;
