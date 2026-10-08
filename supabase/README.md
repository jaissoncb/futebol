# Supabase local do Futebol

Esta pasta contém migrations, políticas RLS, grants, testes e auditorias da aplicação Futebol. O identificador Docker local é `futebol`; o projeto Supabase remoto existente continua sendo a referência de produção, mas nenhum estado local de vínculo é versionado ou copiado entre workspaces.

## Validação local

Com Node.js 22+, Docker local e a CLI oficial, consulte primeiro a versão e a ajuda dos comandos antes de iniciar o ambiente:

```powershell
pnpm dlx supabase@2.117.0 --version
pnpm dlx supabase@2.117.0 --help
pnpm dlx supabase@2.117.0 db --help
pnpm dlx supabase@2.117.0 test --help
pnpm dlx supabase@2.117.0 start
pnpm dlx supabase@2.117.0 db reset --local
pnpm dlx supabase@2.117.0 test db --local supabase/tests/database
```

O `db reset --local` prova que as migrations constroem o banco do zero. Os testes pgTAP verificam o contrato, grants, criação atômica e isolamento RLS.

Depois do reset e dos testes pgTAP:

```powershell
node supabase/tests/audit-phase8-integrity.mjs
node supabase/tests/hardening-upgrade.mjs
node supabase/tests/save-match-draw-concurrency.mjs
node scripts/test-draw-contract.mjs
pnpm test:e2e
```

Não execute `supabase link`, `supabase db push` ou qualquer comando remoto sem autorização explícita. Os testes locais usam somente o container `supabase_db_futebol` e revertem suas fixtures.

## Decisões de integridade

- `create_group` cria o grupo e o membership `owner` na mesma transação, sempre a partir de `auth.uid()`.
- Helpers RLS ficam no schema não exposto `private`, têm `search_path` fixo e evitam consultar `group_members` por uma policy recursiva.
- Nome, apelido, nível, posição e indicador de goleiro são copiados para `match_players`; alterações futuras no cadastro não reescrevem o histórico.
- `group_id` foi repetido nas tabelas filhas de partidas para permitir foreign keys compostas que impeçam cruzar UUIDs de grupos ou jogos diferentes.
- Um usuário que ainda possui um grupo como criador não pode ser removido de `auth.users`; o grupo deve ser transferido ou removido conscientemente. Memberships de outros usuários acompanham a exclusão da conta.
- Excluir um grupo remove seus dados dependentes. Excluir uma partida remove participantes, times, atribuições e sorteios daquela partida. O autor de uma partida pode ficar nulo para preservar o histórico.
- Jogadores não recebem grant de `DELETE`; devem ser desativados com `active = false`. Referências históricas também impedem a exclusão direta.
- `draw_runs` não recebe grant de `DELETE`, e apenas `accepted` pode ser atualizado pelo cliente após a inserção.
- `anon` e `PUBLIC` não recebem acesso às tabelas nem à RPC. Não existe endpoint público de presença nesta fase.
