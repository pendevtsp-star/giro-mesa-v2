import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type BlindCountReviewInput,
  type BlindCountStartInput,
  type BlindCountSubmitInput,
  blindCountReviewSchema,
  blindCountStartSchema,
  blindCountSubmitSchema,
  type InventoryLotHoldInput,
  type InventoryLotHoldReleaseInput,
  type InventorySectorPolicyInput,
  type InventoryTemperatureInput,
  inventoryLotHoldReleaseSchema,
  inventoryLotHoldSchema,
  inventorySectorPolicySchema,
  inventoryTemperatureSchema,
  type ReturnableDepositCancelInput,
  type ReturnableDepositChargeInput,
  type ReturnableDepositReconcileInput,
  type ReturnablePolicyInput,
  returnableDepositCancelSchema,
  returnableDepositChargeSchema,
  returnableDepositReconcileSchema,
  returnablePolicySchema,
} from "./management.inventory-controls.schemas.js";
import { ManagementService } from "./management.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/management/inventory/controls",
  "v1/organizations/:organizationId/units/:unitId/management/inventory/controls",
])
export class ManagementInventoryControlsController {
  constructor(private readonly management: ManagementService) {}

  @Get()
  dashboard(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.inventoryControlsDashboard(
      request.auth.identityId,
      organizationId,
      unitId,
    );
  }

  @Put("sectors/:locationId")
  configureSector(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("locationId", ParseUUIDPipe) locationId: string,
    @Body(new ZodPipe(inventorySectorPolicySchema)) body: InventorySectorPolicyInput,
  ) {
    return this.management.configureInventorySectorPolicy(
      request.auth.identityId,
      organizationId,
      unitId,
      locationId,
      body,
    );
  }

  @Post("counts")
  startCount(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(blindCountStartSchema)) body: BlindCountStartInput,
  ) {
    return this.management.startBlindInventoryCount(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("counts/:sessionId/submit")
  submitCount(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(blindCountSubmitSchema)) body: BlindCountSubmitInput,
  ) {
    return this.management.submitBlindInventoryCount(
      request.auth.identityId,
      organizationId,
      unitId,
      sessionId,
      idempotencyKey,
      body,
    );
  }

  @Post("counts/:sessionId/review")
  reviewCount(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(blindCountReviewSchema)) body: BlindCountReviewInput,
  ) {
    return this.management.reviewBlindInventoryCount(
      request.auth.identityId,
      organizationId,
      unitId,
      sessionId,
      idempotencyKey,
      body,
    );
  }

  @Post("temperatures")
  recordTemperature(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryTemperatureSchema)) body: InventoryTemperatureInput,
  ) {
    return this.management.recordInventoryTemperature(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("lots/:lotId/holds")
  holdLot(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("lotId", ParseUUIDPipe) lotId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryLotHoldSchema)) body: InventoryLotHoldInput,
  ) {
    return this.management.holdInventoryLot(
      request.auth.identityId,
      organizationId,
      unitId,
      lotId,
      idempotencyKey,
      body,
    );
  }

  @Post("lots/:lotId/holds/:holdId/release")
  releaseLot(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("lotId", ParseUUIDPipe) lotId: string,
    @Param("holdId", ParseUUIDPipe) holdId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryLotHoldReleaseSchema)) body: InventoryLotHoldReleaseInput,
  ) {
    return this.management.releaseInventoryLot(
      request.auth.identityId,
      organizationId,
      unitId,
      lotId,
      holdId,
      idempotencyKey,
      body,
    );
  }

  @Post("returnables/deposits")
  chargeDeposit(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableDepositChargeSchema)) body: ReturnableDepositChargeInput,
  ) {
    return this.management.chargeReturnableDeposit(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("returnables/policy")
  returnablePolicy(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.returnablePolicy(request.auth.identityId, organizationId, unitId);
  }

  @Patch("returnables/policy")
  configureReturnablePolicy(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnablePolicySchema)) body: ReturnablePolicyInput,
  ) {
    return this.management.configureReturnablePolicy(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("returnables/deposits/:chargeId/reconcile")
  reconcileDeposit(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("chargeId", ParseUUIDPipe) chargeId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableDepositReconcileSchema)) body: ReturnableDepositReconcileInput,
  ) {
    return this.management.reconcileReturnableDepositCharge(
      request.auth.identityId,
      organizationId,
      unitId,
      chargeId,
      idempotencyKey,
      body,
    );
  }

  @Post("returnables/deposits/:chargeId/cancel")
  cancelDeposit(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("chargeId", ParseUUIDPipe) chargeId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableDepositCancelSchema)) body: ReturnableDepositCancelInput,
  ) {
    return this.management.cancelReturnableDepositCharge(
      request.auth.identityId,
      organizationId,
      unitId,
      chargeId,
      idempotencyKey,
      body,
    );
  }
}
