import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiCreatedResponse, ApiHeader, ApiOkResponse } from "@nestjs/swagger";
import { SessionGuard } from "../auth/session.guard.js";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PlatformAdminGuard, type PlatformRequest } from "./platform.guard.js";
import {
  type CommercialCampaignInput,
  type CommercialDraftCreate,
  type CommercialDraftUpdate,
  type CommercialLeadQuery,
  type CommercialLeadStateInput,
  type CommercialMediaUpload,
  type CommercialPublish,
  type CommercialRollback,
  commercialCampaignSchema,
  commercialDraftCreateSchema,
  commercialDraftUpdateSchema,
  commercialLeadQuerySchema,
  commercialLeadStateSchema,
  commercialMediaUploadSchema,
  commercialPublishSchema,
  commercialRollbackSchema,
  type PlatformIncidentAction,
  type PlatformIncidentQuery,
  type PlatformReasonBody,
  type PlatformTenantRegistration,
  platformIdempotencyKeySchema,
  platformIncidentActionSchema,
  platformIncidentFingerprintSchema,
  platformIncidentQuerySchema,
  platformReasonBodySchema,
  platformTenantRegistrationSchema,
  type TenantDirectoryQuery,
  tenantDirectoryQuerySchema,
} from "./platform.schemas.js";
import { PlatformService } from "./platform.service.js";
import { requirePlatformCapability } from "./platform-access.js";
import { PlatformCommercialService } from "./platform-commercial.service.js";
import {
  maskDocument,
  maskEmail,
  maskName,
  maskPhone,
  PlatformControlService,
} from "./platform-control.service.js";

