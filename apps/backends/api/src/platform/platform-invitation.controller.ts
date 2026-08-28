import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBody } from "@nestjs/swagger";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type PlatformStaffInvitationAcceptInput,
  platformStaffInvitationAcceptSchema,
} from "./platform.schemas.js";
import { PlatformTeamService } from "./platform-team.service.js";

@UseGuards(SessionGuard)
@Controller(["api/v1/platform/invitations", "v1/platform/invitations"])
export class PlatformInvitationController {
  constructor(private readonly team: PlatformTeamService) {}

  @Post("accept")
  @ApiBody({ schema: toOpenApiSchema(platformStaffInvitationAcceptSchema) })
  accept(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodPipe(platformStaffInvitationAcceptSchema))
    body: PlatformStaffInvitationAcceptInput,
  ) {
    return this.team.accept(request.auth.identityId, body);
  }
}
