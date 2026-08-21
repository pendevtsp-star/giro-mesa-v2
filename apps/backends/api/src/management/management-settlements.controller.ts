import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type OperationalLossDecisionInput,
  type OperationalLossInput,
  operationalLossDecisionSchema,
  operationalLossSchema,
  type PartnershipPlanInput,
  partnershipPlanSchema,
  type SettlementConfigInput,
  type SettlementPeriodInput,
  type SettlementTransitionInput,
  settlementConfigSchema,
  settlementPeriodSchema,
  settlementTransitionSchema,
} from "./management-settlements.schemas.js";
import { ManagementSettlementsService } from "./management-settlements.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/management/waiter-settlements",
  "v1/organizations/:organizationId/units/:unitId/management/waiter-settlements",
])
export class ManagementSettlementsController {
  constructor(private readonly settlements: ManagementSettlementsService) {}

  @Get()
  overview(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.settlements.overview(request.auth.identityId, organizationId, unitId);
  }

  @Get("operational-losses/candidates")
  candidates(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query("query") query = "",
  ) {
    return this.settlements.lossCandidates(request.auth.identityId, organizationId, unitId, query);
  }

  @Put("settings")
  updateSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(settlementConfigSchema)) body: SettlementConfigInput,
  ) {
    return this.settlements.updateSettings(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Put("partnership-plan")
  updatePartnershipPlan(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(partnershipPlanSchema)) body: PartnershipPlanInput,
  ) {
    return this.settlements.updatePartnershipPlan(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("operational-losses")
  createLoss(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(operationalLossSchema)) body: OperationalLossInput,
  ) {
    return this.settlements.createOperationalLoss(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("losses/:lossId/decision")
  decideLoss(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("lossId", ParseUUIDPipe) lossId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(operationalLossDecisionSchema)) body: OperationalLossDecisionInput,
  ) {
    return this.settlements.decideOperationalLoss(
      request.auth.identityId,
      organizationId,
      unitId,
      lossId,
      idempotencyKey,
      body,
    );
  }

  @Post("settlements/preview")
  preview(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(settlementPeriodSchema)) body: SettlementPeriodInput,
  ) {
    return this.settlements.preview(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("settlements")
  createSettlement(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(settlementPeriodSchema)) body: SettlementPeriodInput,
  ) {
    return this.settlements.createSettlement(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("settlements/:settlementId/transition")
  transition(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("settlementId", ParseUUIDPipe) settlementId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(settlementTransitionSchema)) body: SettlementTransitionInput,
  ) {
    return this.settlements.transition(
      request.auth.identityId,
      organizationId,
      unitId,
      settlementId,
      idempotencyKey,
      body,
    );
  }

  @Get("settlements/:settlementId/export")
  export(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("settlementId", ParseUUIDPipe) settlementId: string,
  ) {
    return this.settlements.exportCsv(
      request.auth.identityId,
      organizationId,
      unitId,
      settlementId,
    );
  }
}
