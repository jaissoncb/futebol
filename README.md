# Futebol

Aplicação para organizar partidas entre amigos, gerenciar grupos e jogadores,
sortear times equilibrados e salvar o histórico. Repositório `jaissoncb/futebol`;
publicado em **https://futebol.sabara.org/**, sempre na raiz `/`.

## Arquitetura em operação

GitHub Pages serve o frontend React/PWA. O Sabará ID fornece login pelo Kinde;
o frontend chama a API em Neon Functions, que acessa o Neon PostgreSQL com login
restrito, grants explícitos e RLS. DEV e PRD têm configurações e recursos separados.
O navegador não acessa PostgreSQL diretamente. Sabará Account é apenas o portal
externo de gestão da conta.

O Supabase **Futebol Brasil** (`tfnjbhstfiuqvenofvdb`) foi excluído definitivamente,
conforme confirmação do usuário no painel e na conta. A implementação antiga foi
substituída. Não há recriação, importação de contas/dados nem rollback para ela.
As migrations e auditorias em [`supabase/`](supabase/README.md) são arquivo histórico.

Operação vigente: [`deployment/OPERATIONS.md`](deployment/OPERATIONS.md).
Publicação e rollback: [`deployment/RELEASE.md`](deployment/RELEASE.md).

## Prévia DEV

Requisitos: Node 24 (também usado pela API) e pnpm 11.19.0. Com as dependências
já instaladas, não é necessário Internet para compilar ou servir o frontend:

```powershell
pnpm build:dev
pnpm preview:dev
```

Abra **http://localhost:5173/**. A prévia estática de `dist-dev/` usa diretamente
a Function `futebolapi` DEV já implantada em Frankfurt e o Kinde Test existente.
O login humano e as chamadas à API precisam de Internet; não há API local, proxy,
segredo de banco ou novo deploy. O endereço/porta precisam ser exatos por causa
dos callbacks Kinde e do CORS já aprovados. Não execute Account/Identity na mesma
origem/porta; prefira o perfil de navegador exclusivo do Futebol DEV.

Para editar com recarga automática: `pnpm dev`. Pare com Ctrl+C. Se a instalação
local antiga tiver um worker de diagnóstico controlando essa origem, feche suas
abas e remova somente o worker `http://localhost:5173/sw.js` nas ferramentas do
navegador antes de abrir a nova prévia. Não limpe dados de outros projetos.

Login/cadastro continuam no Sabará ID pelo SDK Kinde, com PKCE S256 e tokens
somente em memória. Apenas a transação OAuth temporária persiste em namespace
Futebol, com TTL. Reload/nova aba podem exigir novo login. Logout cancela pedidos
privados, remove dados da tela e sinaliza as outras abas Futebol desse ambiente;
não solicita encerramento global de sessões. A política aceita do MVP não promete
revogação imediata de Bearer já emitido após logout. O portal Account continua
apenas como link de gestão da conta.

O último grupo selecionado é lembrado nesta aba por IDs de usuário/grupo em
`sessionStorage`, após conferir a participação pela API; logout limpa a preferência.
Não são armazenados tokens, nomes de grupos, jogadores ou rascunhos para isso.
Alterações de partida ainda não salvas pedem confirmação antes de trocar de grupo
ou sair. Recarregar/fechar usa o aviso nativo do navegador. Tentativas incertas
continuam congeladas para retry; verifique o histórico antes de abandoná-las.

## Configuração e build

- `deployment/frontend-dev.json`: metadados públicos exatos de DEV; sem `.env`.
- `deployment/frontend-prd.json`: metadados públicos próprios de Kinde e API PRD.
  `pnpm build` gera o artefato Production e recusa contrato incompleto, sem fallback Test.
- `src/main.tsx` abre o frontend Futebol com as telas/regras existentes. Diagnósticos,
  probes e ferramentas de operação ficam fora de seu grafo de build.
- `pnpm build:dev` verifica grafo, PWA, configuração emitida e scanner de segredos.
  `node scripts/verify-pages-artifact.mjs dist-dev` verifica o pacote estático.
- `pnpm test:release-build` verifica o artefato PRD e fixtures negativas de
  configuração. Não publica nada nem acessa serviços remotos.

Vite não lê arquivos `.env` nem expõe variáveis `VITE_*` nesta entrada. Nenhum
Client Secret, token, chave Neon, DSN ou senha pertence ao frontend/Git.
O worker armazena somente o shell estático; não há cache runtime de API, tokens,
perfil ou dados privados. Atualização continua exigindo confirmação e respeita
partidas/salvamentos pendentes. Base, manifest, worker e HashRouter usam `/`.

## Ferramentas locais preservadas

`pnpm dev:diagnostics` abre a entrada antiga de diagnósticos Kinde em localhost:5173,
apontando para a API **local** em localhost:8787. `pnpm build:diagnostics` gera
`dist-diagnostics/`, ignorado pelo Git. Não use esse artefato para publicação.
SDK, login, adaptadores, configuração local e runners Supabase foram removidos.
Os contratos de domínio compartilhados com Neon estão em
`src/lib/database.types.ts`. Os scripts de banco Neon existentes não fazem parte
do build e não devem ser executados contra bancos já inicializados.

A API e seus scripts têm registros históricos em `api/README.md` e
`deployment/README.md`; as preparações antigas não substituem o guia operacional.
Não repita provisionamento, deploy ou smoke remoto concluído.

## Production

Banco Neon `futebol_prd` inicializado; migrations 001–005 já aplicadas, não repetir.
Login restrito, grants e RLS verificados em conexões reais direta e pooled.
Function `futebolapi` PRD implantada com as fontes DEV aprovadas e configuração
PRD própria. Kinde usa `https://login.sabara.org`, audience PRD e cliente público
exclusivo. Nenhum DSN administrativo entra na Function ou no frontend.

GitHub Pages recebe somente `dist/`, com release manual em `main` e SHA exato,
no domínio `https://futebol.sabara.org/`. Operação e rollback em
[`deployment/RELEASE.md`](deployment/RELEASE.md). Production foi confirmada no
GitHub Pages no SHA `7b314022eced7eab1e9f48bdf01c87da5b62a46d`, run
[`42366705868`](https://github.com/jaissoncb/futebol/actions/runs/42366705868),
publicado em 07/11/2026 e auditado em 08/11/2026. A versão nominal é `0.1.0`;
SHA/run/digests em RELEASE identificam a publicação. A revisão efetivamente
implantada da Neon Function não foi certificada de forma independente.
As correções da Fase 3A são locais e não representam nova publicação.
