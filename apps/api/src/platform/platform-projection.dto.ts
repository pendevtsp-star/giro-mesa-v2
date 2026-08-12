import { ApiProperty, getSchemaPath } from "@nestjs/swagger";

export class PlatformProjectionUnitResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty() declare name: string;
  @ApiProperty() declare active: boolean;
  @ApiProperty() declare timezone: string;
}

export class PlatformTenantProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty() declare name: string;
  @ApiProperty() declare billingState: string;
  @ApiProperty({ format: "date-time" }) declare updatedAt: string;
  @ApiProperty({ type: () => [PlatformProjectionUnitResponse] })
  declare units: PlatformProjectionUnitResponse[];
}

export class PlatformPlanProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty({ format: "uuid" }) declare planId: string;
  @ApiProperty() declare slug: string;
  @ApiProperty() declare name: string;
  @ApiProperty({ type: "integer" }) declare selectionRevision: number;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  declare selectedAt: string | null;
}

export class PlatformEntitlementProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty() declare entitlement: string;
  @ApiProperty() declare state: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  declare activatedAt: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  declare revokedAt: string | null;
}

export class PlatformUserRoleProjectionResponse {
  @ApiProperty() declare role: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare unitId: string | null;
}

export class PlatformUserProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty({ format: "uuid" }) declare membershipId: string;
  @ApiProperty({ format: "uuid" }) declare identityId: string;
  @ApiProperty() declare displayName: string;
  @ApiProperty() declare email: string;
  @ApiProperty() declare status: string;
  @ApiProperty({ type: () => [PlatformUserRoleProjectionResponse] })
  declare roles: PlatformUserRoleProjectionResponse[];
}

export class PlatformOnboardingChecklistProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty({ enum: ["checklist"] }) declare kind: "checklist";
  @ApiProperty() declare item: string;
  @ApiProperty() declare status: string;
  @ApiProperty() declare source: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  declare verifiedAt: string | null;
}

export class PlatformOnboardingProvisioningProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty({ enum: ["provisioning"] }) declare kind: "provisioning";
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty() declare state: string;
  @ApiProperty() declare checkpoint: string;
  @ApiProperty({ type: String, nullable: true }) declare lastErrorCode: string | null;
  @ApiProperty({ format: "date-time" }) declare updatedAt: string;
}

export class PlatformBillingProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty({ format: "uuid" }) declare planId: string;
  @ApiProperty() declare cycle: string;
  @ApiProperty() declare state: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  declare currentPeriodEndsAt: string | null;
  @ApiProperty({ format: "date-time" }) declare updatedAt: string;
}

export class PlatformIntegrationProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare unitId: string | null;
  @ApiProperty() declare provider: string;
  @ApiProperty() declare status: string;
  @ApiProperty({ format: "date-time" }) declare updatedAt: string;
}

export class PlatformAuditProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty() declare action: string;
  @ApiProperty() declare entityType: string;
  @ApiProperty({ type: String, nullable: true }) declare entityId: string | null;
  @ApiProperty({ format: "date-time" }) declare occurredAt: string;
}

export class PlatformLeadProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty() declare displayName: string;
  @ApiProperty() declare email: string;
  @ApiProperty() declare phone: string;
  @ApiProperty() declare businessName: string;
  @ApiProperty({ type: String, nullable: true }) declare segment: string | null;
  @ApiProperty() declare planSlug: string;
  @ApiProperty({ format: "date-time" }) declare submittedAt: string;
  @ApiProperty({ enum: ["unavailable"] }) declare actionAvailability: "unavailable";
  @ApiProperty({ enum: ["LEAD_WORKFLOW_NOT_AVAILABLE"] })
  declare actionReasonCode: "LEAD_WORKFLOW_NOT_AVAILABLE";
}

