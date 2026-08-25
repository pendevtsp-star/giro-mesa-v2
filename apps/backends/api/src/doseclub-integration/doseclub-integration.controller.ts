import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { DoseClubIntegrationService } from "./doseclub-integration.service.js";

const membershipsQuerySchema = z.object({ productId: z.string().uuid().optional() }).strict();

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/integrations/doseclub",
  "v1/organizations/:organizationId/units/:unitId/integrations/doseclub",
])
export class DoseClubIntegrationController {
  constructor(private readonly integration: DoseClubIntegrationService) {}

  @HttpCode(200)
  @Post("activate")
  activate(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.integration.activate(request.auth.identityId, organizationId, unitId);
  }

  @Get("tabs/:tabId/memberships")
  memberships(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Query(new ZodPipe(membershipsQuerySchema)) query: z.infer<typeof membershipsQuerySchema>,
  ) {
    return this.integration.listEligibleMemberships(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      query.productId,
    );
  }
}
