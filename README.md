# Futebol

Aplicação para organizar partidas entre amigos, gerenciar grupos e jogadores,
sortear times equilibrados e salvar o histórico. Repositório `jaissoncb/futebol`;
domínio planejado `https://futebol.sabara.org/`, sempre na raiz.

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
não solicita encerramento global de sessões. O portal Account continua apenas
como link de gestão da conta.

## Configuração e build

- `deployment/frontend-dev.json`: metadados públicos exatos de DEV; sem `.env`.
- `deployment/frontend-prd.json`: destino oficial e contrato ainda incompleto.
  `pnpm build` **falha deliberadamente** até aprovar/preencher Kinde e API PRD
  próprios. Nunca usa fallback Test. Metadados não são autorização de deploy.
- `src/main.tsx` abre o frontend Futebol com as telas/regras existentes. Diagnósticos,
  probes, autenticação legada e SDK Supabase ficam fora de seu grafo de build.
- `pnpm build:dev` verifica grafo, PWA, configuração emitida e scanner de segredos.
  `node scripts/verify-pages-artifact.mjs dist-dev` verifica o pacote estático.
- `pnpm test:release-build` verifica o bloqueio PRD e as barreiras do artefato DEV
  já compilado. Não publica nada nem acessa serviços remotos.

Vite não lê arquivos `.env` nem expõe variáveis `VITE_*` nesta entrada. Nenhum
Client Secret, token, chave Neon, DSN ou senha pertence ao frontend/Git.
O worker armazena somente o shell estático; não há cache runtime de API, tokens,
perfil ou dados privados. Atualização continua exigindo confirmação e respeita
partidas/salvamentos pendentes. Base, manifest, worker e HashRouter usam `/`.

## Ferramentas locais preservadas

`pnpm dev:diagnostics` abre a entrada antiga de diagnósticos Kinde em localhost:5173,
apontando para a API **local** em localhost:8787. `pnpm build:diagnostics` gera
`dist-diagnostics/`, ignorado pelo Git. Não use esse artefato para publicação.
Os runners de banco e o E2E Supabase são históricos; não são a validação desta
entrada e não devem ser executados contra DEV preservado. Fontes e migrations
legadas permanecem disponíveis; não há migração de usuários, senhas ou dados.

A API validada e seus scripts estão documentados em `deployment/README.md`.
Não repita provisionamento, deploy ou smoke remoto concluído.

## Antes de Production

Intervenção humana: aprovar contrato PRD próprio no Sabará ID/Kinde (issuer,
cliente público, audience, callback/logout raiz) e destino API/banco PRD, confirmar
plano Free e autorizar separadamente infraestrutura, DNS e publicação. Não há
contrato PRD nem autorização de Production nesta etapa.

Após aprovação, Codex pode preencher/revisar a configuração pública PRD, preparar
a API PRD com CORS exato e configuração restrita, verificar build/testes/scanner
e preparar a revisão do release. Implantação, DNS, push/merge e Pages somente
com autorização específica posterior. O workflow local foi desacoplado das
variáveis Supabase e continua bloqueado pelo build PRD incompleto; não foi executado.
GitHub Pages recebe somente `dist/`, com release manual em `main` e SHA exato.
Nenhuma assinatura, upgrade ou serviço pago foi adicionado.
