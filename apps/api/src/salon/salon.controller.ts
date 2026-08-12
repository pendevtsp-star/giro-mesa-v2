import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type AreaAssignmentInput,
  areaAssignmentSchema,
  expectedVersionSchema,
  type LayoutNodesInput,
  layoutNodesSchema,
  type PresenceLeaseInput,
  presenceAckSchema,
  presenceRenewSchema,
} from "./salon.schemas.js";
import { SalonService } from "./salon.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/salon",
  "v1/organizations/:organizationId/units/:unitId/salon",
])
export class SalonController {
  constructor(private readonly salon: SalonService) {}

  @Get("rooms/:roomId/map")
  map(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("roomId", ParseUUIDPipe) roomId: string,
  ) {
    return this.salon.operationalMap(request.auth.identityId, organizationId, unitId, roomId);
  }

  @Post("rooms/:roomId/layouts")
  createLayout(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("roomId", ParseUUIDPipe) roomId: string,
  ) {
    return this.salon.createLayout(request.auth.identityId, organizationId, unitId, roomId);
  }

  @Put("layouts/:layoutId/nodes")
  replaceNodes(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("layoutId", ParseUUIDPipe) layoutId: string,
    @Body(new ZodPipe(layoutNodesSchema)) body: LayoutNodesInput,
  ) {
    return this.salon.replaceNodes(
      request.auth.identityId,
      organizationId,
      unitId,
      layoutId,
      body.expectedVersion,
      body.nodes,
    );
  }

  @Post("layouts/:layoutId/publish")
  publish(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("layoutId", ParseUUIDPipe) layoutId: string,
    @Body(new ZodPipe(expectedVersionSchema)) body: { expectedVersion: number },
  ) {
    return this.salon.publishLayout(
      request.auth.identityId,
      organizationId,
      unitId,
      layoutId,
      body.expectedVersion,
    );
  }

  @Put("shifts/:shiftId/areas/:areaId")
  assignArea(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("shiftId", ParseUUIDPipe) shiftId: string,
    @Param("areaId", ParseUUIDPipe) areaId: string,
    @Body(new ZodPipe(areaAssignmentSchema)) body: AreaAssignmentInput,
  ) {
    return this.salon.assignArea(
      request.auth.identityId,
      organizationId,
      unitId,
      shiftId,
      areaId,
      body,
    );
  }

  @Put("presence/:deviceId")
  renewPresence(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("deviceId", ParseUUIDPipe) deviceId: string,
    @Body(new ZodPipe(presenceRenewSchema)) body: { current: PresenceLeaseInput },
  ) {
    return this.salon.renewPresence(
      request.auth.identityId,
      organizationId,
      unitId,
      deviceId,
      body.current,
    );
  }

  @Post("presence/:deviceId/ack")
  ackPresence(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("deviceId", ParseUUIDPipe) deviceId: string,
    @Body(new ZodPipe(presenceAckSchema)) body: { leaseEpoch: string; resourceVersion: number },
  ) {
    return this.salon.ackPresence(
      request.auth.identityId,
      organizationId,
      unitId,
      deviceId,
      body.leaseEpoch,
      body.resourceVersion,
    );
  }

  @Get("exceptions")
  exceptions(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.salon.listExceptions(request.auth.identityId, organizationId, unitId);
  }

  @Post("exceptions/:exceptionId/ack")
  acknowledgeException(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("exceptionId", ParseUUIDPipe) exceptionId: string,
  ) {
    return this.salon.acknowledgeException(
      request.auth.identityId,
      organizationId,
      unitId,
      exceptionId,
    );
  }
}
