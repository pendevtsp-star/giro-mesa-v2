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
import { PilotPosService } from "./pilot-pos.service.js";
import {
  type CancelItemInput,
  cancelItemSchema,
  type DiscountInput,
  type DispatchAcknowledgementInput,
  type DispatchReconcileInput,
  discountSchema,
  dispatchAcknowledgementSchema,
  dispatchReconcileSchema,
  dispatchStateSchema,
  type KdsStateInput,
  kdsStateSchema,
  type ManagerPinInput,
  type MergeTabsInput,
  managerPinSchema,
  mergeTabsSchema,
  type OpenTabInput,
  type OrderInput,
  openTabSchema,
  orderSchema,
  type RoomInput,
  roomSchema,
  type ServiceChargeInput,
  type SplitTabInput,
  serviceChargeSchema,
  splitTabSchema,
  type TableInput,
  type TipInput,
  type TransferTabInput,
  tableSchema,
  tipSchema,
  transferTabSchema,
} from "./pilot-schemas.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/pilot",
  "v1/organizations/:organizationId/units/:unitId/pilot",
])
export class PilotPosController {
  constructor(private readonly pos: PilotPosService) {}

  @Get("floor")
  floor(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.pos.listFloor(request.auth.identityId, organizationId, unitId);
  }

  @Post("rooms")
  createRoom(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(roomSchema)) body: RoomInput,
  ) {
    return this.pos.createRoom(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("rooms/:roomId/tables")
  createTable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Body(new ZodPipe(tableSchema)) body: TableInput,
  ) {
    return this.pos.createTable(request.auth.identityId, organizationId, unitId, roomId, body);
  }

  @Put("manager-pin")
  managerPin(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(managerPinSchema)) body: ManagerPinInput,
  ) {
    return this.pos.setManagerPin(request.auth.identityId, organizationId, unitId, body);
  }

  @Get("tabs")
  listTabs(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.pos.listTabs(request.auth.identityId, organizationId, unitId);
  }

  @Get("tabs/:tabId")
  getTab(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
  ) {
    return this.pos.getTab(request.auth.identityId, organizationId, unitId, tabId);
  }

  @Post("tabs/open")
  openTab(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(openTabSchema)) body: OpenTabInput,
  ) {
    return this.pos.openTab(request.auth.identityId, organizationId, unitId, idempotencyKey, body);
  }

  @Post("tabs/:tabId/orders")
  createOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(orderSchema)) body: OrderInput,
  ) {
    return this.pos.createOrder(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Post("orders/:orderId/send")
  sendOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.pos.sendOrder(
      request.auth.identityId,
      organizationId,
      unitId,
      orderId,
      idempotencyKey,
    );
  }

  @Get("dispatch")
  listDispatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query("state", new ZodPipe(dispatchStateSchema.optional()))
    state?: "pending" | "delivered" | "acked" | "canceled" | "dlq",
  ) {
    return this.pos.listDispatch(request.auth.identityId, organizationId, unitId, state);
  }

  @Post("orders/:orderId/stations/:stationId/dispatch")
  ensureDispatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("stationId", ParseUUIDPipe) stationId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.pos.ensureDispatchEffects(
      request.auth.identityId,
      organizationId,
      unitId,
      orderId,
      stationId,
      idempotencyKey,
    );
  }

  @Post("dispatch/:effectId/reprint")
  reprintDispatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("effectId", ParseUUIDPipe) effectId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.pos.reprintDispatch(
      request.auth.identityId,
      organizationId,
      unitId,
      effectId,
      idempotencyKey,
    );
  }

  @Post("dispatch/:effectId/cancel")
  cancelDispatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("effectId", ParseUUIDPipe) effectId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.pos.cancelDispatch(
      request.auth.identityId,
      organizationId,
      unitId,
      effectId,
      idempotencyKey,
    );
  }

  @Post("dispatch/:effectId/ack")
  acknowledgeDispatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("effectId", ParseUUIDPipe) effectId: string,
    @Body(new ZodPipe(dispatchAcknowledgementSchema)) body: DispatchAcknowledgementInput,
  ) {
    return this.pos.ackDispatch(
      request.auth.identityId,
      organizationId,
      unitId,
      effectId,
      body.acknowledgementKey,
    );
  }

  @Post("dispatch/:effectId/reconcile")
  reconcileDispatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("effectId", ParseUUIDPipe) effectId: string,
    @Body(new ZodPipe(dispatchReconcileSchema)) body: DispatchReconcileInput,
  ) {
    return this.pos.reconcileDispatch(
      request.auth.identityId,
      organizationId,
      unitId,
      effectId,
      body.expectedResourceVersion,
      body.action,
    );
  }

  @Post("tabs/:tabId/transfer")
  transfer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(transferTabSchema)) body: TransferTabInput,
  ) {
    return this.pos.transferTab(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Post("tabs/merge")
  merge(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(mergeTabsSchema)) body: MergeTabsInput,
  ) {
    return this.pos.mergeTabs(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("tabs/:tabId/split")
  split(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(splitTabSchema)) body: SplitTabInput,
  ) {
    return this.pos.splitTab(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Put("tabs/:tabId/service-charge")
  serviceCharge(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(serviceChargeSchema)) body: ServiceChargeInput,
  ) {
    return this.pos.setServiceCharge(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Put("tabs/:tabId/tip")
  tip(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(tipSchema)) body: TipInput,
  ) {
    return this.pos.setTip(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Post("items/:itemId/discount")
  discount(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(discountSchema)) body: DiscountInput,
  ) {
    return this.pos.discountItem(
      request.auth.identityId,
      organizationId,
      unitId,
      itemId,
      idempotencyKey,
      body,
    );
  }

  @Post("items/:itemId/cancel")
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cancelItemSchema)) body: CancelItemInput,
  ) {
    return this.pos.cancelItem(
      request.auth.identityId,
      organizationId,
      unitId,
      itemId,
      idempotencyKey,
      body,
    );
  }

  @Get("kds")
  kds(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query("stationId", new ParseUUIDPipe({ optional: true })) stationId?: string,
  ) {
    return this.pos.listKds(request.auth.identityId, organizationId, unitId, stationId);
  }

  @Post("kds/:ticketId/state")
  transitionKds(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsStateSchema)) body: KdsStateInput,
  ) {
    return this.pos.transitionKds(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      idempotencyKey,
      body,
    );
  }
}
