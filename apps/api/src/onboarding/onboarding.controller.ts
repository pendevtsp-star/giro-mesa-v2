import {
  type ActivateTrialInput,
  activateTrialSchema,
  idempotencyKeySchema,
  type OnboardingSelectionInput,
  onboardingSelectionSchema,
  type UpdateOnboardingInput,
  updateOnboardingSchema,
} from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProperty,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { OnboardingService } from "./onboarding.service.js";
import { OnboardingExceptionFilter } from "./onboarding-exception.filter.js";

class OnboardingApiErrorDetails {
  @ApiProperty({ required: false, format: "uuid" })
  declare provisioningRunId?: string;

  @ApiProperty({
    required: false,
    isArray: true,
    enum: [
      "business",
      "unit",
      "plan",
      "fiscalChoice",
      "catalog",
      "tables",
      "team",
      "qr",
      "production",
      "cashier",
      "training",
      "rehearsal",
    ],
  })
  declare missingItems?: string[];

  @ApiProperty({
    required: false,
    type: Object,
    additionalProperties: { type: "array", items: { type: "string" } },
  })
  declare fieldErrors?: Record<string, string[]>;

  @ApiProperty({ required: false, type: [String] })
  declare formErrors?: string[];
}

class OnboardingApiErrorResponse {
  @ApiProperty()
  declare statusCode: number;

  @ApiProperty()
  declare code: string;

  @ApiProperty()
  declare message: string;

  @ApiProperty({ required: false, type: () => OnboardingApiErrorDetails })
  declare details?: OnboardingApiErrorDetails;
}

class OnboardingPlanResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty({ enum: ["operacao", "crescimento", "rede"] }) declare slug: string;
  @ApiProperty() declare catalogVersion: number;
  @ApiProperty() declare monthlyPriceCents: number;
  @ApiProperty() declare annualPriceCents: number;
  @ApiProperty() declare includedUnits: number;
  @ApiProperty({ type: [String] }) declare entitlements: string[];
}

class OnboardingSelectionResponse {
  @ApiProperty({ format: "uuid" }) declare selectedUnitId: string;
  @ApiProperty({ type: () => OnboardingPlanResponse }) declare plan: OnboardingPlanResponse;
  @ApiProperty() declare revision: number;
  @ApiProperty({ format: "date-time" }) declare selectedAt: string;
  @ApiProperty({ format: "date-time" }) declare updatedAt: string;
}

class OnboardingEvidenceResponse {
  @ApiProperty({ required: false, nullable: true, type: String, format: "uuid" })
  declare selectedUnitId?: string | null;
  @ApiProperty({ required: false }) declare selectedUnitActive?: boolean;
  @ApiProperty({ required: false, minimum: 0 }) declare activeMembersObserved?: number;
  @ApiProperty({ required: false }) declare menuPublished?: boolean;
  @ApiProperty({ required: false }) declare tablesConfigured?: boolean;
  @ApiProperty({ required: false }) declare capabilitiesConfigured?: boolean;
  @ApiProperty({ required: false }) declare serverTestPassed?: boolean;
  @ApiProperty({ required: false }) declare configured?: boolean;
  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    enum: ["off", "kds", "print", "both"],
  })
  declare requestedMode?: string | null;
  @ApiProperty({ required: false, type: [String], format: "uuid" })
  declare kdsStationIds?: string[];
  @ApiProperty({ required: false, type: [String], format: "uuid" })
  declare printerProfileIds?: string[];
  @ApiProperty({ required: false, nullable: true, type: String, maxLength: 120 })
  declare configurationReference?: string | null;
  @ApiProperty({ required: false, nullable: true, type: Number, minimum: 0 })
  declare catalogVersion?: number | null;
  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    enum: ["operacao", "crescimento", "rede"],
  })
  declare slug?: string | null;
  @ApiProperty({ required: false, maxLength: 240 }) declare note?: string;
  @ApiProperty({ required: false, enum: ["disabled", "focus", "external"] })
  declare choice?: string;
  @ApiProperty({ required: false }) declare completed?: boolean;
  @ApiProperty({
    required: false,
    enum: ["pilot_without_qr", "external_qr", "not_required", "external_fiscal"],
  })
  declare reason?: string;
  @ApiProperty({ required: false, enum: ["off", "kds", "print", "both"] })
  declare mode?: string;
  @ApiProperty({ required: false }) declare legacyValue?: boolean;
}

