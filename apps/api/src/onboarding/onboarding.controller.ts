import {
  type ActivateTrialInput,
  activateTrialSchema,
  idempotencyKeySchema,
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
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader } from "@nestjs/swagger";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { OnboardingService } from "./onboarding.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/onboarding",
  "v1/organizations/:organizationId/onboarding",
])
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get()
  get(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.onboardingService.get(request.auth.identityId, organizationId);
  }

  @Patch()
  update(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(updateOnboardingSchema)) body: UpdateOnboardingInput,
  ) {
    return this.onboardingService.update(request.auth.identityId, organizationId, body);
  }

  @Post("activate")
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
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    return this.onboardingService.activate(
      request.auth.identityId,
      organizationId,
      idempotencyKey,
      body,
    );
  }

  @Get("provisioning/:runId")
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
