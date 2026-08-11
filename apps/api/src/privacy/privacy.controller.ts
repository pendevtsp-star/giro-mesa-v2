import {
  type PrivacyDecisionInput,
  type PrivacyRequestInput,
  privacyDecisionSchema,
  privacyRequestSchema,
} from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrivacyService } from "./privacy.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/privacy",
  "v1/organizations/:organizationId/privacy",
])
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Post("requests")
  create(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(privacyRequestSchema)) body: PrivacyRequestInput,
  ) {
    return this.privacy.create(request.auth, organizationId, idempotencyKey, body);
  }

  @Get("requests")
  list(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.privacy.list(request.auth.identityId, organizationId);
  }

  @Get("requests/:requestId")
  get(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.privacy.get(request.auth.identityId, organizationId, requestId);
  }

  @Post("requests/:requestId/verify-subject")
  verify(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.privacy.verify(request.auth, organizationId, requestId);
  }

  @Post("requests/:requestId/approve")
  approve(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.privacy.approve(request.auth, organizationId, requestId);
  }

  @Post("requests/:requestId/retry")
  retry(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.privacy.retry(request.auth, organizationId, requestId);
  }

  @Post("requests/:requestId/reject")
  reject(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body(new ZodPipe(privacyDecisionSchema)) body: PrivacyDecisionInput,
  ) {
    return this.privacy.reject(request.auth, organizationId, requestId, body);
  }

  @Post("requests/:requestId/export-download")
  download(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.privacy.download(request.auth, organizationId, requestId);
  }
}
