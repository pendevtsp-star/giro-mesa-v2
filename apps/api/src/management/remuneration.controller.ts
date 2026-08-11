import type { RemunerationExpression } from "@giromesa/domain";
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type RemunerationAdjustmentInput,
  type RemunerationCalculationInput,
  type RemunerationRuleInput,
  type RemunerationSimulationInput,
  type RemunerationVersionInput,
  remunerationAdjustmentSchema,
  remunerationCalculationSchema,
  remunerationRuleSchema,
  remunerationSimulationSchema,
  remunerationVersionSchema,
} from "./remuneration.schemas.js";
import { RemunerationService } from "./remuneration.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/management/remuneration",
  "v1/organizations/:organizationId/units/:unitId/management/remuneration",
])
export class RemunerationController {
  constructor(private readonly remuneration: RemunerationService) {}

  @Post("rules")
  createRule(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(remunerationRuleSchema)) body: RemunerationRuleInput,
  ) {
    return this.remuneration.createRule(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      { ...body, expression: body.expression as RemunerationExpression },
    );
  }

  @Post("rules/:ruleSetId/versions")
  publishVersion(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ruleSetId", ParseUUIDPipe) ruleSetId: string,
    @Body(new ZodPipe(remunerationVersionSchema)) body: RemunerationVersionInput,
  ) {
    return this.remuneration.publishVersion(
      request.auth.identityId,
      organizationId,
      unitId,
      ruleSetId,
      body.expression as RemunerationExpression,
      body.effectiveFrom,
    );
  }

  @Post("rules/:ruleVersionId/simulate")
  simulate(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ruleVersionId", ParseUUIDPipe) ruleVersionId: string,
    @Body(new ZodPipe(remunerationSimulationSchema)) body: RemunerationSimulationInput,
  ) {
    return this.remuneration.simulate(
      request.auth.identityId,
      organizationId,
      unitId,
      ruleVersionId,
      body.metrics,
    );
  }

  @Post("runs")
  calculate(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(remunerationCalculationSchema)) body: RemunerationCalculationInput,
  ) {
    return this.remuneration.calculate(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("runs/:runId/approve")
  approve(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("runId", ParseUUIDPipe) runId: string,
  ) {
    return this.remuneration.approve(request.auth.identityId, organizationId, unitId, runId);
  }

  @Post("runs/:runId/close")
  close(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("runId", ParseUUIDPipe) runId: string,
  ) {
    return this.remuneration.close(request.auth.identityId, organizationId, unitId, runId);
  }

  @Post("runs/:runId/adjustments")
  adjustClosed(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("runId", ParseUUIDPipe) runId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(remunerationAdjustmentSchema)) body: RemunerationAdjustmentInput,
  ) {
    return this.remuneration.adjustClosed(
      request.auth.identityId,
      organizationId,
      unitId,
      runId,
      idempotencyKey,
      body,
    );
  }

  @Get("portfolio")
  portfolio(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query("periodStart") periodStart: string,
    @Query("periodEnd") periodEnd: string,
  ) {
    return this.remuneration.portfolio(
      request.auth.identityId,
      organizationId,
      unitId,
      periodStart,
      periodEnd,
    );
  }

  @Get("runs/:runId/export/:format")
  exportRun(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("runId", ParseUUIDPipe) runId: string,
    @Param("format") format: "csv" | "pdf" | "print",
  ) {
    return this.remuneration.exportRun(
      request.auth.identityId,
      organizationId,
      unitId,
      runId,
      format,
    );
  }
}