class OnboardingChecklistEvidenceResponse {
  @ApiProperty({ enum: ["pending", "in_progress", "verified", "blocked", "not_applicable"] })
  declare status: string;
  @ApiProperty({ enum: ["system", "actor_attestation", "authorized_waiver", "legacy_import"] })
  declare source: string;
  @ApiProperty({ nullable: true, type: String, maxLength: 240 })
  declare evidenceReference: string | null;
  @ApiProperty({ type: () => OnboardingEvidenceResponse })
  declare evidence: OnboardingEvidenceResponse;
  @ApiProperty({ nullable: true, type: String, format: "uuid" })
  declare actorIdentityId: string | null;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  declare verifiedAt: string | null;
  @ApiProperty({ nullable: true, type: String, maxLength: 500 })
  declare waiverReason: string | null;
}

class OnboardingChecklistItemsResponse {
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare business: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare unit: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare plan: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare fiscalChoice: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare catalog: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare tables: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare team: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare qr: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare production: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare cashier: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare training: OnboardingChecklistEvidenceResponse;
  @ApiProperty({ type: () => OnboardingChecklistEvidenceResponse })
  declare rehearsal: OnboardingChecklistEvidenceResponse;
}

class ProvisioningSummaryResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty({
    enum: [
      "requested",
      "validating",
      "provisioning",
      "activating",
      "publishing",
      "retryable_failed",
      "compensating",
      "compensated",
      "terminal_failed",
      "completed",
    ],
  })
  declare state: string;
  @ApiProperty({
    enum: [
      "requested",
      "validated",
      "internal_provisioned",
      "activation_committed",
      "published",
      "compensated",
    ],
  })
  declare checkpoint: string;
  @ApiProperty({ type: "integer", format: "int32", minimum: 0 }) declare attempts: number;
  @ApiProperty({ nullable: true, type: String, maxLength: 120 })
  declare lastErrorCode: string | null;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  declare nextRetryAt: string | null;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  declare completedAt: string | null;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  declare failedAt: string | null;
  @ApiProperty({ format: "date-time" }) declare createdAt: string;
  @ApiProperty({ format: "date-time" }) declare updatedAt: string;
}

class OnboardingResponse {
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  declare activatedAt: string | null;
  @ApiProperty({ type: () => OnboardingChecklistItemsResponse })
  declare items: OnboardingChecklistItemsResponse;
  @ApiProperty() declare ready: boolean;
  @ApiProperty({
    isArray: true,
    enum: [
      "business",
      "unit",
      "plan",
      "fiscalChoice",
      "catalog",
      "tables",
      "team",
      "qr",
      "production",
      "cashier",
      "training",
      "rehearsal",
    ],
  })
  declare missingItems: string[];
  @ApiProperty({ nullable: true, type: () => OnboardingSelectionResponse })
  declare selection: OnboardingSelectionResponse | null;
  @ApiProperty({ nullable: true, type: () => ProvisioningSummaryResponse })
  declare provisioning: ProvisioningSummaryResponse | null;
}

class ProvisioningStepResponse {
  @ApiProperty({
    enum: ["validation", "internal_provisioning", "activation", "publication", "compensation"],
  })
  declare step: string;
  @ApiProperty({ enum: ["pending", "in_progress", "completed", "failed", "compensated"] })
  declare status: string;
  @ApiProperty({ type: "integer", format: "int32", minimum: 0 }) declare attempts: number;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  declare startedAt: string | null;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  declare completedAt: string | null;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  declare compensatedAt: string | null;
  @ApiProperty({ format: "date-time" }) declare createdAt: string;
  @ApiProperty({ format: "date-time" }) declare updatedAt: string;
}

class ProvisioningStatusResponse extends ProvisioningSummaryResponse {
  @ApiProperty({ type: () => [ProvisioningStepResponse] })
  declare steps: ProvisioningStepResponse[];
}

class TrialActivationResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty({ format: "uuid" }) declare commercialPlanId: string;
  @ApiProperty({ format: "uuid" }) declare provisioningRunId: string;
  @ApiProperty({ format: "uuid" }) declare subscriptionId: string;
  @ApiProperty({ format: "date-time" }) declare startsAt: string;
  @ApiProperty({ format: "date-time" }) declare endsAt: string;
  @ApiProperty({ enum: ["completed"] }) declare state: "completed";
  @ApiProperty({ type: [String] }) declare entitlements: string[];
}

