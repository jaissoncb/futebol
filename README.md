# Futebol

Aplicação independente para organizar partidas entre amigos, gerenciar grupos e jogadores, sortear times equilibrados e registrar o histórico das partidas.

Arquitetura planejada:

- repositório: `jaissoncb/futebol`;
- domínio oficial: `https://futebol.sabara.org/`;
- aplicação Vite/React na raiz;
- rotas da interface com `HashRouter`;
- PWA e service worker no escopo `/`;
- baseline legado de banco/autenticação Supabase preservado até concluir a validação DEV;
- DEV em migração para cliente público Kinde Test, API intermediária e Neon vazio/isolado.

## Requisitos

- Node.js 22.18 ou superior;
- pnpm 11.19.0;
- Docker e Supabase CLI para os testes de banco locais.

## Desenvolvimento

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` serve a entrada Kinde Test isolada em `http://localhost:5173/`, com porta estrita e metadados públicos confirmados do Futebol. Não execute junto com Account Test ou a PoC Identity na mesma porta/origem. A transação OAuth tem namespace exclusivo; access/ID/refresh tokens ficam somente em memória. Reload pode exigir novo login. Account é somente o portal de gestão da conta.

Em outro terminal, `pnpm dev:api` inicia a API local em localhost:8787 com autenticação **fechada por padrão**, sem banco, até a prova positiva do principal e a integração Neon serem validadas. O botão de acesso DEV pode receber 401 enquanto esse gate estiver aberto. Grupos/partidas ainda não estão ligados à nova entrada; a interface legada está preservada.

`pnpm build:dev` gera `dist-dev/`, verifica raiz/PWA, configuração Test exclusiva e scanner de segredos, sem usar variáveis Supabase. Não publica nada. O build padrão/CI continuam no baseline legado; a migração completa não está liberada para Production. Nunca coloque Client Secret, DSN Neon ou qualquer chave privilegiada no frontend, `.env` compartilhado, Git ou Drive.

## Verificações do frontend

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:bundle-security
pnpm test:workflow
pnpm build
pnpm verify:artifact
pnpm test:release-build
```

O E2E depende do Supabase local iniciado e reconstruído pelas migrations:

```powershell
pnpm test:e2e
```

## Supabase local

As migrations, políticas RLS, grants e testes ficam em `supabase/`. O identificador local é `futebol`; isso não cria nem substitui o projeto remoto existente.

Consulte `supabase/README.md` para a sequência completa de validação local. Operações remotas como `supabase link`, `db push` ou alterações de Auth exigem autorização explícita.

## Publicação

O workflow em `.github/workflows/ci-pages.yml` prepara somente `dist/` e exige dispatch manual em `main` com o SHA completo para empacotar e publicar no GitHub Pages. A infraestrutura remota ainda não faz parte desta extração local.
