# src-business

## Overview

Directory-based community: packages/domain

- **Size**: 79 nodes
- **Cohesion**: 0.4149
- **Dominant Language**: typescript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| BillingState | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/billing.ts | 12-12 |
| BillingEvent | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/billing.ts | 13-22 |
| AccessMode | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/billing.ts | 40-40 |
| transitionBilling | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/billing.ts | 42-46 |
| billingAccess | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/billing.ts | 48-60 |
| CommercialPlanSlug | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/commercial.ts | 87-87 |
| getCommercialPlan | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/commercial.ts | 89-91 |
| describe:critical domain rules@L13 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/domain.test.ts | 13-121 |
| it:calculates establishment hours in the unit timezone@L14 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/domain.test.ts | 14-32 |
| it:supports overnight periods, open24h and exception precedence@L34 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/domain.test.ts | 34-71 |
| it:allows only declared billing transitions@L73 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/domain.test.ts | 73-77 |
| it:opens a fourteen day trial only after activation@L79 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/domain.test.ts | 79-82 |
| it:restricts expired tenants but preserves a bounded shift closure@L84 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/domain.test.ts | 84-94 |
| it:requires every activation gate@L96 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/domain.test.ts | 96-107 |
| it:keeps owner universal and staff scoped@L109 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/domain.test.ts | 109-120 |
| describe:includesDoseClubEntitlement@L5 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/doseclub.test.ts | 5-12 |
| it:aceita somente o entitlement explícito ou aliases legados@L6 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/doseclub.test.ts | 6-11 |
| describe:doseClubManagedCredential@L14 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/doseclub.test.ts | 14-24 |
| it:derives a stable tenant credential without persisting the token@L15 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/doseclub.test.ts | 15-23 |
| includesDoseClubEntitlement | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/doseclub.ts | 5-10 |
| doseClubManagedCredential | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/doseclub.ts | 12-22 |
| BusinessHoursPeriod | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 1-5 |
| BusinessHoursRule | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 7-10 |
| BusinessHours | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 12-15 |
| BusinessOpenState | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 17-20 |
| localParts | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 32-46 |
| previousDate | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 48-52 |
| weekdayForDate | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 54-57 |
| minutes | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 59-61 |
| ruleForDate | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 63-68 |
| ruleIsOpen | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 70-78 |
| previousRuleIsOpen | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 80-85 |
| isOpenAt | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 87-99 |
| getBusinessOpenState | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts | 101-129 |
| describe:floor geometry@L10 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.test.ts | 10-74 |
| it:rotates around the rectangle center@L11 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.test.ts | 11-15 |
| it:detects overlap but allows edge touching@L17 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.test.ts | 17-23 |
| it:validates room bounds and barriers@L25 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.test.ts | 25-46 |
| it:rejects an edge that crosses the cutout of a concave room@L48 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.test.ts | 48-73 |
| FloorPoint | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.ts | 1-1 |
| FloorRectangle | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.ts | 3-9 |
| dot | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.ts | 11-13 |
| rotatedRectangleCorners | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.ts | 15-32 |
| pointInPolygon | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.ts | 34-57 |
| polygonContainsPolygon | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.ts | 59-82 |
| orientation | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.ts | 64-65 |
| convexPolygonsOverlap | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.ts | 84-101 |
| floorPlacementConflicts | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.ts | 103-119 |
| ActivationChecklist | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/onboarding.ts | 17-17 |
| missingActivationItems | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/onboarding.ts | 19-21 |

*... and 29 more members.*

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `equal` (62 edge(s))
- `from` (10 edge(s))
- `some` (7 edge(s))
- `update` (6 edge(s))
- `throws` (5 edge(s))
- `repeat` (5 edge(s))
- `toString` (5 edge(s))
- `deepEqual` (4 edge(s))
- `digest` (4 edge(s))
- `map` (4 edge(s))
- `every` (4 edge(s))
- `min` (4 edge(s))
- `max` (4 edge(s))
- `toISOString` (3 edge(s))
- `trim` (3 edge(s))

### Incoming

- `equal` (62 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/establishment-hours.ts` (13 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/floor-geometry.ts` (9 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/billing.ts` (7 edge(s))
- `throws` (5 edge(s))
- `repeat` (5 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/permissions.ts` (5 edge(s))
- `deepEqual` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/permissions.test.ts` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/secret-envelope.ts` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/whatsapp.ts` (4 edge(s))
- `every` (3 edge(s))
- `ok` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/onboarding.ts` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/domain/src/commercial.ts` (2 edge(s))
