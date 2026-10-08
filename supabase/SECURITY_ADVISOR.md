# Security Advisor disposition

## Fase 8B — `public.save_match_draw(uuid, jsonb)` (validação LOCAL)

**Disposition:** fronteira SECURITY DEFINER intencional. Migration
`20260913081632_harden_save_match_draw.sql`, ainda não aplicada remotamente.

SECURITY INVOKER herdava os mesmos grants que permitiam ao cliente owner/admin
contornar a RPC e corromper partidas drawn. A nova fronteira executa somente
o salvamento transacional validado; authenticated conserva SELECT via RLS,
sem INSERT/UPDATE/DELETE de tabela ou coluna nas cinco tabelas do grafo.
As 14 policies de escrita foram removidas; as cinco SELECT foram preservadas.

Controles: owner explícito postgres; search_path=pg_catalog; relações, tipos e
funções qualificados; nenhum SQL dinâmico ou objeto temporário na RPC;
EXECUTE somente authenticated além do owner, sem PUBLIC/anon/service_role;
ator exclusivamente auth.uid(); membership owner/admin validada diretamente
com FOR SHARE até commit/rollback; created_by derivado do ator; payload rejeita
identidades/roles/status estranhos; advisory lock e comparação idempotente
preservados; colisões de outro ator/grupo rejeitadas genericamente antes da
reconstrução do grafo. Testes cobrem DML direto, abuso, isolamento, locks,
demotion/removal, retry, rollback e leitura.

`postgres` e `service_role` têm BYPASSRLS e privilégios de infraestrutura;
a garantia destina-se ao cliente normal authenticated. Nenhuma chave
privilegiada é usada no frontend. A autorização explícita é indispensável:
a função não depende da RLS para limitar suas escritas privilegiadas.

Advisors locais da CLI 2.117.0: nenhum WARN/ERROR, dois INFO unused_index
(`team_assignments_group_player_idx`, `team_assignments_participant_fk_idx`).
Índices preservados. A ausência local do finding 0029 não elimina a necessidade
de revisar sua eventual ocorrência remota: se identificar esta RPC, a
disposição é intencional sob os controles acima, e não motivo para reabrir DML.
[Finding 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
Não foram consultados advisors nem executado SQL no remoto nesta subetapa.

Teste de shadowing: tabelas/funções temporárias não substituem os objetos
qualificados. Um domínio temporário chamado uuid faz a implementação confiável
de auth.uid() rejeitar a chamada com 42P13; nenhum grafo é escrito. Esse caso
artificial é uma falha fechada, não uma identidade alternativa. A implementação
Auth do Supabase não foi alterada.

A disposição anterior de create_group e os registros remotos históricos abaixo
permanecem. A validação local desta fase não recertifica ACL/Auth remotos.

## `public.create_group(text, smallint, text)`

**Disposition:** accepted / intentional security finding.

`create_group` permanece `SECURITY DEFINER` porque cria um grupo e seu primeiro membership `owner` na mesma transação. A autorização normal das duas tabelas depende desse membership: a policy de `groups` só permite acesso a membros, enquanto a policy de `group_members` só permite inserções feitas por um owner já existente. No instante de criação, nenhum dos dois registros existe.

Converter a função para `SECURITY INVOKER` exigiria conceder `INSERT` direto em `groups` e criar exceções de bootstrap nas policies, ou ampliar as permissões de `group_members`. Isso aumentaria a superfície pública e criaria autorização circular/artificiosa apenas para eliminar o warning. A função privilegiada, pequena e transacional é a fronteira mais estreita.

A atomicidade é uma propriedade da transação, não de `SECURITY DEFINER`: uma RPC invoker também seria atômica. A elevação é necessária aqui para o INSERT/RETURNING do grupo sem grant/policy de INSERT e sem membership para SELECT, e para o INSERT do primeiro owner, que a policy normal deliberadamente proíbe. Uma alternativa baseada em `created_by = auth.uid()` poderia ser desenhada, mas abriria caminhos diretos de criação de grupos sem membership e exigiria novos controles para preservar o contrato atual. Não oferece o mesmo comportamento com RLS mais simples.

Controles verificados:

- `search_path` fixo em `pg_catalog`;
- referências a `public.groups` e `public.group_members` qualificadas;
- owner explícito `postgres`;
- `PUBLIC` e `anon` sem `EXECUTE`;
- somente `authenticated` recebe `EXECUTE` além do owner da função;
- identidade derivada exclusivamente de `auth.uid()`;
- assinatura sem parâmetro UUID ou outro identificador de usuário;
- validação de todos os valores controlados pelo cliente;
- falha em qualquer inserção reverte toda a chamada;
- `authenticated` não possui `INSERT` direto em `groups`;
- pgTAP cobre usuário anônimo, ownership automático, rollback e isolamento entre usuários/grupos.

## Proteção contra senhas vazadas

Em 2026-09-12, a consulta read-only da organização confirmou `plan: free`. A [documentação Supabase](https://supabase.com/docs/guides/auth/password-security) limita leaked-password protection a Pro e superiores. Finding conhecido e não bloqueante para o MVP. Nenhum upgrade, compra, billing ou configuração de Auth foi alterado.

## Evidência final — 2026-09-12

- Definição remota confere com a migration; ACL explícita `{postgres=X/postgres,authenticated=X/postgres}`.
- Security Advisor: dois WARN, `authenticated_security_definer_function_executable` (aceito intencionalmente) e `auth_leaked_password_protection` (limitação do Free); nenhum ERROR.
- Performance Advisor: 12 INFO de `unused_index`; nenhum WARN/ERROR. Índices de integridade e consultas foram preservados, pois ausência de uso neste estágio não comprova redundância.
- Cinco migrations idênticas nos arquivos, banco local e remoto: `20260911113852`, `20260911113856`, `20260911113900`, `20260911152916`, `20260911200324`.
- Nenhuma migration nova necessária; nenhuma escrita remota nesta fase.
- pgTAP: 118 verificações, incluindo falha da segunda inserção com rollback do grupo, identidade ausente, entradas inválidas e tentativa de criar owner diretamente.

Referências: [finding 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [funções e privilégios](https://supabase.com/docs/guides/database/functions), [unused index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
