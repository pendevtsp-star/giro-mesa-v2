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
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
} from "@nestjs/swagger";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PrivacyService } from "./privacy.service.js";

const PRIVACY_DOMAINS = [
  "identity",
  "organization_membership",
  "operations",
  "management_finance",
  "growth_crm",
  "objects_media",
  "offline_edge",
  "backups",
] as const;

class PrivacyStepResponse {
  @ApiProperty({ enum: PRIVACY_DOMAINS }) declare domain: string;
  @ApiProperty() declare mandatory: boolean;
  @ApiProperty({ enum: ["pending", "processing", "completed", "blocked", "failed"] })
  declare status: string;
  @ApiProperty({ nullable: true }) declare reasonCode: string | null;
  @ApiProperty({ type: "integer", format: "int32", minimum: 0 }) declare attempts: number;
}

class PrivacyRequestStatusResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty({ enum: ["access_export", "correction", "anonymization", "deletion"] })
  declare type: string;
  @ApiProperty({
    enum: [
      "verification_pending",
      "approval_pending",
      "processing",
      "partial",
      "completed",
      "rejected",
      "failed",
    ],
  })
  declare state: string;
  @ApiProperty({ type: "integer", format: "int32", minimum: 0 }) declare attempts: number;
  @ApiProperty({ nullable: true }) declare lastErrorCode: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  declare verifiedAt: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  declare approvedAt: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  declare completedAt: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare createdAt: string;
  @ApiProperty({ type: String, format: "date-time" }) declare updatedAt: string;
  @ApiProperty({ type: () => [PrivacyStepResponse] }) declare steps: PrivacyStepResponse[];
}

class PrivacyExportIdentityResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty({ format: "email" }) declare email: string;
  @ApiProperty() declare displayName: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  declare emailVerifiedAt: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare createdAt: string;
  @ApiProperty({ type: String, format: "date-time" }) declare updatedAt: string;
}

class PrivacyExportMembershipResponse {
  @ApiProperty({ format: "uuid" }) declare membershipId: string;
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty() declare status: string;
  @ApiProperty({ nullable: true }) declare role: string | null;
  @ApiProperty({ format: "uuid", nullable: true }) declare unitId: string | null;
}

class PrivacyExportDataResponse {
  @ApiProperty({ type: () => PrivacyExportIdentityResponse })
  declare identity: PrivacyExportIdentityResponse;
  @ApiProperty({ type: () => [PrivacyExportMembershipResponse] })
  declare organizationMemberships: PrivacyExportMembershipResponse[];
}

class PrivacyExportResponse {
  @ApiProperty({ type: "integer", format: "int32", enum: [1] }) declare schemaVersion: 1;
  @ApiProperty({ format: "uuid" }) declare requestId: string;
  @ApiProperty({ type: String, format: "date-time" }) declare generatedAt: string;
  @ApiProperty() declare partial: boolean;
  @ApiProperty({ isArray: true, enum: PRIVACY_DOMAINS }) declare blockedDomains: string[];
  @ApiProperty({ type: () => PrivacyExportDataResponse }) declare data: PrivacyExportDataResponse;
}

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/privacy",
  "v1/organizations/:organizationId/privacy",
])
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Post("requests")
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiCreatedResponse({ type: PrivacyRequestStatusResponse })
  create(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(privacyRequestSchema)) body: PrivacyRequestInput,
  ) {
    return this.privacy.create(request.auth, organizationId, idempotencyKey, body);
  }

  @Get("requests")
  @ApiOkResponse({ type: [PrivacyRequestStatusResponse] })
  list(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.privacy.list(request.auth.identityId, organizationId);
  }

  @Get("requests/:requestId")
  @ApiOkResponse({ type: PrivacyRequestStatusResponse })
  get(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.privacy.get(request.auth.identityId, organizationId, requestId);
  }

  @Post("requests/:requestId/verify-subject")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PrivacyRequestStatusResponse })
  verify(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.privacy.verify(request.auth, organizationId, requestId);
  }

  @Post("requests/:requestId/approve")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PrivacyRequestStatusResponse })
  approve(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.privacy.approve(request.auth, organizationId, requestId);
  }

  @Post("requests/:requestId/retry")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PrivacyRequestStatusResponse })
  retry(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.privacy.retry(request.auth, organizationId, requestId);
  }

  @Post("requests/:requestId/reject")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PrivacyRequestStatusResponse })
  reject(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body(new ZodPipe(privacyDecisionSchema)) body: PrivacyDecisionInput,
  ) {
    return this.privacy.reject(request.auth, organizationId, requestId, body);
  }

  @Post("requests/:requestId/export-download")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PrivacyExportResponse })
  download(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.privacy.download(request.auth, organizationId, requestId);
  }
}
