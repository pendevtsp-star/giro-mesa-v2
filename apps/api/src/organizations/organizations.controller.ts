import {
  type AcceptMembershipInviteInput,
  acceptMembershipInviteSchema,
  type CreateOrganizationInput,
  createOrganizationSchema,
  type EnrollDeviceInput,
  enrollDeviceSchema,
  type InviteMembershipInput,
  inviteMembershipSchema,
} from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { OrganizationsService } from "./organizations.service.js";

@UseGuards(SessionGuard)
@Controller(["api/v1/organizations", "v1/organizations"])
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.organizationsService.list(request.auth.identityId);
  }

  @HttpCode(204)
  @Post(":organizationId/units/:unitId/devices/:deviceId/revoke")
  revokeDevice(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("deviceId", ParseUUIDPipe) deviceId: string,
  ) {
    return this.organizationsService.revokeDevice(
      request.auth.identityId,
      organizationId,
      unitId,
      deviceId,
    );
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodPipe(createOrganizationSchema)) body: CreateOrganizationInput,
  ) {
    return this.organizationsService.create(request.auth.identityId, body);
  }

  @Post(":organizationId/units/:unitId/devices")
  enrollDevice(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(enrollDeviceSchema)) body: EnrollDeviceInput,
  ) {
    return this.organizationsService.enrollDevice(
      request.auth.identityId,
      organizationId,
      unitId,
      body,
    );
  }

  @Post(":organizationId/membership-invitations")
  invite(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(inviteMembershipSchema)) body: InviteMembershipInput,
  ) {
    return this.organizationsService.invite(request.auth.identityId, organizationId, body);
  }

  @Post("membership-invitations/accept")
  acceptInvite(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodPipe(acceptMembershipInviteSchema)) body: AcceptMembershipInviteInput,
  ) {
    return this.organizationsService.acceptInvite(request.auth.identityId, body);
  }
}
