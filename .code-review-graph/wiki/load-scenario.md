# load-scenario

## Overview

Directory-based community: load

- **Size**: 16 nodes
- **Cohesion**: 0.0488
- **Dominant Language**: javascript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| multitenantScenario | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-multitenant.js | 20-31 |
| operationalScenario | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-operational.js | 18-27 |
| publicQrScenario | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-public-qr.js | 18-22 |
| executable | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 63-65 |
| command | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 67-112 |
| waitForPostgres | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 114-129 |
| applicationUrl | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 131-136 |
| provisionFixtures | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 138-213 |
| ensureMigrationOwner | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 215-225 |
| verifyOperationalEffects | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 227-244 |
| startApi | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 246-265 |
| fixture | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 267-281 |
| runK6 | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 283-320 |
| containerExists | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 322-334 |
| ensureContainerAbsent | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 336-345 |
| removeAndConfirm | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs | 347-356 |

## Execution Flows

- **publicQrScenario** (criticality: 0.69, depth: 2)

## Dependencies

### Outgoing

- `sql` (9 edge(s))
- `unsafe` (5 edge(s))
- `join` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/k6-runtime.js::runRequests` (3 edge(s))
- `sleep` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/local-smoke-runtime.js::throwIfInterrupted` (3 edge(s))
- `createDatabase` (3 edge(s))
- `end` (3 edge(s))
- `replaceAll` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::fixtureTenantSlot` (2 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::pickFixtureTenant` (2 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::executionContext` (2 edge(s))
- `toString` (2 edge(s))
- `setEncoding` (2 edge(s))
- `on` (2 edge(s))

### Incoming

- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs` (27 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-multitenant.js` (1 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-operational.js` (1 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-public-qr.js` (1 edge(s))
