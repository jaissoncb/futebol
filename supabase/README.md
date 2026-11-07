# Supabase Futebol — arquivo histórico encerrado

O projeto Supabase Futebol Brasil (`tfnjbhstfiuqvenofvdb`) foi excluído
definitivamente, conforme confirmação do usuário no painel e na conta. O Futebol
antigo foi substituído por GitHub Pages + Sabará ID/Kinde + Neon PostgreSQL + Neon
Functions. Operação atual: [OPERATIONS.md](../deployment/OPERATIONS.md).

Esta pasta preserva somente migrations, testes SQL, auditorias e decisões de
segurança como evidência histórica. Não integra o build, o CI ou a implantação
atual. A migration `20261005165705_keepalive.sql` registra a função antiga; não é
uma automação em execução. Não há workflow keep-alive ativo no repositório.

Configuração CLI, seed e runners executáveis antigos foram retirados. Não aplicar
este SQL ao Neon, não recriar o projeto nem restaurar o antigo ambiente local.
O histórico Git preserva a implementação completa para consulta. Os bancos Neon
existentes usam `database/`, com identidade e permissões próprias.

## Decisões de integridade da implementação antiga

- `create_group` cria o grupo e o membership `owner` na mesma transação, sempre a partir de `auth.uid()`.
- Helpers RLS ficam no schema não exposto `private`, têm `search_path` fixo e evitam consultar `group_members` por uma policy recursiva.
- Nome, apelido, nível, posição e indicador de goleiro são copiados para `match_players`; alterações futuras no cadastro não reescrevem o histórico.
- `group_id` foi repetido nas tabelas filhas de partidas para permitir foreign keys compostas que impeçam cruzar UUIDs de grupos ou jogos diferentes.
- Um usuário que ainda possui um grupo como criador não pode ser removido de `auth.users`; o grupo deve ser transferido ou removido conscientemente. Memberships de outros usuários acompanham a exclusão da conta.
- Excluir um grupo remove seus dados dependentes. Excluir uma partida remove participantes, times, atribuições e sorteios daquela partida. O autor de uma partida pode ficar nulo para preservar o histórico.
- Jogadores não recebem grant de `DELETE`; devem ser desativados com `active = false`. Referências históricas também impedem a exclusão direta.
- `draw_runs` não recebe grant de `DELETE`, e apenas `accepted` pode ser atualizado pelo cliente após a inserção.
- `anon` e `PUBLIC` não recebem acesso às tabelas nem à RPC. Não existe endpoint público de presença nesta fase.