@UseGuards(SessionGuard, PlatformAdminGuard)
@Controller(["api/v1/platform", "v1/platform"])
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly control: PlatformControlService,
    private readonly commercial: PlatformCommercialService,
  ) {}

  @Get("commercial/overview")
  commercialOverview(@Req() request: PlatformRequest) {
    requirePlatformCapability(request.platformAccess, "commercial:read");
    return this.commercial.overview();
  }

  @Get("commercial/versions/:versionId/preview")
  commercialPreview(
    @Req() request: PlatformRequest,
    @Param("versionId", ParseUUIDPipe) versionId: string,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:read");
    return this.commercial.bundle(versionId);
  }

  @Post("commercial/drafts")
  createCommercialDraft(
    @Req() request: PlatformRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodPipe(commercialDraftCreateSchema)) body: CommercialDraftCreate,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:write");
    return this.commercial.createDraft(request.auth.identityId, idempotencyKey(rawKey), body);
  }

  @Put("commercial/drafts/:versionId")
  updateCommercialDraft(
    @Req() request: PlatformRequest,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodPipe(commercialDraftUpdateSchema)) body: CommercialDraftUpdate,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:write");
    return this.commercial.updateDraft(
      request.auth.identityId,
      versionId,
      idempotencyKey(rawKey),
      body,
    );
  }

  @Post("commercial/versions/:versionId/approve")
  approveCommercialVersion(
    @Req() request: PlatformRequest,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodPipe(platformReasonBodySchema)) body: PlatformReasonBody,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:approve");
    return this.commercial.approve(
      request.auth.identityId,
      versionId,
      idempotencyKey(rawKey),
      body.reason,
    );
  }

  @Post("commercial/versions/:versionId/publish")
  publishCommercialVersion(
    @Req() request: PlatformRequest,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodPipe(commercialPublishSchema)) body: CommercialPublish,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:publish");
    return this.commercial.publish(
      request.auth.identityId,
      versionId,
      idempotencyKey(rawKey),
      body,
    );
  }

  @Post("commercial/rollback")
  rollbackCommercialVersion(
    @Req() request: PlatformRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodPipe(commercialRollbackSchema)) body: CommercialRollback,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:publish");
    return this.commercial.rollback(request.auth.identityId, idempotencyKey(rawKey), body);
  }

  @Post("commercial/media")
  uploadCommercialMedia(
    @Req() request: PlatformRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodPipe(commercialMediaUploadSchema)) body: CommercialMediaUpload,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:media");
    return this.commercial.uploadMedia(request.auth.identityId, idempotencyKey(rawKey), body);
  }

  @Delete("commercial/media/:mediaId")
  deleteCommercialMedia(
    @Req() request: PlatformRequest,
    @Param("mediaId", ParseUUIDPipe) mediaId: string,
    @Body(new ZodPipe(platformReasonBodySchema)) body: PlatformReasonBody,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:media");
    return this.commercial.deleteMedia(request.auth.identityId, mediaId, body.reason);
  }

  @Post("commercial/campaigns")
  createCommercialCampaign(
    @Req() request: PlatformRequest,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodPipe(commercialCampaignSchema)) body: CommercialCampaignInput,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:campaigns");
    return this.commercial.createCampaign(request.auth.identityId, idempotencyKey(rawKey), body);
  }

  @Put("commercial/campaigns/:campaignId")
  updateCommercialCampaign(
    @Req() request: PlatformRequest,
    @Param("campaignId", ParseUUIDPipe) campaignId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodPipe(commercialCampaignSchema)) body: CommercialCampaignInput,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:campaigns");
    return this.commercial.updateCampaign(
      request.auth.identityId,
      campaignId,
      idempotencyKey(rawKey),
      body,
    );
  }

  @Get("commercial/leads")
  commercialLeads(
    @Req() request: PlatformRequest,
    @Query(new ZodPipe(commercialLeadQuerySchema)) query: CommercialLeadQuery,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:leads");
    return this.commercial.leads(query);
  }

  @Patch("commercial/leads/:sourceType/:sourceId")
  updateCommercialLead(
    @Req() request: PlatformRequest,
    @Param("sourceType") sourceType: "trial" | "contact",
    @Param("sourceId", ParseUUIDPipe) sourceId: string,
    @Headers("idempotency-key") rawKey: string | undefined,
    @Body(new ZodPipe(commercialLeadStateSchema)) body: CommercialLeadStateInput,
  ) {
    requirePlatformCapability(request.platformAccess, "commercial:leads");
    if (sourceType !== "trial" && sourceType !== "contact")
      throw new BadRequestException({ code: "COMMERCIAL_LEAD_TYPE_INVALID" });
    return this.commercial.updateLeadState(
      request.auth.identityId,
      sourceType,
      sourceId,
      idempotencyKey(rawKey),
      body,
    );
  }

  @Get("commercial/metrics")
  commercialMetrics(@Req() request: PlatformRequest) {
    requirePlatformCapability(request.platformAccess, "commercial:metrics");
    return this.commercial.metrics();
  }

  @Get("overview")
  async overview(@Req() request: PlatformRequest) {
    const checkedAt = new Date().toISOString();
    const [overview, metrics] = await Promise.allSettled([
      this.platform.overview(),
      this.control.metrics(),
    ]);
    return {
      ...(overview.status === "fulfilled" ? safeOverview(overview.value) : emptyOverview()),
      ...(metrics.status === "fulfilled" ? metrics.value : { metrics: null }),
      access: request.platformAccess,
      generatedAt: checkedAt,
      sources: [
        sourceStatus("overview", overview, checkedAt),
        sourceStatus("metrics", metrics, checkedAt),
      ],
    };
  }

  @Get("tenants")
  tenants(
    @Req() request: PlatformRequest,
    @Query(new ZodPipe(tenantDirectoryQuerySchema)) query: TenantDirectoryQuery,
  ) {
    requirePlatformCapability(request.platformAccess, "tenants:read");
    return this.control.tenantDirectory(query);
  }

  @Get("tenants/:organizationId")
  tenant(
    @Req() request: PlatformRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    requirePlatformCapability(request.platformAccess, "tenants:read");
    return this.control.tenant360(organizationId, request.platformAccess);
  }

  @Post("tenants")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", minLength: 8, maxLength: 160 },
  })
  @ApiBody({ schema: toOpenApiSchema(platformTenantRegistrationSchema) })
  @ApiCreatedResponse({
    schema: {
      type: "object",
      required: ["organization", "unit", "owner", "replayed"],
      properties: {
        organization: {
          type: "object",
          required: ["id", "tradeName", "billingState"],
          properties: {
            id: { type: "string", format: "uuid" },
            tradeName: { type: "string" },
            billingState: { type: "string", enum: ["onboarding"] },
          },
        },
        unit: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
          },
        },
        owner: {
          type: "object",
          required: ["identityId", "email"],
          properties: {
            identityId: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
          },
        },
        replayed: { type: "boolean" },
      },
    },
  })
  registerTenant(
    @Req() request: PlatformRequest,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(platformTenantRegistrationSchema)) body: PlatformTenantRegistration,
  ) {
    requirePlatformCapability(request.platformAccess, "tenants:write");
    return this.control.registerTenant(
      request.auth.identityId,
      idempotencyKey(rawIdempotencyKey),
      body,
    );
  }

  @Post("tenants/:organizationId/pilot-access")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", minLength: 8, maxLength: 160 },
  })
  @ApiCreatedResponse({
    schema: {
      type: "object",
      required: [
        "organizationId",
        "trialId",
        "startsAt",
        "previousEndsAt",
        "endsAt",
        "durationMonths",
        "extended",
        "replayed",
      ],
      properties: {
        organizationId: { type: "string", format: "uuid" },
        trialId: { type: "string", format: "uuid" },
        startsAt: { type: "string", format: "date-time" },
        previousEndsAt: { type: "string", format: "date-time" },
        endsAt: { type: "string", format: "date-time" },
        durationMonths: { type: "integer", example: 6 },
        extended: { type: "boolean" },
        replayed: { type: "boolean" },
      },
    },
  })
  grantPilotAccess(
    @Req() request: PlatformRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(platformReasonBodySchema)) body: PlatformReasonBody,
  ) {
    requirePlatformCapability(request.platformAccess, "billing:write");
    return this.control.grantPilotAccess(
      request.auth.identityId,
      organizationId,
      idempotencyKey(rawIdempotencyKey),
      body.reason,
    );
  }

  @Post("tenants/:organizationId/pii-access")
  revealTenantPii(
    @Req() request: PlatformRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(platformReasonBodySchema)) body: PlatformReasonBody,
  ) {
    requirePlatformCapability(request.platformAccess, "pii:read");
    return this.control.revealTenantPii(request.auth.identityId, organizationId, body.reason);
  }

  @Get("incidents")
  incidents(
    @Req() request: PlatformRequest,
    @Query(new ZodPipe(platformIncidentQuerySchema)) query: PlatformIncidentQuery,
  ) {
    requirePlatformCapability(request.platformAccess, "tenants:read");
    return this.control.incidents(query);
  }

  @Patch("incidents/:fingerprint")
  updateIncident(
    @Req() request: PlatformRequest,
    @Param("fingerprint") rawFingerprint: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(platformIncidentActionSchema)) body: PlatformIncidentAction,
  ) {
    requirePlatformCapability(request.platformAccess, "incidents:write");
    const fingerprint = new ZodPipe(platformIncidentFingerprintSchema).transform(
      rawFingerprint,
    ) as string;
    const idempotencyKey = new ZodPipe(platformIdempotencyKeySchema).transform(
      rawIdempotencyKey,
    ) as string;
    return this.control.mutateIncident(request.auth.identityId, fingerprint, idempotencyKey, body);
  }

  @Post("outbox/:eventId/retry")
  retryOutbox(
    @Req() request: PlatformRequest,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(platformReasonBodySchema)) body: PlatformReasonBody,
  ) {
    requirePlatformCapability(request.platformAccess, "outbox:retry");
    const idempotencyKey = new ZodPipe(platformIdempotencyKeySchema).transform(
      rawIdempotencyKey,
    ) as string;
    return this.control.retryOutbox(request.auth.identityId, eventId, idempotencyKey, body.reason);
  }

  @Patch(
    "fiscal/organizations/:organizationId/units/:unitId/accountant/requests/:requestId/attachments/:attachmentId/legal-hold",
  )
  @ApiBody({
    schema: {
      type: "object",
      required: ["active"],
      properties: { active: { type: "boolean" } },
      additionalProperties: false,
    },
  })
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["attachmentId", "legalHold", "replayed"],
      properties: {
        attachmentId: { type: "string", format: "uuid" },
        legalHold: { type: "boolean" },
        replayed: { type: "boolean" },
      },
    },
  })
  setAccountantAttachmentLegalHold(
    @Req() request: PlatformRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
    @Body("active", ParseBoolPipe) active: boolean,
  ) {
    requirePlatformCapability(request.platformAccess, "fiscal:write");
    return this.platform.setAccountantAttachmentLegalHold(
      request.auth.identityId,
      organizationId,
      unitId,
      requestId,
      attachmentId,
      active,
    );
  }
}