@UseGuards(SessionGuard)
@UseFilters(OnboardingExceptionFilter)
@Controller([
  "api/v1/organizations/:organizationId/onboarding",
  "v1/organizations/:organizationId/onboarding",
])
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  @ApiOkResponse({ type: OnboardingResponse })
  @ApiBadRequestResponse({ type: OnboardingApiErrorResponse })
  @ApiUnauthorizedResponse({ type: OnboardingApiErrorResponse })
  @ApiForbiddenResponse({ type: OnboardingApiErrorResponse })
  @ApiNotFoundResponse({ type: OnboardingApiErrorResponse })
  @ApiTooManyRequestsResponse({ type: OnboardingApiErrorResponse })
  @ApiInternalServerErrorResponse({ type: OnboardingApiErrorResponse })
  get(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.onboardingService.get(request.auth.identityId, organizationId);
  }

  @Patch()
  @ApiOkResponse({ type: OnboardingResponse })
  @ApiBadRequestResponse({ type: OnboardingApiErrorResponse })
  @ApiUnauthorizedResponse({ type: OnboardingApiErrorResponse })
  @ApiForbiddenResponse({ type: OnboardingApiErrorResponse })
  @ApiNotFoundResponse({ type: OnboardingApiErrorResponse })
  @ApiConflictResponse({ type: OnboardingApiErrorResponse })
  @ApiTooManyRequestsResponse({ type: OnboardingApiErrorResponse })
  @ApiInternalServerErrorResponse({ type: OnboardingApiErrorResponse })
  update(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(updateOnboardingSchema)) body: UpdateOnboardingInput,
  ) {
    return this.onboardingService.update(request.auth.identityId, organizationId, body);
  }

  @Put("selection")
  @ApiOkResponse({ type: OnboardingSelectionResponse })
  @ApiBadRequestResponse({ type: OnboardingApiErrorResponse })
  @ApiUnauthorizedResponse({ type: OnboardingApiErrorResponse })
  @ApiForbiddenResponse({ type: OnboardingApiErrorResponse })
  @ApiNotFoundResponse({ type: OnboardingApiErrorResponse })
  @ApiConflictResponse({ type: OnboardingApiErrorResponse })
  @ApiTooManyRequestsResponse({ type: OnboardingApiErrorResponse })
  @ApiInternalServerErrorResponse({ type: OnboardingApiErrorResponse })
  select(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(onboardingSelectionSchema)) body: OnboardingSelectionInput,
  ) {
    return this.onboardingService.select(request.auth.identityId, organizationId, body);
  }

  @Post("activate")
  @ApiCreatedResponse({ type: TrialActivationResponse })
  @ApiBadRequestResponse({ type: OnboardingApiErrorResponse })
  @ApiUnauthorizedResponse({ type: OnboardingApiErrorResponse })
  @ApiForbiddenResponse({ type: OnboardingApiErrorResponse })
  @ApiNotFoundResponse({ type: OnboardingApiErrorResponse })
  @ApiConflictResponse({ type: OnboardingApiErrorResponse })
  @ApiTooManyRequestsResponse({ type: OnboardingApiErrorResponse })
  @ApiInternalServerErrorResponse({ type: OnboardingApiErrorResponse })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Chave opaca, estável por tentativa de ativação (8 a 160 caracteres).",
  })
  activate(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(activateTrialSchema)) body: ActivateTrialInput,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.onboardingService.activate(
      request.auth.identityId,
      organizationId,
      idempotencyKey,
      body,
    );
  }

  @Get("provisioning/:runId")
  @ApiOkResponse({ type: ProvisioningStatusResponse })
  @ApiBadRequestResponse({ type: OnboardingApiErrorResponse })
  @ApiUnauthorizedResponse({ type: OnboardingApiErrorResponse })
  @ApiForbiddenResponse({ type: OnboardingApiErrorResponse })
  @ApiNotFoundResponse({ type: OnboardingApiErrorResponse })
  @ApiTooManyRequestsResponse({ type: OnboardingApiErrorResponse })
  @ApiInternalServerErrorResponse({ type: OnboardingApiErrorResponse })
  provisioningStatus(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("runId", ParseUUIDPipe) runId: string,
  ) {
    return this.onboardingService.provisioningStatus(
      request.auth.identityId,
      organizationId,
      runId,
    );
  }
}
