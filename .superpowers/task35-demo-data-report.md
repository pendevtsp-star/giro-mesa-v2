# Task 35 — dados demonstrativos completos

## Escopo e baseline

- Worktree: `C:\gmw\t35demo`
- Branch: `codex/giromesa-task35-demo-data`
- Baseline: `9f70fcc` (`main`/`origin/main` em 2026-08-11)
- Plano consultado: `docs/plans/2026-08-10-giromesa-production-implementation.md`, Task 35, e o design de produção correspondente.
- Commit funcional: `d8184ec feat: add deterministic complete demo dataset`
- Fora de escopo: push, deploy, providers reais, hardware, mergeprep e qualquer credencial piloto.

## Entrega

- Dataset explicitamente demonstrativo, versão 1, ancorado em `2026-08-10T18:00:00.000Z`.
- Sete papéis persistidos no banco (`owner`, `manager`, `waiter`, `cashier`, `kds`, `inventory`, `finance`) e nove experiências de papel na Ops, sem PIN persistido no bundle demo.
- Uma organização `[DEMO]` com duas filiais `[DEMO]`.
- 120 mesas determinísticas distribuídas em três áreas, com estados operacionais estáveis.
- Quatro cenários de turno no manifesto Ops e quatro tickets KDS persistidos.
- Oito itens de estoque, incluindo três retornáveis identificados como dados demo.
- Dois incidentes neutros representados no ledger de eventos de inventário disponível no baseline.
- Financeiro com conta a pagar, turno de caixa, três recebíveis e três pagamentos em centavos inteiros, todos locais/simulados.
- DoseClub configurado como `disabled`/`simulator`, com `credentialReference = null`, sem endpoint ou chamada externa.
- Reset transacional com exclusão restrita ao UUID fixo do tenant demo e reinserção determinística.
- Dupla barreira de segurança: confirmação literal `RESET_GIROMESA_DEMO` e nome do banco terminado em `_demo`, tanto no wrapper quanto no seed do banco.
- Execução Windows sem `shell`: o wrapper usa Node + Corepack diretamente, evitando interpolação de argumentos.

## TDD observado

1. RED do wrapper: `ERR_MODULE_NOT_FOUND` para `scripts/reset-demo-tenant.mjs`.
2. GREEN do wrapper inicial: 3 testes.
3. RED do manifesto Ops: `createDemoScenario is not a function` em 3 testes.
4. GREEN do manifesto e regressões Ops: 12 arquivos / 40 testes.
5. RED do seed do banco: exports `createDemoSeedPlan` e `DEMO_RESET_CONFIRMATION` ausentes.
6. GREEN do seed: 4 testes do pacote DB.
7. RED real Windows: `spawn pnpm ENOENT`, seguido de `spawn EINVAL` com `.cmd` sem shell.
8. GREEN Windows: resolução Node + Corepack coberta por teste, sem habilitar shell.

## Gates

| Gate | Resultado |
|---|---|
| `rtk node --test scripts/reset-demo-tenant.test.mjs` | PASS — 4/4 |
| `rtk pnpm test` em `apps/ops` | PASS — 12 arquivos / 40 testes |
| `rtk pnpm test` em `packages/db` | PASS — 4 testes |
| `rtk pnpm exec turbo run typecheck --filter=@giromesa/ops` | PASS — 4 tasks |
| `rtk pnpm typecheck` em `packages/db` | PASS |
| `rtk pnpm exec biome lint` nos 9 arquivos tocados | PASS — sem warning |
| `rtk pnpm exec biome check` nos 5 arquivos novos/substituídos | PASS |
| `rtk pnpm exec turbo run build --filter=@giromesa/db --filter=@giromesa/ops` | PASS — 3 tasks |
| Fresh migrations PostgreSQL 17 em `giromesa_task35_demo` | PASS |
| Reset explícito executado duas vezes no PostgreSQL 17 | PASS — contagens invariantes |
| `rtk git diff --check` | PASS |

Contagens após cada reset real: `1` organização, `2` filiais, `7` vínculos de papel, `120` mesas, `4` tickets KDS, `8` itens de inventário, `2` incidentes, `3` pagamentos e `1` integração DoseClub desabilitada sem referência de credencial.

## Limites verificados

- O `main` de baseline ainda não contém os schemas dedicados de `ServiceArea`, `ServiceShift`, retornáveis, incidentes, ledger financeiro novo e DoseClub Contract v2 das ondas paralelas. Por isso, turnos/áreas completas vivem no manifesto Ops; retornáveis usam SKUs de inventário; incidentes usam eventos neutros de inventário; pagamentos usam os recebíveis/pagamentos existentes; DoseClub usa `growth_integrations` desabilitado.
- Na composição posterior das ondas, esses blocos devem ser promovidos aos schemas dedicados sem alterar os IDs, a marcação `[DEMO]`, a confirmação dupla ou a semântica determinística. Isso é integração de branches, não dependência externa nem provider pendente.
- O lint de pacote inteiro no baseline acusa normalização CRLF em arquivos preexistentes. O gate usado foi `biome lint` sobre todos os arquivos tocados e `biome check` sobre arquivos novos/substituídos, sem reformatar milhares de linhas fora do escopo.
- Nenhum E2E visual foi executado: a mudança visual é somente volume/conteúdo determinístico do modo demo; testes Ops, typecheck e build cobrem o caminho alterado. Não há alegação de homologação visual ou operacional externa.
