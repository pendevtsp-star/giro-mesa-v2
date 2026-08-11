# Relatório de execução — Onda 1C Financeiro

Data: 2026-08-11
Base: `c899c48`
Branch: `codex/giromesa-wave1-platform`
Worktree: `C:\gmw\w1p`

## Resultado

As Tasks 22–29 foram implementadas em ordem e com um commit funcional por task. A trilha cobre ledger monetário, pagamentos, fiscal, estoque dimensional, retornáveis, incidentes e remuneração. Não houve integração com provider real, push, deploy ou trabalho da Task 30 em diante.

## Commits por task

| Task | Entrega | Commit |
| --- | --- | --- |
| 22 | Ledger monetário balanceado, append-only e idempotente | `fbf8356` |
| 23 | Adapter de pagamentos e reconciliação de estado incerto | `6f8b3f2` |
| 24 | Ciclo fiscal desacoplado da venda | `9fb705f` |
| 25 | Estoque e fichas técnicas com precisão dimensional fixa | `6b7b858` |
| 26 | Custódia e reconciliação de retornáveis | `d3d8246` |
| 27 | Incidentes neutros, evidências e aprovação independente | `9aaf54c` |
| 28 | DSL tipada e versionada para remuneração | `84acc96` |
| 29 | Cálculo, aprovação, fechamento, ajustes e relatórios de remuneração | `f54e9ce` |

## Commits da revisão cruzada

| Achado | Correção | Commit |
| --- | --- | --- |
| 1 | DLP fiscal recursivo, normalização/Luhn e rejeição de chaves sensíveis | `f826a19` |
| 2 | Lifecycle fiscal serializado, CAS/version e terminais monotônicos | `66e2324` |
| 3 | Callback autenticado e aplicação atômica/idempotente | `4df1302` |
| 4 | Consumo de ficha técnica escalado por rendimento e unidade | `17bd7c5` |
| 5–6 | Custódia seriada com lock/CAS e reconciliação física por serial | `2e0efae` |
| 7 | Evidência de incidente imutável e privilégios mínimos | `d6c150a` |
| 8–9 | DSL estrita/limitada, validação antes de publicar e CSV neutro | `c673677` |
| Contratos | DSL recursiva resolvível/discriminada no OpenAPI e clientes | `3bace5c` |

## Invariantes preservados

- Valores monetários são inteiros em centavos; o ledger exige débito igual a crédito e reverte por novo lançamento, sem mutar histórico.
- Pagamentos preservam `unknown` como estado explícito e exigem reconciliação antes de qualquer nova decisão; payloads são rejeitados se contiverem PAN, CVV, track data ou material com formato de credencial.
- Documentos fiscais têm ciclo próprio; falha, pendência ou retry fiscal não alteram a venda.
- Quantidades usam átomos `BigInt` com seis casas decimais, dimensão explícita, conversão compatível, rendimento e arredondamento determinístico.
- Retornáveis registram custódia de ativos seriados e agregados em trilha append-only e reconciliável.
- Incidentes usam linguagem neutra, evidências e dupla decisão; o banco fixa `payroll_action = false` e nenhuma automação desconta folha.
- A DSL de remuneração é uma AST fechada, sem `eval`, `Function` ou `node:vm`, com limites de complexidade, vigência, simulação e memória congelada.
- Taxa de serviço, comissão e participação nos resultados permanecem categorias separadas. Relatórios fechados são imutáveis; correções geram nova execução de ajuste vinculada.
- Tabelas novas usam RLS com `FORCE ROW LEVEL SECURITY`; testes PostgreSQL incluem negativas cross-tenant e restrições append-only.

## Migrações

Somente as reservas autorizadas foram usadas:

- `0020_financial_ledger_and_payments.sql`
- `0021_inventory_returnables_incidents.sql`
- `0022_remuneration_rules.sql`
- `0023_fiscal_documents.sql`

A cadeia financeira `0001–0016` + `0020–0023` foi aplicada do zero com sucesso no banco descartável `w1p_final` (20 registros de journal). O upgrade combinado também passou em `w1p_upgrade`: primeiro o journal operacional `0001–0019` da Onda 1B e depois este journal `0020–0023`, totalizando 23 registros e preservando tabelas das duas trilhas.

As branches paralelas mantêm journals próprios após o índice 15. O merge deve unir as entradas `0017–0019` antes de `0020–0023`, conservando os timestamps crescentes já reservados; nenhum SQL adicional ou renumeração foi necessário nesta branch.

## Gates finais

