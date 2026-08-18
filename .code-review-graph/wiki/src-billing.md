# src-billing

## Overview

Directory-based community: packages/domain/src

- **Size**: 18 nodes
- **Cohesion**: 0.3333
- **Dominant Language**: typescript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| transitionBilling | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\billing.ts | 42-46 |
| billingAccess | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\billing.ts | 48-60 |
| getCommercialPlan | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\commercial.ts | 89-91 |
| missingActivationItems | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\onboarding.ts | 19-21 |
| trialWindow | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\onboarding.ts | 23-27 |
| describe:secret envelope@L5 | Test | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\secret-envelope.test.ts | 5-21 |
| it:round-trips a secret and binds it to associated data@L6 | Test | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\secret-envelope.test.ts | 6-12 |
| it:rejects keys that are missing or not 32 bytes@L14 | Test | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\secret-envelope.test.ts | 14-20 |
| encryptionKey | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\secret-envelope.ts | 9-14 |
| encryptSecret | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\secret-envelope.ts | 16-30 |
| decryptSecret | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\secret-envelope.ts | 32-40 |

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `from` (6 edge(s))
- `toString` (5 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\domain.test.ts::it:allows only declared billing transitions@L12` (3 edge(s))
- `throws` (3 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\domain.test.ts::it:restricts expired tenants but preserves a bounded shift closure@L23` (2 edge(s))
- `alloc` (2 edge(s))
- `setAAD` (2 edge(s))
- `concat` (2 edge(s))
- `update` (2 edge(s))
- `final` (2 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\commercial.ts::COMMERCIAL_PLANS.find` (1 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\onboarding.ts::REQUIRED_ACTIVATION_ITEMS.filter` (1 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\domain.test.ts::it:requires every activation gate@L35` (1 edge(s))
- `setUTCDate` (1 edge(s))
- `getUTCDate` (1 edge(s))

### Incoming

- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\domain.test.ts::it:allows only declared billing transitions@L12` (3 edge(s))
- `throws` (3 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\secret-envelope.ts` (3 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\billing.ts` (2 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\domain.test.ts::it:restricts expired tenants but preserves a bounded shift closure@L23` (2 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\onboarding.ts` (2 edge(s))
- `alloc` (2 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\commercial.ts` (1 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\domain.test.ts::it:requires every activation gate@L35` (1 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\domain.test.ts::it:opens a fourteen day trial only after activation@L18` (1 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\packages\domain\src\secret-envelope.test.ts` (1 edge(s))
- `toString` (1 edge(s))
- `equal` (1 edge(s))
