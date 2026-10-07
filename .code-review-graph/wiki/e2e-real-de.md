# e2e-real-de

## Overview

Directory-based community: tests/e2e-real

- **Size**: 192 nodes
- **Cohesion**: 0.0418
- **Dominant Language**: typescript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| mockCompatibleApiHealth | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/api-health-mock.ts | 3-28 |
| mockCashApi | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 36-226 |
| json | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 57-57 |
| test:caixa sem gavetas orienta cadastro sem alegar falta de permissão (canOpen=${canOpen})@L229 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 229-246 |
| test:caixa distingue gaveta inativa de falta de permissão para abrir turno@L249 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 249-257 |
| test:caixa mantém aviso de permissão quando uma gaveta existe e o perfil não pode abrir@L259 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 259-267 |
| test:caixa separa turno, extrato, histórico e configurações por tarefa@L269 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 269-322 |
| test:caixa abre ações em uma única janela e preserva a contagem (${width}px)@L325 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 325-366 |
| test:erro de movimento permanece no modal com os campos preenchidos e valores em centavos@L369 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 369-388 |
| test:detalhes e comprovante do histórico compartilham a mesma janela@L390 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 390-416 |
| test:resultado do fechamento não acompanha a troca de gaveta@L418 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 418-445 |
| test:responsável pelo turno recebe orientação sem ação de autorevisão@L447 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 447-454 |
| test:rejeição de duplo controle orienta outro gestor e impede repetir a revisão@L456 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/cash-workspace.spec.ts | 456-477 |
| RecipeInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/catalog-inventory-recipe.spec.ts | 4-12 |
| mockCatalogInventory | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/catalog-inventory-recipe.spec.ts | 14-201 |
| openCatalog | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/catalog-inventory-recipe.spec.ts | 203-209 |
| test:ficha opcional salva, recupera e desativa com confirmação e retry em 375 px@L211 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/catalog-inventory-recipe.spec.ts | 211-297 |
| test:revenda separa saldo físico, saldo disponível e limite diário em 385 px@L299 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/catalog-inventory-recipe.spec.ts | 299-317 |
| mockCatalogApi | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/catalog-prices.spec.ts | 5-123 |
| test:Cardápio recolhe Mais ações e abre os cadastros pelo topo@L125 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/catalog-prices.spec.ts | 125-158 |
| test:Cardápio distingue preços por canal, herança e zero em 375 px e preserva payload e rollback@L160 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/catalog-prices.spec.ts | 160-236 |
| test:Cardápio vincula revenda ao estoque e preserva seleção após falha@L238 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/catalog-prices.spec.ts | 238-299 |
| test:Editor do Cardápio preserva delivery zero e contém preços em 375 px@L301 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/catalog-prices.spec.ts | 301-331 |
| CreateBehavior | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 30-30 |
| CounterCalls | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 31-31 |
| mockCounterApi | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 33-242 |
| openCounter | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 244-250 |
| addAndSend | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 252-258 |
| test:fila abre o formulário em modal após escolher o tipo e preserva campos ao cancelar@L260 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 260-321 |
| test:atalho de nova comanda abre o seletor sem enviar e preserva o alvo existente@L323 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 323-356 |
| test:retoma após timeout e recarga com a mesma idempotência@L358 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 358-376 |
| test:avisa estoque sem expor dados internos e envia somente após confirmação em 375 px@L378 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 378-398 |
| test:voltar do aviso de estoque não envia nem duplica o pedido@L400 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 400-413 |
| expectNoHorizontalOverflow | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 415-421 |
| expectControlsContained | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 423-452 |
| test:mantém os campos da abertura contidos na coluna operacional estreita@L454 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 454-474 |
| test:troca de painel preserva cabeçalho e deixa o fim de cada fluxo alcançável@L476 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 476-567 |
| test:retorna a fila preservando rascunho, filtros, foco e tema@L569 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 569-654 |
| test:libera o rascunho quando a API rejeita a criação definitivamente@L656 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/counter-continuity.spec.ts | 656-670 |
| test:visor do cliente acompanha a conta sem expor a operação@L9 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/customer-display.spec.ts | 9-152 |
| mockDashboardApi | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/dashboard-production.spec.ts | 18-299 |
| test:back office cadastra e pesquisa tenant, trata incidentes e explicita dados parciais@L301 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/dashboard-production.spec.ts | 301-621 |
| test:prioridades mostram a fila completa e filtram responsáveis em claro, escuro e celular@L623 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/dashboard-production.spec.ts | 623-671 |
| test:prioridades e preferências usam mutações auditáveis@L673 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/dashboard-production.spec.ts | 673-700 |
| test:topbar mantém o relógio alinhado à virada do minuto e à retomada da aba@L702 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/dashboard-production.spec.ts | 702-718 |
| test:passagem de turno preserva ciência após falha e mostra todas as pendências em 375 px@L720 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/dashboard-production.spec.ts | 720-792 |
| test:visão geral real orienta o perfil ${profile.profileId}@L795 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/dashboard-production.spec.ts | 795-852 |
| test:visão geral compacta atalhos, fontes e atividade sem perder os gates do perfil@L855 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/dashboard-production.spec.ts | 855-918 |
| test:visão geral diferencia dados parciais de operação sem pendências@L920 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/dashboard-production.spec.ts | 920-1050 |
| signalAutomaticRefresh | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/dashboard-production.spec.ts | 923-923 |

*... and 105 more members.*

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `expect` (808 edge(s))
- `getByRole` (628 edge(s))
- `click` (382 edge(s))
- `toBeVisible` (282 edge(s))
- `locator` (200 edge(s))
- `getByLabel` (188 edge(s))
- `fulfill` (175 edge(s))
- `getByText` (140 edge(s))
- `fill` (128 edge(s))
- `endsWith` (108 edge(s))
- `toBe` (92 edge(s))
- `evaluate` (92 edge(s))
- `toHaveCount` (78 edge(s))
- `toContainText` (75 edge(s))
- `poll` (68 edge(s))

### Incoming

- `expect` (789 edge(s))
- `getByRole` (607 edge(s))
- `click` (369 edge(s))
- `toBeVisible` (275 edge(s))
- `locator` (196 edge(s))
- `getByLabel` (188 edge(s))
- `getByText` (140 edge(s))
- `fill` (128 edge(s))
- `toBe` (86 edge(s))
- `evaluate` (80 edge(s))
- `toHaveCount` (78 edge(s))
- `toContainText` (75 edge(s))
- `poll` (68 edge(s))
- `setViewportSize` (59 edge(s))
- `selectOption` (49 edge(s))
