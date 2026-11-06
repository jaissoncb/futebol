# Futebol Production

Frontend: https://futebol.sabara.org/ (GitHub Pages Free, raiz `/`).
API: https://br-divine-sun-badnm7ch-futebolapi.compute.c-8.eu-central-1.aws.neon.tech/
Projeto Neon: futebol-prd / withered-haze-60370136; production / br-divine-sun-badnm7ch;
Frankfurt/PG17/Free. Banco futebol_prd; login futebol_api_prd_functions.

Migrations 001–005 já aplicadas. Não repetir, limpar ou recriar roles. Banco e
login reais direto/pooled passaram nos grants/RLS. Verificador corrigido para evitar
colisão entre variável PLPGSQL e alias de catálogo; nenhuma policy foi alterada.

API versão1: ZIP aprovado 510bf79183fa4025d5ceb36849606b22cf845b4541d732888270cb98dc71202e,
Node24. Somente FUTEBOL_RUNTIME_CONFIG, DATABASE_URL, DATABASE_URL_UNPOOLED.
Ambas URLs restritas, TLS verificado; chave de gestão nunca entra no runtime.
Health200, sem Bearer401, rota DEV404, CORS permitido204 e origem indevida403.
Smoke autenticado de /me, grupo/jogadores, sorteio/save/histórico/logout deve ser
registrado no Handoff após publicação pública; não se declara pelo health.

Configurações JSON são públicas. Segredos ficam em memória/storage Neon; nunca
.env/argv/Git/chat. Operador scripts/neon-prd-release.ps1 recebe chave temporária
Project-scoped PRD em campo oculto, recupera senha existente, verifica banco e
aguarda comando público com runId/sequence em diretório ignorado. Não possui
provisionamento de banco ou modo de alteração de senha. Não repetir POST incerto.

Build: pnpm build; pnpm verify:artifact; pnpm test:release-build. O teste de release
opera em dist PRD e mantém fixtures negativas sem recompilar DEV. Artefato local
validado: digest40ce3def483c518ddf73897bece2d11d02a97a9929e83f756234dc0fb96bd8a5.
Workflow ci-pages.yml: dispatch manual em main com expected_sha igual ao SHA completo.
DNS e Pages já usam futebol.sabara.org / jaissoncb.github.io; não alterar sabara.org.

Publicação anterior é a entrada Supabase desse mesmo repositório/domínio, com
main anterior e1cbfeff5a166c301917a953fde2da20f4f08217. Preservar esse SHA para
rollback revisado e os dados Supabase intactos. Substituir somente o artefato Pages
após checks; não excluir serviços, projetos ou dados antigos. Eventuais outras
rotas antigas devem ser identificadas e retiradas somente após smoke público PASS.
