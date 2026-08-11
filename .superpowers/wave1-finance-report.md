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
| 29 | Cálculo, aprovação, fechamento, ajustes e relatórios de remuneração | este commit |

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

A cadeia completa `0001–0023` foi aplicada do zero com sucesso no banco descartável `giromesa_w1_finance_v13`.

## Gates finais

- PostgreSQL real, banco recém-migrado: 7/7 integrações financeiras passaram — ledger/pagamentos, fiscal, gestão/estoque, worker de consumo, retornáveis, incidentes e remuneração.
- `pnpm typecheck`: todos os pacotes sem erros TypeScript.
- `pnpm test`: verde em todos os pacotes; destaques: domain 51/51, Ops 56/56, API 92 pass/47 skips condicionais sem variáveis de integração, worker 15 pass/3 skips condicionais.
- `pnpm build`: 8/8 tarefas de build passaram.
- Biome lint sem erros nos seis pacotes alterados (API, Ops, worker, domain, DB e contracts); permanecem warnings CSS preexistentes no Ops.
- Cliente TypeScript gerado e compilado.
- Cliente C# gerado e compilado em .NET 10: 0 warnings, 0 errors.
- Edge Hub: 73/73 testes passaram.
- Playwright focado no relatório: 2/2, desktop e mobile.
- `git diff --check`: passou.
- Busca de invariantes: nenhum uso de execução dinâmica; ocorrências de PAN/CVV ficam apenas na política, validação negativa e testes.

## Limites e observações

- `pnpm check` não conclui a primeira etapa porque o `biome check` workspace-wide detecta normalização de fim de linha/formatting já espalhada pela base, incluindo arquivos fora desta onda. Não foi feita uma reescrita massiva e fora do escopo. O lint sem formatação, o typecheck, os testes e os builds completos passaram separadamente.
- A geração OpenAPI mantém os aliases `/api/v1` e `/v1`, por isso o cliente C# contém ambas as árvores, conforme o contrato existente.
- Providers de pagamento/fiscal, hardware, credenciais, homologação externa e comportamento de produção não foram exercitados nem alegados.
- Nenhum merge, push ou deploy foi realizado.
