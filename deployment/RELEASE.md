# Futebol — publicação e rollback

Frontend ativo: **https://futebol.sabara.org/**, GitHub Pages, raiz `/`.
Em 22/11/2026, o [PR #9](https://github.com/jaissoncb/futebol/pull/9)
integrou o candidato homologado com árvore idêntica no SHA
`5562474a5fd118d5220681bee389fe3f94e28e35`. O preflight de release e o
[CI da main](https://github.com/jaissoncb/futebol/actions/runs/45063875929)
passaram. O [run Pages 45065268165](https://github.com/jaissoncb/futebol/actions/runs/45065268165)
publicou esse SHA no deployment `7984419501`.

| Artefato do run | ID | Digest SHA-256 do pacote |
| --- | --- | --- |
| futebol-pages-build | 14771395962 | `bcf2539fa77a474d32826aca953d9647e3a8197baae4a9d71e1fdcb6bbcee633` |
| github-pages | 14770758305 | `5f20e31786c025a89e97aa6e26766cb0476223f46115dda466fdc2cddde845c2` |

O digest do conteúdo dos 21 arquivos foi
`2585a4630796f87d8ab0a31927571ba1b3bbadfeac147b2ecaf16242bd6850db`.
Os arquivos publicados coincidiram byte a byte com o build oficial. HTTPS
retornou 200 e HTTP redirecionou com 301 para o domínio oficial.

A migration `007_manual_team_sizes.sql` foi aplicada em `futebol_prd`
antes do Pages, SHA-256
`1b8cf1490be8f8b7c0647797ec2bce2f509818c3c59e61766306334310792bbe`.
O RPC manteve assinatura, owner, SECURITY DEFINER, search_path e ACL.
As políticas RLS e os dados existentes tiveram o mesmo digest antes e
depois. A janela de recuperação era de seis horas. A Function
`futebolapi` permaneceu na implantação 2.

O smoke autenticado no Chrome, com Pixel 7 emulado, confirmou o service
worker, sorteio 5/4/4, ajuste 5/5/3, novo sorteio equilibrado, salvamento,
histórico e texto de compartilhamento. A fixture foi excluída pela rota
oficial. A releitura preservou o workspace e o histórico preexistentes.
A troca de worker de uma versão para a outra foi verificada em loopback
com os dois artefatos oficiais. Para esta release, o proprietário dispensou
uma estratégia especial de rollback após a gravação de escalas desiguais.

## Publicação anterior — exclusão de grupos

Em 22/11/2026, o [run Pages 45056804064](https://github.com/jaissoncb/futebol/actions/runs/45056804064)
publicou o SHA `593f491d8893444417a544b74792fa526bec5bf9`. O
[PR #7](https://github.com/jaissoncb/futebol/pull/7) passou no `build`
obrigatório e o preflight confirmou esse SHA na `main`.

| Artefato do run | ID | Digest SHA256 |
| --- | --- | --- |
| futebol-pages-build | 14767627601 | `22dc63a815eed42a3d1d029d7dbd1d7f2435984ffc039f174606e30b63e8c06f` |
| github-pages | 14768110845 | `88fbf389d06898d5f377ba9e325d4e01f376f643ea8b872e1b9e8559980bf2ed` |

O Neon PRD ativou a implantação 2 de `futebolapi`, com o ZIP homologado no
DEV de SHA-256 `2f565aea83e12d573461645591d8653cd1216a4ed594968957078acaff48f269`.
A migration 006 foi aplicada em `futebol_prd` após conferir grants, RLS, as
12 FKs do grafo e janela de restauração de seis horas. As conexões direta e
pooled passaram na verificação após o commit.

Antes do Pages, health retornou 200, o preflight de DELETE retornou 204 e a API
recusou DELETE anônimo com 401. Uma sessão real confirmou workspace, lista e
detalhe de histórico. Após o deploy, o smoke no Chrome mobile confirmou
service worker ativo, login, histórico e o diálogo do proprietário. Escape
cancelou o diálogo e o roteiro registrou zero escritas na API.

Arquitetura atual e credenciais: [OPERATIONS.md](OPERATIONS.md).
API PRD: Function `futebolapi`, Node 24, branch `br-divine-sun-badnm7ch` do
projeto `futebol-prd`. Banco `futebol_prd`, login restrito
`futebol_api_prd_functions`, com migrations 001–007 aplicadas.

## Publicação de frontend

1. Conferir diretório, remote `jaissoncb/futebol`, branch, status e SHA. Revisar
   somente o escopo autorizado, preservando alterações locais preexistentes.
2. Com dependências do lockfile instaladas, executar `pnpm build` (Production,
   scanner embutido), `pnpm verify:artifact` e testes locais afetados.
   Não publicar `dist-dev/`, diagnósticos, fontes, `.env`, secrets ou backups.
3. Commit/push não publica automaticamente. O workflow
   `.github/workflows/ci-pages.yml` executa CI em push para `main` e pull request.
   Instala com lockfile congelado, executa checks e guarda o build validado.
4. Quando uma publicação estiver autorizada e necessária, executar o workflow
   manualmente **em `main`**, com `expected_sha` igual ao SHA completo de 40
   caracteres. SHA divergente ou branch diferente bloqueia o release.
5. O mesmo run baixa o artefato pelo ID, revalida seu digest e publica somente
   esse conteúdo. Registrar SHA/run/digest e verificar o resultado Pages e a
   página pública. Repetir smoke autenticado apenas se necessário e autorizado.

DNS, domínio customizado e configurações Pages existentes não precisam de
reconfiguração. Nenhuma variável ou secret Supabase é necessária ao workflow.
Uma limpeza sem alteração necessária de comportamento pode ficar em branch,
com commit e push de revisão, mantendo o deploy funcional atual.

## Rollback

O ponto frontend confirmado pela auditoria é `7b314022eced7eab1e9f48bdf01c87da5b62a46d`,
que já usa Kinde/Neon. Registrar o novo ponto após cada publicação aprovada.

Preferir um commit de reversão das mudanças de frontend em `main`, preservando
o histórico. Validar o build contra os contratos atuais da API/banco e publicar
pelo mesmo dispatch com SHA exato. Um artefato anterior só pode ser usado após
revisão de procedência, configuração PRD e compatibilidade; não presumir que
artefatos Actions antigos ainda estejam disponíveis (retenção de 30 dias).

O SHA `e1cbfeff5a166c301917a953fde2da20f4f08217` corresponde ao Futebol antigo
e permanece apenas no histórico Git. **Não é rollback operacional**: o projeto
Supabase Futebol Brasil (`tfnjbhstfiuqvenofvdb`) foi excluído definitivamente.
Não recriar esse serviço nem retornar à autenticação ou configuração antigas.

Rollback de frontend não reverte o banco nem a Function. A API implantada e seus
grants/RLS ficam preservados. Qualquer mudança remota de API, credenciais ou
schema exige autorização própria; não executar inicializadores para rollback.

## Base Git antes de desenvolver

Confirme que o remote de leitura e escrita representa `jaissoncb/futebol`.
Faça fetch da main e crie novas branches a partir de `origin/main`, em worktree
ou clone isolado. Em checkouts que já têm o script, execute
`node scripts/git-preflight.mjs` antes de editar e antes de integrar. O comando
faz fetch novamente, exige que a ponta remota seja ancestral da branch,
lista commits faltantes e bloqueia se houver alterações locais. Preserve a
branch anterior e reconcilie em checkout limpo. Antes de publicar, rode
`node scripts/git-preflight.mjs --release` no SHA integrado. O workflow verifica
essa igualdade no começo e imediatamente antes do deploy.
