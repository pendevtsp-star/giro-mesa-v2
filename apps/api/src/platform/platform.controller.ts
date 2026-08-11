import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/session.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { PlatformAdminGuard } from "./platform.guard.js";
import { PlatformService } from "./platform.service.js";

@UseGuards(SessionGuard, PlatformAdminGuard)
@Controller(["api/v1/platform", "v1/platform"])
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("overview")
  overview(@Req() request: AuthenticatedRequest) {
    return this.platform.overview(request.auth);
  }

  @Get("tenants/:organizationId/context")
  context(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId") organizationId: string,
    @Query("unitId") unitId?: string,
  ) {
    return this.platform.context(request.auth, organizationId, unitId);
  }

  @Get("tenants/:organizationId/resources/:resource")
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
  propose(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId") organizationId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.platform.propose(request.auth, organizationId, idempotencyKey, body);
  }

  @Post("tenants/:organizationId/actions/:proposalId/approve")
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
