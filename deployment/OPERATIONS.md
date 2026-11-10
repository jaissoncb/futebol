# Futebol — operação vigente

Frontend publicado em 07/11/2026 e auditado em 08/11/2026 no SHA
`7b314022eced7eab1e9f48bdf01c87da5b62a46d`, versão nominal `0.1.0`,
run Pages `42366705868`; evidências e digests em [RELEASE.md](RELEASE.md).
A Fase 3A não publica alterações. A revisão efetivamente implantada da Function
não foi obtida independentemente; o SHA do frontend não a certifica.
Frontend em GitHub Pages; Sabará ID/Kinde para identidade;
API em Neon Functions; dados em Neon PostgreSQL. Nenhum serviço novo é necessário.

## Ambientes

| Item | DEV | PRD |
| --- | --- | --- |
| Frontend | `http://localhost:5173/` | `https://futebol.sabara.org/` |
| Configuração pública | `frontend-dev.json` | `frontend-prd.json` |
| Build | `pnpm build:dev` → `dist-dev/` | `pnpm build` → `dist/` |
| Identidade | Kinde Test, cliente/audience DEV | `https://login.sabara.org`, cliente/audience PRD |
| API | Function `futebolapi` DEV existente | Function `futebolapi` PRD existente |
| Metadados da API | `neon-dev.runtime-config.json` (registro com placeholder de role) | `neon-prd.runtime-config.json` |
| Banco | Neon DEV preservado | `futebol_prd`, branch `production`, Frankfurt/PG17 |

Os JSONs públicos definem URLs, client IDs e audiences exatos; não trocar valores
entre ambientes. O registro runtime DEV não deve ser enviado como configuração
executável. Os wrappers `neon-functions-dev-*` e candidatos DEV têm alvo fixo DEV.
O frontend usa `/`, HashRouter e callbacks na origem exata. Nunca usar `/futebol/`.
Para trabalho local, Node compatível com `.nvmrc` e pnpm 11.19.0; a API implantada
usa Node 24. Dependências e lockfile devem permanecer em versões exatas.

Com as dependências instaladas, `pnpm dev` oferece recarga e `pnpm preview:dev`
serve o build DEV. Login e API usam os serviços DEV existentes e precisam de rede.
`dev:diagnostics`/`build:diagnostics` são ferramentas explícitas para a API local;
nunca publicar `dist-diagnostics/`. Não repetir suites de banco vazio em DEV/PRD.

## Configuração e credenciais

O frontend recebe somente metadados públicos dos JSONs. Vite não carrega `.env`
nem expõe variáveis `VITE_*`. Não há secret Kinde, senha, token ou DSN no frontend.
Callback, logout, issuer, audience e cliente precisam corresponder ao ambiente;
a configuração de identidade em funcionamento deve ser preservada.

A Function PRD existente usa apenas:

| Nome | Conteúdo e local |
| --- | --- |
| `FUTEBOL_RUNTIME_CONFIG` | Configuração da API do ambiente, validada por `api/runtime-config.ts` |
| `DATABASE_URL` | DSN pooled do login runtime restrito, no armazenamento de secrets Neon |
| `DATABASE_URL_UNPOOLED` | DSN direto do mesmo login restrito, no armazenamento de secrets Neon |

Nunca usar credencial administrativa como runtime. PRD usa
`futebol_api_prd_functions`, com TLS verificado, grants explícitos e RLS.
As migrations `database/001` a `005` já foram aplicadas; não repetir.
Segredos não pertencem a JSON versionado, `.env`, argumentos, logs, commits ou chat.
Tokens do navegador ficam em memória; a transação OAuth temporária tem namespace
Futebol e TTL. Não há cache de dados privados no service worker.

A preferência de grupo contém somente IDs internos de usuário/grupo em
`sessionStorage` por aba, sempre validada contra o workspace autenticado e
limpa no logout local ou comunicado por outra aba. Outro usuário não reutiliza
a preferência anterior. Storage indisponível não impede a seleção em memória.
A preferência não concede acesso nem armazena tokens, jogadores ou rascunhos.
Logout remove o conteúdo privado da interface; a política do MVP aceita a janela
residual de validade de Bearer emitido, sem promessa de revogação imediata.

Rascunhos pedem confirmação ao trocar de grupo/sair e aviso nativo na recarga.
Cancelar mantém os dados na tela; não há persistência do rascunho. Abrir histórico
mantém a partida montada. Salvamento incerto permanece congelado, com UUID e
payload estáveis; abandonar a tentativa continua exigindo confirmação específica.
O histórico oferece cópia direta com feedback, além do compartilhamento nativo.
Cancelamento do compartilhamento não aciona cópia silenciosa.

O operador PRD já existente (`scripts/neon-prd-release.ps1`/`.mjs`) recebe uma
chave temporária Project-scoped exclusivamente Futebol PRD por entrada oculta;
credenciais são tratadas em memória. Seu uso remoto exige autorização específica.
Não é parte da manutenção de frontend, não provisiona o banco e não deve ser
executado nesta limpeza. Não alterar senhas ou configurações de Auth para compilar.

