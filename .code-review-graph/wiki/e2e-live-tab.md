# e2e-live-tab

## Overview

Directory-based community: tests/e2e-live

- **Size**: 17 nodes
- **Cohesion**: 0.0545
- **Dominant Language**: typescript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| test:abre, movimenta e fecha um caixa pela UI com API e PostgreSQL reais@L5 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/cash-live.spec.ts | 5-77 |
| idempotencyHeaders | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/counter-live-fixture.mjs | 13-15 |
| request | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/counter-live-fixture.mjs | 16-32 |
| entityId | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/counter-live-fixture.mjs | 33-37 |
| openOrderTab | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/counter-live-fixture.mjs | 193-206 |
| prepareAndReadyKds | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/counter-live-fixture.mjs | 208-232 |
| transitionDelivery | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/counter-live-fixture.mjs | 296-301 |
| responseJson | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/fixtures/live-salon.ts | 3-8 |
| createLiveSalonFixture | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/fixtures/live-salon.ts | 10-142 |
| json | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/salon-live.spec.ts | 5-10 |
| test:opera, unifica, divide e imprime com API compilada e PostgreSQL reais@L12 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/salon-live.spec.ts | 12-206 |
| openTable | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/salon-live.spec.ts | 144-152 |
| RelatedTab | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/unified-service-live.spec.ts | 7-13 |
| TabDetail | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/unified-service-live.spec.ts | 15-26 |
| noHorizontalOverflow | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/unified-service-live.spec.ts | 28-34 |
| payCurrentAccount | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/unified-service-live.spec.ts | 36-42 |
| test:separa duas contas na mesma mesa, imprime sem falso positivo e encerra somente no final@L44 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/unified-service-live.spec.ts | 44-249 |

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `getByRole` (70 edge(s))
- `expect` (61 edge(s))
- `click` (51 edge(s))
- `toBeVisible` (28 edge(s))
- `post` (22 edge(s))
- `get` (17 edge(s))
- `getByText` (15 edge(s))
- `locator` (13 edge(s))
- `toBe` (12 edge(s))
- `filter` (12 edge(s))
- `getByLabel` (11 edge(s))
- `slice` (10 edge(s))
- `randomUUID` (10 edge(s))
- `map` (9 edge(s))
- `fill` (8 edge(s))

### Incoming

- `C:/Users/maxue/projetos_programação/giro_mesa_v2/tests/e2e-live/counter-live-fixture.mjs` (69 edge(s))
- `getByRole` (66 edge(s))
- `expect` (54 edge(s))
- `click` (48 edge(s))
- `toBeVisible` (26 edge(s))
- `getByText` (15 edge(s))
- `get` (13 edge(s))
- `post` (12 edge(s))
- `locator` (11 edge(s))
- `toBe` (10 edge(s))
- `getByLabel` (10 edge(s))
- `filter` (10 edge(s))
- `map` (9 edge(s))
- `fill` (8 edge(s))
- `slice` (6 edge(s))
