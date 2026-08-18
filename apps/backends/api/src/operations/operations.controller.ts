import { type OperationalCommandInput, operationalCommandSchema } from "@giromesa/contracts";
import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { OperationsService } from "./operations.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/commands",
  "v1/organizations/:organizationId/units/:unitId/commands",
])
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(operationalCommandSchema)) body: OperationalCommandInput,
  ) {
    return this.operationsService.accept(request.auth.identityId, organizationId, unitId, body);
  }
}
