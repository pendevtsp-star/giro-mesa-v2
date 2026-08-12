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
  type CreateReturnableAssetInput,
  createReturnableAssetSchema,
  type ReturnableMovementInput,
  type ReturnableReconciliationInput,
  returnableMovementSchema,
  returnableReconciliationSchema,
} from "./returnables.schemas.js";
import { ReturnablesService } from "./returnables.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/returnables",
  "v1/organizations/:organizationId/units/:unitId/returnables",
])
export class ReturnablesController {
  constructor(private readonly returnables: ReturnablesService) {}

  @Post("assets")
  createAsset(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(createReturnableAssetSchema)) body: CreateReturnableAssetInput,
  ) {
    return this.returnables.createAsset(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("movements")
  move(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableMovementSchema)) body: ReturnableMovementInput,
  ) {
    return this.returnables.move(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("reconciliations")
  reconcile(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableReconciliationSchema)) body: ReturnableReconciliationInput,
  ) {
    return this.returnables.reconcile(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("assets/:assetId/ledger")
  ledger(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
  ) {
    return this.returnables.ledger(request.auth.identityId, organizationId, unitId, assetId);
  }
}
