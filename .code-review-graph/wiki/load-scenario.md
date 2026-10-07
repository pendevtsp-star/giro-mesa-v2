# load-scenario

## Overview

Directory-based community: load

- **Size**: 41 nodes
- **Cohesion**: 0.0656
- **Dominant Language**: javascript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| sessionCookie | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs | 43-49 |
| jsonRequest | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs | 51-74 |
| authJsonRequest | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs | 76-95 |
| percentile | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs | 97-101 |
| wait | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs | 103-103 |
| dropCommittedResponse | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs | 105-157 |
| main | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs | 159-409 |
| cookie | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs | 389-389 |
| measured | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs | 276-297 |
| durationMs | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs | 346-346 |
| it:models a real operational read/open/read journey with bounded tags@L23 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/journeys.test.mjs | 23-51 |
| it:opens each table once and then keeps the steady-state journey read-only@L53 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/journeys.test.mjs | 53-64 |
| it:assigns exclusive tables to the second wave of operational spike VUs@L66 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/journeys.test.mjs | 66-84 |
| it:models public QR sessions without credentials or tenant tags@L86 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/journeys.test.mjs | 86-96 |
| it:models a negative cross-tenant probe that only accepts forbidden or not-found@L98 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/journeys.test.mjs | 98-116 |
| it:keeps secrets outside journey descriptors@L118 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/journeys.test.mjs | 118-125 |
| it:builds a light smoke profile and explicit reliability thresholds@L33 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-config.test.mjs | 33-55 |
| it:models the approved target, two-times spike and soak without running them@L57 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-config.test.mjs | 57-82 |
| it:requires the full 500-table, 50-terminal and 2000-QR target fixture per unit@L84 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-config.test.mjs | 84-118 |
| it:loads cookies only from named environment entries and never exposes them as metadata@L120 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-config.test.mjs | 120-169 |
| it:selects fixture tenants deterministically without adding tenant IDs to metric tags@L171 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-config.test.mjs | 171-192 |
| it:resolves fixtures inside the load directory and rejects path traversal@L194 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-config.test.mjs | 194-201 |
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
| it:requires one open tab on the expected table for every smoke tenant@L25 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.test.mjs | 25-62 |
| it:turns SIGINT and SIGTERM into fail-closed interruption and terminates active children@L64 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.test.mjs | 64-77 |
| it:publishes success only after cleanup and fails closed when cleanup fails@L79 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.test.mjs | 79-98 |

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `deepEqual` (22 edge(s))
- `stringify` (15 edge(s))
- `map` (11 edge(s))
- `equal` (11 edge(s))
- `now` (9 edge(s))
- `sql` (9 edge(s))
- `filter` (8 edge(s))
- `push` (7 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/journeys.js::operationalRequests` (7 edge(s))
- `throws` (7 edge(s))
- `join` (6 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::buildK6Options` (6 edge(s))
- `fetch` (5 edge(s))
- `slice` (5 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::executionContext` (5 edge(s))

### Incoming

- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/local-smoke.mjs` (27 edge(s))
- `deepEqual` (22 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/f1-local.mjs` (13 edge(s))
- `equal` (11 edge(s))
- `throws` (7 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/journeys.test.mjs` (6 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/journeys.js::operationalRequests` (6 edge(s))
- `stringify` (6 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/k6-config.test.mjs` (6 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::buildK6Options` (6 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::parseLoadFixture` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::executionContext` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::publicBaseUrl` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::fixturePath` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/load/lib/config.js::pickFixtureTenant` (3 edge(s))
