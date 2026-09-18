# management-input

## Overview

Directory-based community: apps/backends

- **Size**: 4006 nodes
- **Cohesion**: 0.2163
- **Dominant Language**: typescript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
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
| beginMfaSetup | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 370-402 |
| confirmMfaSetup | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 404-458 |
| disableMfa | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 460-504 |
| authenticate | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 506-527 |
| verifyStepUp | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 529-591 |
| revoke | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 593-605 |
| assertCanEndOperation | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 607-636 |
| me | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 638-676 |
| requestPasswordReset | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 678-710 |
| confirmPasswordReset | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 712-775 |
| consumeComparablePasswordWork | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 777-780 |
| beginIdentitySession | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/auth/auth.service.ts | 782-834 |

*... and 1977 more members.*

## Execution Flows

- **googleCallback** (criticality: 0.90, depth: 4)
- **create** (criticality: 0.84, depth: 4)
- **tableSessionStatus** (criticality: 0.84, depth: 3)
- **login** (criticality: 0.83, depth: 4)
- **close** (criticality: 0.81, depth: 2)
- **consumption** (criticality: 0.80, depth: 4)
- **verifyMfaChallenge** (criticality: 0.80, depth: 4)
- **tableSession** (criticality: 0.80, depth: 4)
- **verifyOAuthMfa** (criticality: 0.79, depth: 4)
- **assignPersonUnitAccess** (criticality: 0.79, depth: 7)
- *... and 122 more flows.*

## Dependencies

### Outgoing

- `eq` (1174 edge(s))
- `equal` (694 edge(s))
- `where` (670 edge(s))
- `from` (524 edge(s))
- `values` (467 edge(s))
- `insert` (431 edge(s))
- `select` (422 edge(s))
- `and` (345 edge(s))
- `Param` (277 edge(s))
- `returning` (271 edge(s))
- `ParseUUIDPipe` (271 edge(s))
- `limit` (251 edge(s))
- `ok` (226 edge(s))
- `map` (218 edge(s))
- `Equal` (198 edge(s))

### Incoming

- `equal` (690 edge(s))
- `values` (229 edge(s))
- `insert` (229 edge(s))
- `ok` (221 edge(s))
- `eq` (197 edge(s))
- `where` (177 edge(s))
- `returning` (166 edge(s))
- `deepEqual` (163 edge(s))
- `randomUUID` (123 edge(s))
- `from` (121 edge(s))
- `select` (100 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/apps/backends/api/src/pilot-operations/pilot-pos.controller.ts` (94 edge(s))
- `rejects` (74 edge(s))
- `safeParse` (73 edge(s))
- `delete` (67 edge(s))