function sourceStatus(key: string, result: PromiseSettledResult<unknown>, checkedAt: string) {
  return {
    key,
    status: result.status === "fulfilled" ? "ok" : "unavailable",
    checkedAt,
    error: result.status === "rejected" ? "UNAVAILABLE" : null,
  };
}

function idempotencyKey(raw: string | undefined) {
  return new ZodPipe(platformIdempotencyKeySchema).transform(raw) as string;
}

function emptyOverview() {
  return {
    counts: { organizations: 0, units: 0, activeTrials: 0 },
    health: { pendingJobs: 0, failedJobs: 0, staleHubs: 0, failedIntegrations: 0 },
    trialFunnel: { applications: 0, activations: 0, conversionPercent: 0 },
    recentTrialApplications: [],
    recentContacts: [],
    recentOrganizations: [],
    fiscalIntegrations: [],
  };
}

function safeOverview(value: Awaited<ReturnType<PlatformService["overview"]>>) {
  return {
    ...value,
    recentTrialApplications: value.recentTrialApplications.map((item) => ({
      ...item,
      name: maskName(item.name),
      email: maskEmail(item.email),
      phone: maskPhone(item.phone),
    })),
    recentContacts: value.recentContacts.map(({ message, ...item }) => ({
      ...item,
      name: maskName(item.name),
      email: maskEmail(item.email),
      phone: maskPhone(item.phone),
      message: null,
      messageAvailable: Boolean(message),
    })),
    fiscalIntegrations: value.fiscalIntegrations.map((item) => ({
      ...item,
      document: maskDocument(item.document),
      lastErrorMessage: item.lastErrorMessage ? "available" : null,
    })),
  };
}
