# src-input

## Overview

Directory-based community: packages/contracts

- **Size**: 131 nodes
- **Cohesion**: 0.7126
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
| BusinessHoursPeriod | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 455-455 |
| BusinessHoursDay | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 456-456 |
| BusinessHoursException | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 457-457 |
| BusinessHours | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 458-458 |
| EstablishmentPresentation | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 459-459 |
| EstablishmentSettings | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 460-460 |
| UpdateOrganizationSettingsInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 461-461 |
| UpdateUnitSettingsInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 462-462 |
| CopyUnitSettingsInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 463-463 |
| EstablishmentSettingsHistoryEntry | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 464-466 |
| RestoreEstablishmentSettingsInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 467-467 |
| EstablishmentSpecializedSettingsSummary | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 468-470 |
| PrintDocumentPayloadV2 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 472-556 |
| KdsTicketPrintPayloadV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 776-800 |
| PrintJobExecuteCommandV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 802-811 |
| PrinterConfigurationCommandV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 813-830 |
| PrinterConfigurationArchiveCommandV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 832-835 |
| PrinterTestCommandV1 | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 837-840 |
| CloudCommandResult | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 842-870 |
| ProductionDeliveryMode | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 872-872 |
| ProductionPrintPolicyInput | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 873-873 |
| ProductionPrinterDocumentType | Class | C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts | 874-874 |

*... and 81 more members.*

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

- `C:/Users/maxue/projetos_programação/giro_mesa_v2/packages/contracts/src/index.ts` (115 edge(s))
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