export class PlatformSupportProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty() declare displayName: string;
  @ApiProperty() declare email: string;
  @ApiProperty() declare phone: string;
  @ApiProperty({ format: "date-time" }) declare submittedAt: string;
  @ApiProperty({ enum: ["unavailable"] }) declare actionAvailability: "unavailable";
  @ApiProperty({ enum: ["SUPPORT_WORKFLOW_NOT_AVAILABLE"] })
  declare actionReasonCode: "SUPPORT_WORKFLOW_NOT_AVAILABLE";
}

export class PlatformIncidentProjectionItemResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty({ format: "uuid" }) declare unitId: string;
  @ApiProperty() declare incidentType: string;
  @ApiProperty({ enum: ["reported", "under_review", "approved", "rejected", "closed"] })
  declare status: string;
  @ApiProperty() declare neutralSummary: string;
  @ApiProperty({ type: "integer", minimum: 0, maximum: 2_147_483_647, nullable: true })
  declare amountCents: number | null;
  @ApiProperty({ format: "uuid" }) declare reporterIdentityId: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true })
  declare approverIdentityId: string | null;
  @ApiProperty({ format: "date-time" }) declare occurredAt: string;
  @ApiProperty({ format: "date-time" }) declare updatedAt: string;
  @ApiProperty({
    type: [String],
    enum: ["incident.review", "incident.approve", "incident.reject", "incident.close"],
  })
  declare availableActions: string[];
}

class PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["available", "unavailable"] })
  declare availability: "available" | "unavailable";
  @ApiProperty({ required: false }) declare reasonCode?: string;
  @ApiProperty({ type: String, nullable: true }) declare nextCursor: string | null;
}

export class PlatformTenantProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["tenant"] }) declare resource: "tenant";
  @ApiProperty({ type: () => [PlatformTenantProjectionItemResponse] })
  declare items: PlatformTenantProjectionItemResponse[];
}

export class PlatformPlanProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["plan"] }) declare resource: "plan";
  @ApiProperty({ type: () => [PlatformPlanProjectionItemResponse] })
  declare items: PlatformPlanProjectionItemResponse[];
}

export class PlatformEntitlementsProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["entitlements"] }) declare resource: "entitlements";
  @ApiProperty({ type: () => [PlatformEntitlementProjectionItemResponse] })
  declare items: PlatformEntitlementProjectionItemResponse[];
}

export class PlatformUsersProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["users"] }) declare resource: "users";
  @ApiProperty({ type: () => [PlatformUserProjectionItemResponse] })
  declare items: PlatformUserProjectionItemResponse[];
}

export class PlatformOnboardingProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["onboarding"] }) declare resource: "onboarding";
  @ApiProperty({
    type: "array",
    items: {
      oneOf: [
        { $ref: getSchemaPath(PlatformOnboardingChecklistProjectionItemResponse) },
        { $ref: getSchemaPath(PlatformOnboardingProvisioningProjectionItemResponse) },
      ],
      discriminator: {
        propertyName: "kind",
        mapping: {
          checklist: getSchemaPath(PlatformOnboardingChecklistProjectionItemResponse),
          provisioning: getSchemaPath(PlatformOnboardingProvisioningProjectionItemResponse),
        },
      },
    },
  })
  declare items: Array<
    | PlatformOnboardingChecklistProjectionItemResponse
    | PlatformOnboardingProvisioningProjectionItemResponse
  >;
}

export class PlatformBillingProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["billing"] }) declare resource: "billing";
  @ApiProperty({ type: () => [PlatformBillingProjectionItemResponse] })
  declare items: PlatformBillingProjectionItemResponse[];
}

export class PlatformIntegrationsProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["integrations"] }) declare resource: "integrations";
  @ApiProperty({ type: () => [PlatformIntegrationProjectionItemResponse] })
  declare items: PlatformIntegrationProjectionItemResponse[];
}

