# management-input

## Overview

Directory-based community: apps/backends

- **Size**: 4187 nodes
- **Cohesion**: 0.2113
- **Dominant Language**: typescript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| test:exposes OpenAPI only outside production@L16 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.test.ts | 16-20 |
| test:boots the complete Nest application graph@L22 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.test.ts | 22-32 |
| test:isolates operational limits by valid session while strict buckets remain IP based@L34 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.test.ts | 34-155 |
| expectImmediateRealtimeSubscription | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.test.ts | 157-216 |
| resolveSubscription | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.test.ts | 172-172 |
| rejectSubscription | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.test.ts | 173-173 |
| test:accepts an immediate realtime subscription after reconnecting to a restarted app@L218 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.test.ts | 218-289 |
| shouldExposeOpenApi | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.ts | 31-32 |
| createApplication | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.ts | 34-156 |
| document | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.ts | 110-110 |
| validateRealtimeHandshake | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.ts | 115-123 |
| realtimeHandler | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app-factory.ts | 124-139 |
| AppModule | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/app.module.ts | 39-39 |
| it:keeps opaque browser session tokens confined to the HttpOnly cookie@L7 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.test.ts | 7-56 |
| AuthController | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 59-334 |
| constructor | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 60-60 |
| register | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 63-71 |
| login | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 75-86 |
| verifyMfaChallenge | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 90-98 |
| verifyOAuthMfa | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 102-114 |
| mfaStatus | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 118-120 |
| beginMfaSetup | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 124-126 |
| confirmMfaSetup | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 130-139 |
| disableMfa | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 144-149 |
| logout | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 154-162 |
| me | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 166-168 |
| requestReset | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 172-177 |
| confirmReset | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 181-185 |
| googleLogin | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 188-190 |
| googleSignup | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 193-202 |
| googleStart | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 205-216 |
| googlePrepare | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 221-230 |
| googleCallback | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 233-272 |
| googleDisabled | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 274-279 |
| startGoogle | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 281-287 |
| prepareGoogle | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 289-299 |
| googleConfig | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 301-305 |
| siteTarget | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 307-313 |
| absoluteTarget | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 315-329 |
| redirect | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.controller.ts | 331-333 |
| AuthModule | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.module.ts | 13-13 |
| AuthContext | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 50-60 |
| tokenHash | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 62-62 |
| AuthService | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 65-883 |
| constructor | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 66-66 |
| register | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 68-124 |
| login | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 126-145 |
| authenticateGoogle | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 147-229 |
| verifyMfaChallenge | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 231-359 |
| mfaStatus | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 361-368 |

*... and 3517 more members.*

## Execution Flows

- **googleCallback** (criticality: 0.90, depth: 4)
- **tableSessionStatus** (criticality: 0.84, depth: 3)
- **login** (criticality: 0.83, depth: 4)
- **create** (criticality: 0.83, depth: 4)
- **close** (criticality: 0.81, depth: 2)
- **consumption** (criticality: 0.80, depth: 4)
- **verifyMfaChallenge** (criticality: 0.80, depth: 4)
- **tableSession** (criticality: 0.80, depth: 4)
- **verifyOAuthMfa** (criticality: 0.79, depth: 4)
- **assignPersonUnitAccess** (criticality: 0.79, depth: 7)
- *... and 97 more flows.*

## Dependencies

### Outgoing

- `eq` (4174 edge(s))
- `where` (1942 edge(s))
- `equal` (1883 edge(s))
- `from` (1490 edge(s))
- `and` (1287 edge(s))
- `select` (1266 edge(s))
- `values` (1115 edge(s))
- `insert` (1022 edge(s))
- `Param` (912 edge(s))
- `ParseUUIDPipe` (899 edge(s))
- `limit` (726 edge(s))
- `map` (676 edge(s))
- `returning` (660 edge(s))
- `ok` (608 edge(s))
- `set` (476 edge(s))

### Incoming

- `equal` (1879 edge(s))
- `eq` (651 edge(s))
- `ok` (587 edge(s))
- `values` (575 edge(s))
- `insert` (575 edge(s))
- `where` (507 edge(s))
- `returning` (404 edge(s))
- `deepEqual` (349 edge(s))
- `randomUUID` (342 edge(s))
- `from` (327 edge(s))
- `select` (301 edge(s))
- `safeParse` (253 edge(s))
- `rejects` (247 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/pilot-operations/pilot-schemas.ts` (120 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/management/management.schemas.ts` (119 edge(s))
