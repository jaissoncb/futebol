# Futebol — publicação e rollback

Frontend ativo: **https://futebol.sabara.org/**, GitHub Pages, raiz `/`.
Referência efetivamente publicada, conforme auditoria de 08/11/2026:
`7b314022eced7eab1e9f48bdf01c87da5b62a46d`, versão nominal `0.1.0`.
O [run Pages 42366705868](https://github.com/jaissoncb/futebol/actions/runs/42366705868)
concluiu em 07/11/2026, 11:06:57 UTC. O bundle observado foi
`/assets/index-cLtShd5A.js`. A Fase 3A contém correções locais ainda não publicadas.

| Artefato do run | ID | Digest SHA256 |
| --- | --- | --- |
| futebol-pages-build | 13572426036 | `336ef35075ad9a509b649810f0669198541d70c021a940ff1b8a1d410ab8fafe` |
| github-pages | 13572235792 | `ab9a2167d01c085f5ee03e3ebdf7901f9ecb637455c6f7153a9da790d7455911` |

Use SHA/run/digest para identificar releases; `0.1.0` sozinho não os distingue.
Essas evidências identificam o frontend. A revisão da Neon Function efetivamente
implantada não foi obtida de forma independente, nem certificada pelo SHA Pages.
Não houve download e comparação byte a byte de todos os recursos servidos.

Arquitetura atual e credenciais: [OPERATIONS.md](OPERATIONS.md).
API PRD: Function `futebolapi`, Node 24, branch `br-divine-sun-badnm7ch` do
projeto `futebol-prd`. Banco `futebol_prd`, login restrito
`futebol_api_prd_functions`; migrations 001–005 já aplicadas. Não repetir.

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
