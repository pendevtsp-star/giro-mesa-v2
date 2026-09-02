# lib-fixture

## Overview

Directory-based community: load/lib

- **Size**: 27 nodes
- **Cohesion**: 0.1066
- **Dominant Language**: javascript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| thresholds | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 18-32 |
| profileRequirements | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 34-50 |
| buildK6Options | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 52-107 |
| parseLoadFixture | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 109-138 |
| executionContext | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 140-159 |
| publicBaseUrl | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 161-183 |
| fixturePath | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 185-191 |
| pickFixtureTenant | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 193-196 |
| fixtureTenantSlot | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 198-203 |
| assertProfile | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 205-207 |
| parseTenant | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 209-260 |
| rejectUnknownFields | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 262-266 |
| isRecord | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js | 268-270 |
| pilotPath | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/journeys.js | 1-3 |
| operationalRequests | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/journeys.js | 5-36 |
| publicQrRequests | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/journeys.js | 38-48 |
| multitenantRequests | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/journeys.js | 50-74 |
| runRequests | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/k6-runtime.js | 6-37 |
| expectedResponseCallback | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/k6-runtime.js | 39-46 |
| assertOperationalEffects | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/local-smoke-runtime.js | 3-33 |
| createInterruptionController | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/local-smoke-runtime.js | 35-80 |
| interrupt | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/local-smoke-runtime.js | 40-49 |
| listener | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/local-smoke-runtime.js | 52-52 |
| track | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/local-smoke-runtime.js | 58-68 |
| throwIfInterrupted | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/local-smoke-runtime.js | 69-73 |
| dispose | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/local-smoke-runtime.js | 74-78 |
| settleAfterCleanup | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/local-smoke-runtime.js | 82-94 |

## Execution Flows

- **publicQrScenario** (criticality: 0.69, depth: 2)

## Dependencies

### Outgoing

- `test` (9 edge(s))
- `isArray` (6 edge(s))
- `has` (5 edge(s))
- `map` (5 edge(s))
- `toLowerCase` (5 edge(s))
- `isInteger` (4 edge(s))
- `includes` (3 edge(s))
- `push` (3 edge(s))
- `add` (3 edge(s))
- `trim` (2 edge(s))
- `every` (2 edge(s))
- `exec` (2 edge(s))
- `get` (2 edge(s))
- `set` (2 edge(s))
- `clear` (2 edge(s))

### Incoming

- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-config.test.mjs` (26 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js` (13 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/journeys.test.mjs` (10 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/local-smoke-runtime.js` (8 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.test.mjs` (8 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-multitenant.js::multitenantScenario` (5 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs` (5 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-public-qr.js` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-operational.js::operationalScenario` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/journeys.js` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-multitenant.js` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-operational.js` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-public-qr.js::publicQrScenario` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs::command` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/k6-runtime.js` (2 edge(s))
