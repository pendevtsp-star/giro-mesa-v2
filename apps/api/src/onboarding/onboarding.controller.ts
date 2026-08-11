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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { OnboardingService } from "./onboarding.service.js";
import { OnboardingExceptionFilter } from "./onboarding-exception.filter.js";

class OnboardingApiErrorDetails {
  @ApiProperty({ required: false, format: "uuid" })
  declare provisioningRunId?: string;

  @ApiProperty({ required: false, type: [String] })
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

class ProvisioningSummaryResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty() declare state: string;
  @ApiProperty() declare checkpoint: string;
  @ApiProperty() declare attempts: number;
  @ApiProperty({ required: false, nullable: true }) declare lastErrorCode: string | null;
  @ApiProperty({ required: false, nullable: true, format: "date-time" })
  declare nextRetryAt: string | null;
  @ApiProperty({ required: false, nullable: true, format: "date-time" })
  declare completedAt: string | null;
  @ApiProperty({ required: false, nullable: true, format: "date-time" })
  declare failedAt: string | null;
  @ApiProperty({ format: "date-time" }) declare createdAt: string;
  @ApiProperty({ format: "date-time" }) declare updatedAt: string;
}

class OnboardingResponse {
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty({ required: false, nullable: true, format: "date-time" })
  declare activatedAt: string | null;
  @ApiProperty({ type: Object, additionalProperties: true })
  declare items: Record<string, unknown>;
  @ApiProperty() declare ready: boolean;
  @ApiProperty({ type: [String] }) declare missingItems: string[];
  @ApiProperty({ required: false, nullable: true, type: () => OnboardingSelectionResponse })
  declare selection: OnboardingSelectionResponse | null;
  @ApiProperty({ required: false, nullable: true, type: () => ProvisioningSummaryResponse })
  declare provisioning: ProvisioningSummaryResponse | null;
}

class ProvisioningStepResponse {
  @ApiProperty() declare step: string;
  @ApiProperty() declare status: string;
  @ApiProperty() declare attempts: number;
  @ApiProperty({ required: false, nullable: true, format: "date-time" })
  declare startedAt: string | null;
  @ApiProperty({ required: false, nullable: true, format: "date-time" })
  declare completedAt: string | null;
  @ApiProperty({ required: false, nullable: true, format: "date-time" })
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
  @ApiServiceUnavailableResponse({ type: OnboardingApiErrorResponse })
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
