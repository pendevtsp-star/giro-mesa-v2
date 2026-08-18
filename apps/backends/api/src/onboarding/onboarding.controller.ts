import {
  type ActivateTrialInput,
  activateTrialSchema,
  type UpdateOnboardingInput,
  updateOnboardingSchema,
} from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
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
  activate(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(activateTrialSchema)) body: ActivateTrialInput,
  ) {
    return this.onboardingService.activate(request.auth.identityId, organizationId, body);
  }
}