export class PlatformAuditProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["audit"] }) declare resource: "audit";
  @ApiProperty({ type: () => [PlatformAuditProjectionItemResponse] })
  declare items: PlatformAuditProjectionItemResponse[];
}

export class PlatformLeadsProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["leads"] }) declare resource: "leads";
  @ApiProperty({ type: () => [PlatformLeadProjectionItemResponse] })
  declare items: PlatformLeadProjectionItemResponse[];
}

export class PlatformSupportProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["support"] }) declare resource: "support";
  @ApiProperty({ type: () => [PlatformSupportProjectionItemResponse] })
  declare items: PlatformSupportProjectionItemResponse[];
}

export class PlatformIncidentsProjectionResponse extends PlatformProjectionEnvelopeResponse {
  @ApiProperty({ enum: ["incidents"] }) declare resource: "incidents";
  @ApiProperty({ type: () => [PlatformIncidentProjectionItemResponse] })
  declare items: PlatformIncidentProjectionItemResponse[];
}

export const platformProjectionModels = [
  PlatformProjectionUnitResponse,
  PlatformTenantProjectionItemResponse,
  PlatformPlanProjectionItemResponse,
  PlatformEntitlementProjectionItemResponse,
  PlatformUserRoleProjectionResponse,
  PlatformUserProjectionItemResponse,
  PlatformOnboardingChecklistProjectionItemResponse,
  PlatformOnboardingProvisioningProjectionItemResponse,
  PlatformBillingProjectionItemResponse,
  PlatformIntegrationProjectionItemResponse,
  PlatformAuditProjectionItemResponse,
  PlatformLeadProjectionItemResponse,
  PlatformSupportProjectionItemResponse,
  PlatformIncidentProjectionItemResponse,
  PlatformTenantProjectionResponse,
  PlatformPlanProjectionResponse,
  PlatformEntitlementsProjectionResponse,
  PlatformUsersProjectionResponse,
  PlatformOnboardingProjectionResponse,
  PlatformBillingProjectionResponse,
  PlatformIntegrationsProjectionResponse,
  PlatformAuditProjectionResponse,
  PlatformLeadsProjectionResponse,
  PlatformSupportProjectionResponse,
  PlatformIncidentsProjectionResponse,
] as const;

const projectionByResource = {
  tenant: PlatformTenantProjectionResponse,
  plan: PlatformPlanProjectionResponse,
  entitlements: PlatformEntitlementsProjectionResponse,
  users: PlatformUsersProjectionResponse,
  onboarding: PlatformOnboardingProjectionResponse,
  billing: PlatformBillingProjectionResponse,
  integrations: PlatformIntegrationsProjectionResponse,
  audit: PlatformAuditProjectionResponse,
  leads: PlatformLeadsProjectionResponse,
  support: PlatformSupportProjectionResponse,
  incidents: PlatformIncidentsProjectionResponse,
} as const;

export const platformProjectionResponseSchema = {
  oneOf: Object.values(projectionByResource).map((model) => ({ $ref: getSchemaPath(model) })),
  discriminator: {
    propertyName: "resource",
    mapping: Object.fromEntries(
      Object.entries(projectionByResource).map(([resource, model]) => [
        resource,
        getSchemaPath(model),
      ]),
    ),
  },
};

export const platformGlobalProjectionResponseSchema = {
  oneOf: [PlatformLeadsProjectionResponse, PlatformSupportProjectionResponse].map((model) => ({
    $ref: getSchemaPath(model),
  })),
  discriminator: {
    propertyName: "resource",
    mapping: {
      leads: getSchemaPath(PlatformLeadsProjectionResponse),
      support: getSchemaPath(PlatformSupportProjectionResponse),
    },
  },
};

export function closePlatformProjectionSchemas(schemas: Record<string, unknown>) {
  for (const model of platformProjectionModels) {
    const schema = schemas[model.name];
    if (schema && typeof schema === "object" && !Array.isArray(schema))
      Object.assign(schema, { additionalProperties: false });
  }
}
