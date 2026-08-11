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
import {
  type IncidentDecisionInput,
  type IncidentReportInput,
  type IncidentReviewInput,
  incidentDecisionSchema,
  incidentReportSchema,
  incidentReviewSchema,
} from "./incidents.schemas.js";
import { IncidentsService } from "./incidents.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/incidents",
  "v1/organizations/:organizationId/units/:unitId/incidents",
])
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Post()
  report(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(incidentReportSchema)) body: IncidentReportInput,
  ) {
    return this.incidents.report(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post(":incidentId/review")
  review(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("incidentId", ParseUUIDPipe) incidentId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(incidentReviewSchema)) body: IncidentReviewInput,
  ) {
    return this.incidents.review(
      request.auth.identityId,
      organizationId,
      unitId,
      incidentId,
      idempotencyKey,
      body.neutralNote,
    );
  }

  @Post(":incidentId/decision")
  decide(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("incidentId", ParseUUIDPipe) incidentId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(incidentDecisionSchema)) body: IncidentDecisionInput,
  ) {
    return this.incidents.decide(
      request.auth.identityId,
      organizationId,
      unitId,
      incidentId,
      idempotencyKey,
      body.decision,
      body.neutralNote,
    );
  }

  @Post(":incidentId/close")
  close(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("incidentId", ParseUUIDPipe) incidentId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(incidentReviewSchema)) body: IncidentReviewInput,
  ) {
    return this.incidents.close(
      request.auth.identityId,
      organizationId,
      unitId,
      incidentId,
      idempotencyKey,
      body.neutralNote,
    );
  }

  @Get(":incidentId/report")
  reportView(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("incidentId", ParseUUIDPipe) incidentId: string,
  ) {
    return this.incidents.reportView(request.auth.identityId, organizationId, unitId, incidentId);
  }
}
