import {
  type AcceptMembershipInviteInput,
  acceptMembershipInviteSchema,
  type CopyUnitSettingsInput,
  type CreateOrganizationInput,
  copyUnitSettingsSchema,
  createOrganizationSchema,
  type EnrollDeviceInput,
  enrollDeviceSchema,
  establishmentSettingsSchema,
  type InviteMembershipInput,
  idSchema,
  inviteMembershipSchema,
  type UpdateOrganizationSettingsInput,
  type UpdateUnitSettingsInput,
  updateOrganizationSettingsSchema,
  updateUnitSettingsSchema,
} from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse } from "@nestjs/swagger";
import { z } from "zod";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { EstablishmentSettingsService } from "./establishment-settings.service.js";
import { OrganizationsService } from "./organizations.service.js";

const organizationSettingsResponseSchema = establishmentSettingsSchema.shape.organization;
const copyUnitSettingsResponseSchema = z.object({
  sourceUnitId: idSchema,
  targetUnitIds: z.array(idSchema),
  idempotentReplay: z.boolean(),
});

@UseGuards(SessionGuard)
@Controller(["api/v1/organizations", "v1/organizations"])
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly establishmentSettings: EstablishmentSettingsService,
  ) {}

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

  @ApiOkResponse({ schema: toOpenApiSchema(establishmentSettingsSchema) })
  @Get(":organizationId/units/:unitId/settings")
  getSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.establishmentSettings.get(request.auth.identityId, organizationId, unitId);
  }

  @ApiBody({ schema: toOpenApiSchema(updateOrganizationSettingsSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(organizationSettingsResponseSchema) })
  @Patch(":organizationId/settings")
  updateOrganizationSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(updateOrganizationSettingsSchema)) body: UpdateOrganizationSettingsInput,
  ) {
    return this.establishmentSettings.updateOrganization(
      request.auth.identityId,
      organizationId,
      body,
    );
  }

  @ApiBody({ schema: toOpenApiSchema(updateUnitSettingsSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(establishmentSettingsSchema) })
  @Put(":organizationId/units/:unitId/settings")
  updateUnitSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(updateUnitSettingsSchema)) body: UpdateUnitSettingsInput,
  ) {
    return this.establishmentSettings.updateUnit(
      request.auth.identityId,
      organizationId,
      unitId,
      body,
    );
  }

  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", minLength: 8, maxLength: 160 },
  })
  @ApiBody({ schema: toOpenApiSchema(copyUnitSettingsSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(copyUnitSettingsResponseSchema) })
  @Post(":organizationId/units/:sourceUnitId/settings/copy")
  copyUnitSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("sourceUnitId", ParseUUIDPipe) sourceUnitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(copyUnitSettingsSchema)) body: CopyUnitSettingsInput,
  ) {
    return this.establishmentSettings.copy(
      request.auth.identityId,
      organizationId,
      sourceUnitId,
      idempotencyKey,
      body,
    );
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
