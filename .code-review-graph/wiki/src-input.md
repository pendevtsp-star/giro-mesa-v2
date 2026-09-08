# src-input

## Overview

Directory-based community: packages/contracts

- **Size**: 133 nodes
- **Cohesion**: 0.7125
- **Dominant Language**: typescript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| describe:public contracts@L40 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 40-594 |
| it:validates structured establishment hours and IANA timezones@L41 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 41-64 |
| it:rejects overlapping hours, duplicate exceptions and copy targets@L66 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 66-130 |
| it:normalizes identity email and rejects weak passwords@L132 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 132-147 |
| it:keeps CNPJ and command identity strict@L149 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 149-178 |
| it:keeps table QR settings, print lifecycle and pre-tab sessions strict@L180 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 180-248 |
| it:requires release identity and declared API capabilities@L250 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 250-267 |
| it:accepts only HTTPS Web Push subscriptions with browser key sizes@L269 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 269-290 |
| it:accepts the delivery operator role@L292 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 292-307 |
| it:publishes canonical operational capabilities with legacy aliases@L309 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 309-318 |
| it:keeps billing summaries and hosted checkout intents explicit@L320 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 320-406 |
| it:adapts the actual marketing forms at the API boundary@L408 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 408-476 |
| it:allows only pay-on-fulfillment and enforces fulfillment-specific address data@L478 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 478-511 |
| it:keeps QR table commands and order drafts strict@L513 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 513-537 |
| it:validates normalized delivery coordinates@L539 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 539-556 |
| it:keeps delivery courier and notification commands strict and idempotent@L558 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts | 558-593 |
| describe:SmartPOS contracts@L10 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/smartpos-contracts.test.ts | 10-148 |
| it:accepts only valid integrated payment requests@L11 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/smartpos-contracts.test.ts | 11-31 |
| it:requires a provider reference and rejects card data on approval@L33 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/smartpos-contracts.test.ts | 33-84 |
| it:rejects card data in provider reconciliation identifiers@L86 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/smartpos-contracts.test.ts | 86-128 |
| it:requires an internal certification before integrated capabilities are enabled@L130 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/smartpos-contracts.test.ts | 130-147 |
| ApiCapability | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 47-47 |
| ApiHealthResponse | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 48-48 |
| OperationalPushSubscription | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 76-76 |
| OperationalPushConfig | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 77-77 |
| overlappingPeriodIndex | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 156-175 |
| HoursRule | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 264-264 |
| hoursRuleIntervals | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 266-277 |
| BusinessHoursPeriod | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 464-464 |
| BusinessHoursDay | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 465-465 |
| BusinessHoursException | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 466-466 |
| BusinessHours | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 467-467 |
| EstablishmentPresentation | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 468-468 |
| EstablishmentSettings | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 469-469 |
| UpdateOrganizationSettingsInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 470-470 |
| UpdateUnitSettingsInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 471-471 |
| CopyUnitSettingsInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 472-472 |
| EstablishmentSettingsHistoryEntry | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 473-475 |
| RestoreEstablishmentSettingsInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 476-476 |
| EstablishmentSpecializedSettingsSummary | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 477-479 |
| PrintDocumentPayloadV2 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 481-565 |
| KdsTicketPrintPayloadV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 807-831 |
| PrintJobExecuteCommandV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 833-842 |
| PrinterConfigurationCommandV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 844-861 |
| PrinterConfigurationArchiveCommandV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 863-866 |
| PrinterTestCommandV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 868-871 |
| PrinterConnectionProbeCommandV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 873-876 |
| CloudCommandResult | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 878-912 |
| ProductionDeliveryMode | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 914-914 |
| ProductionPrintPolicyInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 915-915 |

*... and 83 more members.*

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `equal` (74 edge(s))
- `safeParse` (61 edge(s))
- `parse` (13 edge(s))
- `randomUUID` (12 edge(s))
- `toISOString` (6 edge(s))
- `Number` (6 edge(s))
- `slice` (5 edge(s))
- `deepEqual` (4 edge(s))
- `from` (3 edge(s))
- `getTime` (2 edge(s))
- `map` (2 edge(s))
- `repeat` (1 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts::BusinessHours.map` (1 edge(s))
- `matchAll` (1 edge(s))
- `replace` (1 edge(s))

### Incoming

- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts` (117 edge(s))
- `equal` (74 edge(s))
- `safeParse` (61 edge(s))
- `parse` (13 edge(s))
- `randomUUID` (12 edge(s))
- `toISOString` (6 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/generated-api.ts` (5 edge(s))
- `deepEqual` (4 edge(s))
- `from` (3 edge(s))
- `getTime` (2 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/contracts.test.ts` (1 edge(s))
- `repeat` (1 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts::BusinessHours.map` (1 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/smartpos-contracts.test.ts` (1 edge(s))