- PostgreSQL real recém-migrado: 8/8 testes de integração API passaram — ledger/pagamentos/callback, fiscal com concorrência, gestão/estoque, retornáveis com corrida por serial, incidentes e remuneração. Worker de estoque: 1/1 integração e 5/5 regras unitárias.
- Migrações: fresh `0001–0016` + `0020–0023` e upgrade combinado `0001–0019` + `0020–0023` passaram. O upgrade contém `public_menu_versions`, `table_occupancies`, `dispatch_effects`, `financial_ledger_entries`, `management_incidents` e `fiscal_documents`.
- RLS/least privilege: todas as 118 tabelas RLS da trilha fresh e as 143 do upgrade combinado têm `FORCE ROW LEVEL SECURITY`; `giromesa_app` não possui `UPDATE` de tabela nem das colunas imutáveis de incidente, apenas das três colunas de transição.
- `pnpm run typecheck`: 12/12 tarefas passaram, cobrindo nove pacotes.
- Testes focados e completos: domain 51/51, Ops 56/56, API 99 pass/49 skips condicionais (as integrações financeiras foram executadas separadamente), worker 16 pass/3 skips condicionais.
- `pnpm run build`: 8/8 tarefas de build passaram.
- Biome lint sem erros nos seis pacotes alterados (API, Ops, worker, domain, DB e contracts); permanecem warnings CSS preexistentes no Ops.
- OpenAPI regenerado sem `$ref` órfão; a AST recursiva foi promovida a componentes discriminados. Cliente TypeScript gerado e compilado.
- Cliente C# gerado e compilado em .NET 10: 0 warnings, 0 errors.
- Edge Hub: 73/73 testes passaram.
- Playwright focado no relatório: 2/2, desktop e mobile.
- `git diff --check`: passou após remover whitespace residual do relatório.
- Busca de invariantes: nenhum uso de execução dinâmica; ocorrências de PAN/CVV ficam apenas na política, validação negativa e testes.

## Limites e observações

- `pnpm check` não foi repetido como bloco monolítico porque o `biome check` workspace-wide detecta normalização de fim de linha/formatting já espalhada pela base, incluindo arquivos fora desta onda. Não foi feita uma reescrita massiva e fora do escopo. Biome focado, typecheck, testes e builds foram executados separadamente.
- A geração OpenAPI mantém os aliases `/api/v1` e `/v1`, por isso o cliente C# contém ambas as árvores, conforme o contrato existente.
- Providers de pagamento/fiscal, hardware, credenciais, homologação externa e comportamento de produção não foram exercitados nem alegados.
- Nenhum merge, push ou deploy foi realizado.

## Hardening complementar de grants e state machines

Commit de implementação: `673d918` (`fix(finance): enforce database state machines`).

- Os grants amplos de `UPDATE` foram removidos de `payment_terminals`, `payment_intents`, `payment_attempts`, `remuneration_rule_sets`, `remuneration_rule_versions`, `remuneration_calculation_runs` e `fiscal_documents` nas migrations reservadas `0020`, `0022` e `0023`.
- `payment_terminals` e `remuneration_rule_sets` não concedem mais nenhum `UPDATE` a `giromesa_app`. As demais tabelas concedem somente as colunas efetivamente atualizadas pelos serviços.
- Triggers fail-closed validam estado inicial, transições, incremento de versão, aprovação independente e imutabilidade de escopo, valor, idempotência, memória congelada e vínculo/payload de provider. Estados terminais não podem regredir e os registros protegidos não podem ser apagados.
- O teste SQL `financial-state-machines.integration.test.ts` executa como `giromesa_app`, confirma privilégios por coluna, exercita transições válidas e rejeita inserts terminais, saltos de estado e mutações proibidas. Os modos fresh e upgrade passaram em PostgreSQL 16 e 17.
- O teste de callback deixou de resetar artificialmente uma intenção paga; agora usa uma segunda intenção para provar sucesso/replay sem violar monotonicidade. O detector de PAN continua fail-closed para cartões e chaves sensíveis, mas reconhece UUIDs canônicos para não bloquear identificadores internos válidos.
- Os testes DB foram serializados no runner porque migrations concorrentes alteram os mesmos papéis globais do PostgreSQL e podem produzir `tuple concurrently updated`; isso não muda a concorrência exercitada dentro dos testes funcionais.

### Gates do hardening

- RED: fresh e upgrade falharam inicialmente porque `giromesa_app` possuía `UPDATE` de tabela/colunas imutáveis; um segundo RED provou que inserts já terminais ainda contornavam as state machines.
- PostgreSQL 17: state machines fresh + upgrade, 2/2.
- PostgreSQL 16: state machines fresh + upgrade, 2/2 em container efêmero isolado.
- DB completo: 6/6, incluindo o upgrade histórico de RLS.
- API completa: 104 pass, 44 skips condicionais; os cinco testes reais de payments, remuneration e fiscal passaram contra um banco recém-migrado.
- Domain: 52/52, incluindo UUID canônico sem falso positivo e rejeição existente de PAN/CVV/track/credenciais.
- Turbo `typecheck` + `build`: 8/8 tarefas nos pacotes API, DB, domain e dependência contracts.
- Biome focado e `git diff --check`: sem erros.

O banco PG17 descartável `giromesa_finance_gate_w1p` e o container PG16 `giromesa-finance-pg16-w1p` foram usados apenas para os gates e removidos ao final. Nenhum provider real, push ou deploy foi executado.
