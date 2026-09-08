# e2e-real-mock

## Overview

Directory-based community: tests/e2e-real

- **Size**: 118 nodes
- **Cohesion**: 0.0396
- **Dominant Language**: typescript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| Calls | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/purchases-production.spec.ts | 49-59 |
| emptyCalls | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/purchases-production.spec.ts | 61-73 |
| mockPurchasesApi | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/purchases-production.spec.ts | 75-393 |
| openPurchases | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/purchases-production.spec.ts | 395-419 |
| expectNoHorizontalOverflow | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/purchases-production.spec.ts | 421-427 |
| test:gerente cria pedido multilinha, aprova, recebe parcialmente e concilia fatura@L429 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/purchases-production.spec.ts | 429-528 |
| test:perfil de estoque vê conciliação e estorno sem ações financeiras@L530 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/purchases-production.spec.ts | 530-553 |
| test:conflito de versão mantém pedido pendente e orienta recarregar@L555 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/purchases-production.spec.ts | 555-571 |
| test:erro do pedido mantém o formulário preenchido@L573 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/purchases-production.spec.ts | 573-592 |
| DeliveryRole | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 87-87 |
| DeliveryCalls | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 88-98 |
| DeliveryMockOptions | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 100-103 |
| emptyCalls | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 105-117 |
| mockDeliveryApi | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 119-303 |
| test@L183 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 183-183 |
| test@L191 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 191-191 |
| test@L198 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 198-198 |
| test@L222 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 222-222 |
| test@L231 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 231-231 |
| test@L249 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 249-249 |
| openDelivery | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 305-319 |
| forceRealtimeFallback | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 321-348 |
| FailingWebSocket | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 323-340 |
| constructor | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 330-333 |
| close | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 335-337 |
| send | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 339-339 |
| forceRealtimeEvent | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 350-407 |
| EventWebSocket | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 352-399 |
| constructor | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 359-365 |
| close | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 367-370 |
| send | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 372-398 |
| expectNoHorizontalOverflow | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 409-419 |
| test:operador visualiza pedidos, abre detalhes e avança uma transição@L421 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 421-475 |
| test:gerente cria, edita e desativa zona de entrega@L477 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 477-549 |
| test:Delivery mantém atualização periódica quando o realtime não conecta@L551 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 551-561 |
| test:operador atribui entregador e exibe notificação confirmada@L563 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 563-596 |
| test:Delivery renderiza evento realtime e rejeita endereço fora da zona@L598 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/delivery-production.spec.ts | 598-637 |
| mockCompatibleApiHealth | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/api-health-mock.ts | 3-28 |
| test:visor do cliente acompanha a conta sem expor a operação@L9 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/customer-display.spec.ts | 9-152 |
| test:terminal compartilhado troca o operador por PIN e volta bloqueado@L6 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/terminal-switch-production.spec.ts | 6-198 |
| terminalView | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/terminal-switch-production.spec.ts | 25-44 |
| CapturedRequest | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/people-production.spec.ts | 129-132 |
| mockPeopleApi | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/people-production.spec.ts | 134-647 |
| test@L219 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/people-production.spec.ts | 219-219 |
| test@L324 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/people-production.spec.ts | 324-324 |
| openPeople | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/people-production.spec.ts | 649-653 |
| test:Pessoas prioriza o resumo e permanece utilizável no mobile@L655 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/people-production.spec.ts | 655-696 |
| test:Pessoas navega, filtra e executa fluxos reais sem diálogos nativos@L698 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/people-production.spec.ts | 698-772 |
| test:Pessoas opera cadastro, lote, escala, espelho e comissão com auditoria@L774 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/people-production.spec.ts | 774-842 |
| test:Pessoas cadastra e administra convite, perfil e suspensão de acesso@L844 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-real/people-production.spec.ts | 844-1003 |

*... and 68 more members.*

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `expect` (620 edge(s))
- `getByRole` (564 edge(s))
- `click` (323 edge(s))
- `toBeVisible` (231 edge(s))
- `locator` (161 edge(s))
- `fulfill` (159 edge(s))
- `getByLabel` (143 edge(s))
- `getByText` (127 edge(s))
- `fill` (94 edge(s))
- `endsWith` (90 edge(s))
- `evaluate` (83 edge(s))
- `toBe` (72 edge(s))
- `postDataJSON` (71 edge(s))
- `setViewportSize` (67 edge(s))
- `request` (58 edge(s))

### Incoming

- `expect` (608 edge(s))
- `getByRole` (554 edge(s))
- `click` (318 edge(s))
- `toBeVisible` (227 edge(s))
- `locator` (159 edge(s))
- `getByLabel` (143 edge(s))
- `getByText` (127 edge(s))
- `fill` (94 edge(s))
- `evaluate` (74 edge(s))
- `setViewportSize` (67 edge(s))
- `toBe` (66 edge(s))
- `toContainText` (56 edge(s))
- `poll` (55 edge(s))
- `toHaveCount` (49 edge(s))
- `first` (45 edge(s))
