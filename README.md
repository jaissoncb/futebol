# Futebol

Aplicação independente para organizar partidas entre amigos, gerenciar grupos e jogadores, sortear times equilibrados e registrar o histórico das partidas.

Arquitetura planejada:

- repositório: `jaissoncb/futebol`;
- domínio oficial: `https://futebol.sabara.org/`;
- aplicação Vite/React na raiz;
- rotas da interface com `HashRouter`;
- PWA e service worker no escopo `/`;
- banco e autenticação no projeto Supabase já existente.

## Requisitos

- Node.js 22.18 ou superior;
- pnpm 11.19.0;
- Docker e Supabase CLI para os testes de banco locais.

## Desenvolvimento

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm dev
```

Preencha `.env.local` apenas com a URL e a chave pública/publishable do ambiente apropriado. Nunca use uma chave `service_role` no frontend.

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