## Implantação, manutenção e rollback

O procedimento é [RELEASE.md](RELEASE.md). Push e pull request executam CI;
publicação exige dispatch manual em `main` com SHA completo exato. O workflow
não usa variáveis ou secrets Supabase. Pages recebe exclusivamente `dist/` validado.

Para alterações de frontend, executar o build Production com scanner embutido,
`pnpm verify:artifact` e os testes locais afetados. Manter guards de publicação,
scanner de credenciais, PWA na raiz e exclusão de módulos de diagnóstico.
Não executar comandos de provisão, migrations, upload de Function ou testes de
escrita para manutenção documental ou limpeza de código sem uso.

Antes de uma publicação futura, registrar SHA e digest do artefato, conferir o
resultado do workflow e verificar a página pública. O smoke autenticado de
grupos/jogadores/sorteio/histórico/logout só deve ser repetido quando a mudança
exigir e estiver autorizado. HTTP 200 comprova disponibilidade da página, não
recertifica autenticação nem escrita no banco.

Rollback usa uma versão aprovada da arquitetura Kinde/Neon compatível com o banco
existente. Não restaurar o Supabase excluído. Frontend, Function e schema são
versionados separadamente; rollback de frontend não faz rollback de dados.
Problemas de API/banco não autorizam executar inicializadores nem trocar secrets.

## Encerramento do legado Supabase

O usuário confirmou a exclusão definitiva do projeto Futebol Brasil
`tfnjbhstfiuqvenofvdb`. O Futebol novo substituiu a aplicação antiga. Não existe
destino Supabase de produção ou plano de recriação/importação nesta operação.

Nesta limpeza foram retirados SDK e dependências exclusivas, login/cliente e
adaptadores legados, template de variáveis, configuração local e runners Supabase.
Os contratos de dados ainda usados pelo Neon foram preservados em
`src/lib/database.types.ts`. SQL, decisões de segurança e evidências históricas
continuam em [`supabase/`](../supabase/README.md) e no histórico Git.

Em 07/11/2026, a conta GitHub mostrou apenas `Futebol CI and Pages` ativo,
sem workflow de keep-alive. As variáveis de repositório `VITE_SUPABASE_URL` e
`VITE_SUPABASE_PUBLISHABLE_KEY`, sem uso no workflow atual, foram removidas.
Não havia secrets no repositório nem variáveis/secrets no ambiente `github-pages`.
Os scanners mantêm padrões Supabase como proteção contra reintrodução do legado.

`deployment/README.md`, os documentos antigos de preparação PRD e os registros DEV
em `api/README.md` registram etapas anteriores. Expressões como configuração PRD
incompleta ou deploy ainda não autorizado nesses registros são históricas; o estado
vigente é este guia e `RELEASE.md`. Arquivos preexistentes de preparação não foram
alterados nem incluídos nesta limpeza. Poker, Sabará Account, Sabará ID, Kinde,
Neon DEV/PRD, DNS e deploy em funcionamento foram preservados.

Validação local desta limpeza: build Production, scanner de credenciais e
verificação do artefato Pages aprovados; 47 testes afetados e 7 verificações de
segurança/workflow/artefato aprovados, além de typecheck, lint afetado e checks de
release. Contratos de linhas/enums e arquivos preexistentes conferidos sem
alteração; lockfile perdeu somente dependências exclusivas do Supabase.
Não houve build DEV, teste remoto de escrita, migration ou deploy nesta rodada.

## Contas de homologação — Kinde Test (DEV)

Informação fornecida e autorizada pelo proprietário do projeto em 10/11/2026.
Estas contas são destinadas exclusivamente aos testes do Futebol no ambiente
**DEV/Kinde Test**; a divulgação desses dados de teste foi expressamente autorizada.

| Conta de teste | Usuário (e-mail) | Senha |
| --- | --- | --- |
| Teste 1 | `jaisson+teste1@sabara.org` | Igual ao e-mail completo da conta |
| Teste 2 | `jaisson+teste2@sabara.org` | Igual ao e-mail completo da conta |
| Teste 3 | `jaisson+teste3@sabara.org` | Igual ao e-mail completo da conta |

A senha de cada uma das três contas é **literalmente o respectivo e-mail**, incluindo
`jaisson+` e `@sabara.org`; não é necessária uma senha diferente para cada conta.

Em homologações DEV, o Codex pode utilizar essas contas no navegador de testes,
sem pedir que o usuário repita credenciais já documentadas. Somente solicitar
intervenção humana quando houver bloqueio efetivo (por exemplo, MFA, CAPTCHA,
consentimento externo ou sessão indisponível). Não presumir login bem-sucedido:
validar a sessão e as permissões antes de executar operações de teste.

Não utilizar estas credenciais no PRD, não alterar usuários/senhas e nunca
registrar tokens, códigos temporários, cookies, sessões ou segredos de serviços.
Se as contas passarem a alcançar dados reais ou serviços fora do DEV,
interromper seu uso automatizado até revisão de segurança.
