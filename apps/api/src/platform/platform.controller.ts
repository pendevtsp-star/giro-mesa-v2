import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiProperty,
} from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/session.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { DatabaseContext } from "../database/database-context.decorator.js";
import { PlatformAdminGuard } from "./platform.guard.js";
import { PlatformService } from "./platform.service.js";
import { PlatformExceptionFilter } from "./platform-exception.filter.js";
import {
  platformProjectionModels,
  platformProjectionResponseSchema,
} from "./platform-projection.dto.js";

const platformActions = [
  "tenant.suspend",
  "tenant.restore",
  "membership.disable",
  "membership.restore",
] as const;

class PlatformCountsResponse {
  @ApiProperty({ type: "integer", minimum: 0 }) declare organizations: number;
  @ApiProperty({ type: "integer", minimum: 0 }) declare active: number;
  @ApiProperty({ type: "integer", minimum: 0 }) declare attention: number;
}

class PlatformAccessResponse {
  @ApiProperty({ type: [String] }) declare permissions: string[];
  @ApiProperty() declare stepUp: boolean;
  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  declare stepUpExpiresAt: string | null;
}

class PlatformOverviewResponse {
  @ApiProperty({ type: () => PlatformCountsResponse }) declare counts: PlatformCountsResponse;
  @ApiProperty({ type: () => PlatformAccessResponse }) declare access: PlatformAccessResponse;
}

class PlatformOrganizationResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty() declare name: string;
  @ApiProperty() declare billingState: string;
  @ApiProperty({ format: "date-time" }) declare updatedAt: string;
}

class PlatformUnitResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty() declare name: string;
  @ApiProperty() declare active: boolean;
  @ApiProperty() declare timezone: string;
}

class PlatformTenantContextResponse {
  @ApiProperty({ type: () => PlatformOrganizationResponse })
  declare organization: PlatformOrganizationResponse;
  @ApiProperty({ type: () => [PlatformUnitResponse] }) declare units: PlatformUnitResponse[];
  @ApiProperty({ nullable: true, type: String, format: "uuid" }) declare selectedUnitId:
    | string
    | null;
}

class PlatformActionPayloadResponse {
  @ApiProperty() declare expectedState: string;
  @ApiProperty({ required: false }) declare restoreTo?: string;
}

class PlatformActionResponse {
  @ApiProperty({ format: "uuid" }) declare id: string;
  @ApiProperty({ format: "uuid" }) declare organizationId: string;
  @ApiProperty({ enum: platformActions }) declare action: string;
  @ApiProperty({ enum: ["organization", "membership"] }) declare targetType: string;
  @ApiProperty({ format: "uuid" }) declare targetId: string;
  @ApiProperty({ format: "uuid" }) declare requestedByIdentityId: string;
  @ApiProperty({ minLength: 20, maxLength: 500 }) declare justification: string;
  @ApiProperty({ type: () => PlatformActionPayloadResponse })
  declare payload: PlatformActionPayloadResponse;
  @ApiProperty({ enum: ["pending", "approved", "executed", "rejected", "expired", "failed"] })
  declare status: string;
  @ApiProperty({ type: "integer", minimum: 1 }) declare version: number;
  @ApiProperty({ format: "date-time" }) declare requestedAt: string;
  @ApiProperty({ format: "date-time" }) declare expiresAt: string;
  @ApiProperty({ required: false, format: "uuid" }) declare decidedByIdentityId?: string;
  @ApiProperty({ required: false, format: "date-time" }) declare decidedAt?: string;
  @ApiProperty({ required: false }) declare failureCode?: string;
}

class PlatformActionPageResponse {
  @ApiProperty({ type: () => [PlatformActionResponse] }) declare items: PlatformActionResponse[];
  @ApiProperty({ nullable: true, type: String }) declare nextCursor: string | null;
}

class PlatformProposalRequest {
  @ApiProperty({ enum: platformActions }) declare action: string;
  @ApiProperty({ format: "uuid" }) declare targetId: string;
  @ApiProperty({ minLength: 20, maxLength: 500 }) declare justification: string;
  @ApiProperty({ type: () => PlatformActionPayloadResponse })
  declare payload: PlatformActionPayloadResponse;
}

class PlatformDecisionRequest {
  @ApiProperty({ type: "integer", minimum: 1 }) declare expectedVersion: number;
}

@UseGuards(SessionGuard, PlatformAdminGuard)
@UseFilters(PlatformExceptionFilter)
@DatabaseContext("platform")
@ApiExtraModels(...platformProjectionModels)
@Controller(["api/v1/platform", "v1/platform"])
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("overview")
  @ApiOkResponse({ type: PlatformOverviewResponse })
  overview(@Req() request: AuthenticatedRequest) {
    return this.platform.overview(request.auth);
  }

  @Get("tenants/:organizationId/context")
  @ApiOkResponse({ type: PlatformTenantContextResponse })
  context(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId") organizationId: string,
    @Query("unitId") unitId?: string,
  ) {
    return this.platform.context(request.auth, organizationId, unitId);
  }

  @Get("tenants/:organizationId/resources/:resource")
  @ApiOkResponse({ schema: platformProjectionResponseSchema })
  projection(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId") organizationId: string,
    @Param("resource") resource: string,
    @Query("unitId") unitId?: string,
    @Query("limit") rawLimit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.platform.projection(request.auth, organizationId, resource, {
      unitId,
      limit: this.limit(rawLimit),
      cursor,
    });
  }

  @Get("tenants/:organizationId/actions")
  @ApiOkResponse({ type: PlatformActionPageResponse })
  actions(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId") organizationId: string,
    @Query("limit") rawLimit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.platform.actions(request.auth, organizationId, {
      limit: this.limit(rawLimit),
      cursor,
    });
  }

  @Post("tenants/:organizationId/actions")
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiBody({ type: PlatformProposalRequest })
  @ApiCreatedResponse({ type: PlatformActionResponse })
  propose(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId") organizationId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.platform.propose(request.auth, organizationId, idempotencyKey, body);
  }

  @Post("tenants/:organizationId/actions/:proposalId/approve")
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiBody({ type: PlatformDecisionRequest })
  @ApiOkResponse({ type: PlatformActionResponse })
  approve(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId") organizationId: string,
    @Param("proposalId") proposalId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { expectedVersion?: unknown },
  ) {
    return this.platform.approve(
      request.auth,
      organizationId,
      proposalId,
      idempotencyKey,
      this.version(body?.expectedVersion),
    );
  }

  @Post("tenants/:organizationId/actions/:proposalId/reject")
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiBody({ type: PlatformDecisionRequest })
  @ApiOkResponse({ type: PlatformActionResponse })
  reject(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId") organizationId: string,
    @Param("proposalId") proposalId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { expectedVersion?: unknown },
  ) {
    return this.platform.reject(
      request.auth,
      organizationId,
      proposalId,
      idempotencyKey,
      this.version(body?.expectedVersion),
    );
  }

  private limit(value: string | undefined) {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : Number.NaN;
  }

  private version(value: unknown) {
    return typeof value === "number" ? value : Number.NaN;
  }
}
