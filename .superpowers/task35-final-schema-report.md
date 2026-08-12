# Task 35 — promoção do demo para schemas finais

## Escopo e baseline

- Worktree: `C:\gmw\t35final`
- Branch: `codex/giromesa-task35-final-schema`
- Baseline solicitado: `c5d714d`
- Commit funcional: `8956ca6 feat(db): promote demo seed to final schemas`
- Nenhuma migration criada: o seed usa as tabelas finais já instaladas por `0018`, `0020`, `0021` e `0026`.
- Fora de escopo: hotfixes da release piloto, push, deploy, provider real, credenciais e eventos DoseClub externos sintéticos.

## Entrega

O plano determinístico do tenant demo agora persiste os domínios nos schemas que as APIs e workers realmente consomem:

| Domínio | Tabelas finais | Linhas por reset |
| --- | --- | ---: |
| Salão | `service_areas`, `service_shifts` | 3 áreas, 4 turnos |
| Retornáveis | `management_returnable_assets`, `management_returnable_serials`, `management_returnable_movements` | 3 ativos, 2 séries, 6 movimentos |
| Incidentes | `management_incidents`, `management_incident_events` | 2 relatos, 2 eventos iniciais |
| Contabilidade | `financial_ledger_transactions`, `financial_ledger_entries` | 3 transações, 6 partidas |
| Pagamentos | `payment_terminals`, `payment_intents`, `payment_attempts`, `payment_provider_events` | 1 terminal simulador, 3 intents, 3 attempts, 2 eventos seguros |
| DoseClub | `doseclub_product_mappings`, `doseclub_states`, `doseclub_operations` | 3 mapeamentos, 2 estados v2, 0 operações externas |

- As três transações financeiras são double-entry e o teste do plano confere a soma de débitos e créditos; o PostgreSQL também executa os constraint triggers diferidos.
- Os pagamentos atravessam as state machines reais: um autorizado/pago, um `unknown` com revisão obrigatória e um recusado.
- Os incidentes começam em `reported`, com evento inicial do mesmo ator e `payroll_action = false`.
- Os retornáveis têm modos agregado e serializado e uma cadeia de custódia determinística, sem saldo negativo no cenário.
- A integração DoseClub permanece `disabled`, com `credential_reference = null`; somente mapeamentos e snapshots locais são criados.

## Reset fail-closed

- Confirmação literal `RESET_GIROMESA_DEMO` e URL cujo banco termina em `_demo` continuam obrigatórias.
- O próprio PostgreSQL revalida `current_database()` dentro da transação, impedindo que uma URL simulada autorize reset em outro banco.
- Um advisory lock serializa resets concorrentes.
- O `ALTER TABLE ... DISABLE TRIGGER USER` ocorre apenas após as duas validações, sob locks transacionais do PostgreSQL, para remover fatos append-only do tenant demo; os triggers são reativados antes das novas inserções e o rollback também restaura qualquer DDL em caso de falha.
- Todas as exclusões continuam restritas ao UUID fixo da organização demo. Nenhum dado de outro tenant é truncado.

## TDD e gates

1. RED: `pnpm -C packages/db test` falhou no TypeScript porque o plano não expunha áreas/turnos, ledgers finais, fatos de pagamento nem tabelas DoseClub, e `resetDemoTenant` não exigia a conexão/confirmador.
2. GREEN unitário: `rtk pnpm -C packages\db test` — 6 pass, 8 conditional skips, 0 fail.
3. PostgreSQL 17 real: teste focado aplicou todas as 26 migrations disponíveis, rejeitou URL `_demo` apontando para banco não-demo, executou dois resets e comparou snapshots idênticos — 1/1 pass.
4. O teste PG confirmou as 16 contagens finais, os estados/versionamentos de pagamentos e turnos, `credential_reference = null` e oito triggers com `tgenabled = 'O'` após o segundo reset.
5. Wrapper do reset: `rtk node --test scripts\reset-demo-tenant.test.mjs` — 4/4 pass.
6. Formatação focada: `rtk pnpm -C packages\db exec biome check src\seed.ts src\seed.test.ts src\demo-seed.integration.test.ts` — 3 arquivos, pass.
7. Typecheck do pacote: `rtk pnpm -C packages\db typecheck` — pass.
8. Typecheck da trilha: `rtk pnpm exec turbo run typecheck` — 14/14 tasks.
9. Build da trilha: `rtk pnpm exec turbo run build` — 9/9 tasks.
10. `rtk git diff --check` — pass.

## Limites e ruído preexistente observado

- O lint integral de `packages/db` continua falhando em 17 arquivos não alterados por diferenças CRLF/formatação; o gate focado dos três arquivos desta entrega está verde.
- Com `TENANT_ISOLATION_DATABASE_URL` exportada para todo o pacote, cinco testes de migrations preexistentes calculam `packages/db/.turbo/drizzle/` em vez de `packages/db/drizzle/` e falham com `ENOENT`. O novo teste usa o caminho compilado correto e passou contra PostgreSQL 17; os demais testes não foram alterados por esta Task.
- O build Ops preserva o aviso preexistente de chunk acima de 500 kB; não afeta o seed do banco.
