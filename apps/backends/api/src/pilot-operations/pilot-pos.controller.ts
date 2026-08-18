import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiOkResponse,
  ApiQuery,
  ApiServiceUnavailableResponse,
} from "@nestjs/swagger";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PilotPosService } from "./pilot-pos.service.js";
import {
  type ApprovalDecisionInput,
  type ApprovalRequestInput,
  approvalDecisionSchema,
  approvalRequestSchema,
  type CancelItemInput,
  type ClaimTabInput,
  type CloseOperationalShiftInput,
  type CloseTabInput,
  cancelItemSchema,
  claimTabSchema,
  closeOperationalShiftSchema,
  closeTabSchema,
  type DetachTableGroupInput,
  type DiscountInput,
  detachTableGroupSchema,
  discountSchema,
  type FloorLayoutInput,
  floorLayoutSchema,
  type KdsAnalyticsQueryInput,
  type KdsAttentionAcknowledgeInput,
  type KdsBatchCancelInput,
  type KdsBatchCompleteInput,
  type KdsBatchCreateInput,
  type KdsBlockInput,
  type KdsCancelInput,
  type KdsCourseStateInput,
  type KdsItemStateInput,
  type KdsOrderHandoffInput,
  type KdsOrderPriorityInput,
  type KdsPriorityInput,
  type KdsProductAvailabilityInput,
  type KdsRecallInput,
  type KdsRefireInput,
  type KdsRerouteInput,
  type KdsStateInput,
  type KdsTerminalProfileInput,
  type KdsUnblockInput,
  kdsAnalyticsQuerySchema,
  kdsAnalyticsResponseSchema,
  kdsAttentionAcknowledgeResponseSchema,
  kdsAttentionAcknowledgeSchema,
  kdsBatchCancelSchema,
  kdsBatchCompleteSchema,
  kdsBatchCreateSchema,
  kdsBatchReadSchema,
  kdsBlockResponseSchema,
  kdsBlockSchema,
  kdsCancelSchema,
  kdsConflictResponseSchema,
  kdsCourseStateSchema,
  kdsItemStateSchema,
  kdsMutationResponseSchema,
  kdsOrderHandoffSchema,
  kdsOrderPriorityResponseSchema,
  kdsOrderPrioritySchema,
  kdsPrioritySchema,
  kdsProductAvailabilityListResponseSchema,
  kdsProductAvailabilityResponseSchema,
  kdsProductAvailabilitySchema,
  kdsReadModelSchema,
  kdsRecallSchema,
  kdsRefireSchema,
  kdsRerouteResponseSchema,
  kdsRerouteSchema,
  kdsStateSchema,
  kdsTerminalProfileResponseSchema,
  kdsTerminalProfileSchema,
  kdsUnavailableResponseSchema,
  kdsUnblockSchema,
  type ManagerPinInput,
  type MergeTabsInput,
  type MoveItemsInput,
  managerPinSchema,
  mergeTabsSchema,
  moveItemsSchema,
  type OpenOperationalShiftInput,
  type OpenTabInput,
  type OrderInput,
  openOperationalShiftSchema,
  openTabSchema,
  orderSchema,
  type PaymentInput,
  type PrintJobInput,
  type PrintJobQueryInput,
  type PrintJobStatusInput,
  paymentSchema,
  printJobQuerySchema,
  printJobSchema,
  printJobStatusSchema,
  type ReopenTabInput,
  type ReprintJobInput,
  type RetryPrintJobInput,
  type RoomInput,
  reopenTabSchema,
  reprintJobSchema,
  retryPrintJobSchema,
  roomSchema,
  type ServiceCallInput,
  type ServiceChargeInput,
  type ServiceSectionInput,
  type ShiftLayoutInput,
  type ShiftSectionAssignmentInput,
  type ShiftSectionCoverageInput,
  type SplitTabInput,
  serviceCallSchema,
  serviceChargeSchema,
  serviceSectionSchema,
  shiftLayoutSchema,
  shiftSectionAssignmentSchema,
  shiftSectionCoverageSchema,
  splitTabSchema,
  type TableBatchInput,
  type TableGroupInput,
  type TableInput,
  type TableTurnoverInput,
  type TemporaryTableTransferInput,
  type TipInput,
  type TransferTabInput,
  tableBatchSchema,
  tableGroupSchema,
  tableSchema,
  tableTurnoverSchema,
  temporaryTableTransferSchema,
  tipSchema,
  transferTabSchema,
  type UpdateTabInput,
  updateTabSchema,
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

  @Put("floor/layout")
  updateFloorLayout(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(floorLayoutSchema)) body: FloorLayoutInput,
  ) {
    return this.pos.updateFloorLayout(request.auth.identityId, organizationId, unitId, body);
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

  @Put("tables/:tableId/turnover")
  updateTableTurnover(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tableId", ParseUUIDPipe) tableId: string,
    @Body(new ZodPipe(tableTurnoverSchema)) body: TableTurnoverInput,
  ) {
    return this.pos.updateTableTurnover(
      request.auth.identityId,
      organizationId,
      unitId,
      tableId,
      body,
    );
  }

  @Post("service-sections")
  createServiceSection(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(serviceSectionSchema)) body: ServiceSectionInput,
  ) {
    return this.pos.createServiceSection(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("shifts/open")
  openOperationalShift(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(openOperationalShiftSchema)) body: OpenOperationalShiftInput,
  ) {
    return this.pos.openOperationalShift(request.auth.identityId, organizationId, unitId, body);
  }

  @Put("shifts/:shiftId/sections/:shiftSectionId")
  updateShiftSectionAssignment(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("shiftId", ParseUUIDPipe) shiftId: string,
    @Param("shiftSectionId", ParseUUIDPipe) shiftSectionId: string,
    @Body(new ZodPipe(shiftSectionAssignmentSchema)) body: ShiftSectionAssignmentInput,
  ) {
    return this.pos.updateShiftSectionAssignment(
      request.auth.identityId,
      organizationId,
      unitId,
      shiftId,
      shiftSectionId,
      body,
    );
  }

  @Put("shifts/:shiftId/sections/:shiftSectionId/coverage")
  updateShiftSectionCoverage(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("shiftId", ParseUUIDPipe) shiftId: string,
    @Param("shiftSectionId", ParseUUIDPipe) shiftSectionId: string,
    @Body(new ZodPipe(shiftSectionCoverageSchema)) body: ShiftSectionCoverageInput,
  ) {
    return this.pos.updateShiftSectionCoverage(
      request.auth.identityId,
      organizationId,
      unitId,
      shiftId,
      shiftSectionId,
      body,
    );
  }

  @Post("shifts/:shiftId/close")
  closeOperationalShift(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("shiftId", ParseUUIDPipe) shiftId: string,
    @Body(new ZodPipe(closeOperationalShiftSchema)) body: CloseOperationalShiftInput,
  ) {
    return this.pos.closeOperationalShift(
      request.auth.identityId,
      organizationId,
      unitId,
      shiftId,
      body,
    );
  }

  @Post("shifts/:shiftId/tables/:tableId/transfer")
  transferShiftTable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("shiftId", ParseUUIDPipe) shiftId: string,
    @Param("tableId", ParseUUIDPipe) tableId: string,
    @Body(new ZodPipe(temporaryTableTransferSchema)) body: TemporaryTableTransferInput,
  ) {
    return this.pos.transferShiftTable(
      request.auth.identityId,
      organizationId,
      unitId,
      shiftId,
      tableId,
      body,
    );
  }

  @Delete("shifts/:shiftId/tables/:tableId/transfer")
  endShiftTableTransfer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("shiftId", ParseUUIDPipe) shiftId: string,
    @Param("tableId", ParseUUIDPipe) tableId: string,
  ) {
    return this.pos.endShiftTableTransfer(
      request.auth.identityId,
      organizationId,
      unitId,
      shiftId,
      tableId,
    );
  }

  @Put("shifts/:shiftId/layout")
  updateShiftLayout(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("shiftId", ParseUUIDPipe) shiftId: string,
    @Body(new ZodPipe(shiftLayoutSchema)) body: ShiftLayoutInput,
  ) {
    return this.pos.updateShiftLayout(
      request.auth.identityId,
      organizationId,
      unitId,
      shiftId,
      body,
    );
  }

  @Post("rooms/:roomId/tables/batch")
  createTables(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Body(new ZodPipe(tableBatchSchema)) body: TableBatchInput,
  ) {
    return this.pos.createTables(request.auth.identityId, organizationId, unitId, roomId, body);
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

  @Put("tabs/:tabId")
  updateTab(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Body(new ZodPipe(updateTabSchema)) body: UpdateTabInput,
  ) {
    return this.pos.updateTab(request.auth.identityId, organizationId, unitId, tabId, body);
  }

  @Post("tabs/:tabId/claim")
  claimTab(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Body(new ZodPipe(claimTabSchema)) body: ClaimTabInput,
  ) {
    return this.pos.claimTab(request.auth.identityId, organizationId, unitId, tabId, body);
  }

  @Put("tabs/:tabId/presence")
  touchPresence(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
  ) {
    return this.pos.touchPresence(request.auth.identityId, organizationId, unitId, tabId);
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

  @Post("tabs/:tabId/items/move")
  moveItems(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(moveItemsSchema)) body: MoveItemsInput,
  ) {
    return this.pos.moveItems(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Post("tabs/:tabId/payments")
  recordPayment(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(paymentSchema)) body: PaymentInput,
  ) {
    return this.pos.recordPayment(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Post("tabs/:tabId/print-jobs")
  createPrintJob(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(printJobSchema)) body: PrintJobInput,
  ) {
    return this.pos.createPrintJob(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Get("print-jobs")
  listPrintJobs(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(printJobQuerySchema)) query: PrintJobQueryInput,
  ) {
    return this.pos.listPrintJobs(request.auth.identityId, organizationId, unitId, query);
  }

  @Put("print-jobs/:printJobId/status")
  updatePrintJobStatus(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("printJobId", ParseUUIDPipe) printJobId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(printJobStatusSchema)) body: PrintJobStatusInput,
  ) {
    return this.pos.updatePrintJobStatus(
      request.auth.identityId,
      organizationId,
      unitId,
      printJobId,
      idempotencyKey,
      body,
    );
  }

  @Post("print-jobs/:printJobId/retry")
  retryPrintJob(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("printJobId", ParseUUIDPipe) printJobId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(retryPrintJobSchema)) body: RetryPrintJobInput,
  ) {
    return this.pos.retryPrintJob(
      request.auth.identityId,
      organizationId,
      unitId,
      printJobId,
      idempotencyKey,
      body,
    );
  }

  @Post("print-jobs/:printJobId/reprint")
  reprintJob(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("printJobId", ParseUUIDPipe) printJobId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reprintJobSchema)) body: ReprintJobInput,
  ) {
    return this.pos.reprintJob(
      request.auth.identityId,
      organizationId,
      unitId,
      printJobId,
      idempotencyKey,
      body,
    );
  }

  @Post("tabs/:tabId/close")
  closeTab(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(closeTabSchema)) body: CloseTabInput,
  ) {
    return this.pos.closeTab(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Post("tabs/:tabId/reopen")
  reopenTab(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reopenTabSchema)) body: ReopenTabInput,
  ) {
    return this.pos.reopenTab(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Post("tabs/:tabId/approval-requests")
  requestApproval(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(approvalRequestSchema)) body: ApprovalRequestInput,
  ) {
    return this.pos.requestApproval(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      body,
    );
  }

  @Get("approval-requests")
  approvalRequests(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.pos.listApprovalRequests(request.auth.identityId, organizationId, unitId);
  }

  @Post("approval-requests/:requestId/approve")
  approveRequest(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(approvalDecisionSchema)) body: ApprovalDecisionInput,
  ) {
    return this.pos.decideApprovalRequest(
      request.auth.identityId,
      organizationId,
      unitId,
      requestId,
      "approved",
      idempotencyKey,
      body,
    );
  }

  @Post("approval-requests/:requestId/reject")
  rejectRequest(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(approvalDecisionSchema)) body: ApprovalDecisionInput,
  ) {
    return this.pos.decideApprovalRequest(
      request.auth.identityId,
      organizationId,
      unitId,
      requestId,
      "rejected",
      idempotencyKey,
      body,
    );
  }

  @Post("tabs/:tabId/notify-ready")
  notifyReady(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tabId", ParseUUIDPipe) tabId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.pos.notifyReady(
      request.auth.identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
    );
  }

  @Post("tables/:tableId/calls")
  createServiceCall(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tableId", ParseUUIDPipe) tableId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(serviceCallSchema)) body: ServiceCallInput,
  ) {
    return this.pos.createServiceCall(
      request.auth.identityId,
      organizationId,
      unitId,
      tableId,
      idempotencyKey,
      body,
    );
  }

  @Post("calls/:callId/acknowledge")
  acknowledgeServiceCall(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("callId", ParseUUIDPipe) callId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.pos.transitionServiceCall(
      request.auth.identityId,
      organizationId,
      unitId,
      callId,
      "acknowledged",
      idempotencyKey,
    );
  }

  @Post("calls/:callId/resolve")
  resolveServiceCall(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("callId", ParseUUIDPipe) callId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.pos.transitionServiceCall(
      request.auth.identityId,
      organizationId,
      unitId,
      callId,
      "resolved",
      idempotencyKey,
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

  @Post("table-groups")
  groupTables(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(tableGroupSchema)) body: TableGroupInput,
  ) {
    return this.pos.groupTables(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("table-groups/:groupId/detach")
  detachTableGroup(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(detachTableGroupSchema)) body: DetachTableGroupInput,
  ) {
    return this.pos.detachTableGroup(
      request.auth.identityId,
      organizationId,
      unitId,
      groupId,
      idempotencyKey,
      body,
    );
  }

  @Post("table-groups/:groupId/dissolve")
  dissolveTableGroup(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.pos.dissolveTableGroup(
      request.auth.identityId,
      organizationId,
      unitId,
      groupId,
      idempotencyKey,
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
  @ApiQuery({ name: "stationId", required: false, format: "uuid" })
  @ApiOkResponse({ schema: toOpenApiSchema(kdsReadModelSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  kds(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query("stationId", new ParseUUIDPipe({ optional: true })) stationId?: string,
  ) {
    return this.pos.listKds(request.auth.identityId, organizationId, unitId, stationId);
  }

  @Get("kds/analytics")
  @ApiQuery({ name: "stationId", required: false, format: "uuid" })
  @ApiQuery({ name: "windowHours", required: false, type: Number })
  @ApiOkResponse({ schema: toOpenApiSchema(kdsAnalyticsResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  kdsAnalytics(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(kdsAnalyticsQuerySchema)) query: KdsAnalyticsQueryInput,
  ) {
    return this.pos.kdsAnalytics(request.auth.identityId, organizationId, unitId, query);
  }

  @Get("kds/products/availability")
  @ApiOkResponse({ schema: toOpenApiSchema(kdsProductAvailabilityListResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  listKdsProductAvailability(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.pos.listKdsProductAvailability(request.auth.identityId, organizationId, unitId);
  }

  @Get("kds/terminals/:installationId")
  @ApiOkResponse({ schema: toOpenApiSchema(kdsTerminalProfileResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  getKdsTerminalProfile(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("installationId", ParseUUIDPipe) installationId: string,
  ) {
    return this.pos.getKdsTerminalProfile(
      request.auth.identityId,
      organizationId,
      unitId,
      installationId,
    );
  }

  @Put("kds/terminals/:installationId")
  @ApiOkResponse({ schema: toOpenApiSchema(kdsTerminalProfileResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  putKdsTerminalProfile(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("installationId", ParseUUIDPipe) installationId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsTerminalProfileSchema)) body: KdsTerminalProfileInput,
  ) {
    return this.pos.putKdsTerminalProfile(
      request.auth.identityId,
      organizationId,
      unitId,
      installationId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/batches")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsBatchReadSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  createKdsBatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsBatchCreateSchema)) body: KdsBatchCreateInput,
  ) {
    return this.pos.createKdsBatch(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/batches/:batchId/complete")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsBatchReadSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  completeKdsBatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("batchId", ParseUUIDPipe) batchId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsBatchCompleteSchema)) body: KdsBatchCompleteInput,
  ) {
    return this.pos.completeKdsBatch(
      request.auth.identityId,
      organizationId,
      unitId,
      batchId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/batches/:batchId/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsBatchReadSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  cancelKdsBatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("batchId", ParseUUIDPipe) batchId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsBatchCancelSchema)) body: KdsBatchCancelInput,
  ) {
    return this.pos.cancelKdsBatch(
      request.auth.identityId,
      organizationId,
      unitId,
      batchId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/:ticketId/state")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsMutationResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
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

  @Post("kds/:ticketId/items/:orderItemId/state")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsMutationResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  transitionKdsItem(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Param("orderItemId", ParseUUIDPipe) orderItemId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsItemStateSchema)) body: KdsItemStateInput,
  ) {
    return this.pos.transitionKdsItem(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      orderItemId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/:ticketId/items/:orderItemId/block")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsBlockResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  blockKdsItem(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Param("orderItemId", ParseUUIDPipe) orderItemId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsBlockSchema)) body: KdsBlockInput,
  ) {
    return this.pos.blockKdsItem(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      orderItemId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/:ticketId/items/:orderItemId/unblock")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsBlockResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  unblockKdsItem(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Param("orderItemId", ParseUUIDPipe) orderItemId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsUnblockSchema)) body: KdsUnblockInput,
  ) {
    return this.pos.unblockKdsItem(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      orderItemId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/:ticketId/items/:orderItemId/attention/acknowledge")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsAttentionAcknowledgeResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  acknowledgeKdsAttention(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Param("orderItemId", ParseUUIDPipe) orderItemId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsAttentionAcknowledgeSchema)) body: KdsAttentionAcknowledgeInput,
  ) {
    return this.pos.acknowledgeKdsAttention(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      orderItemId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/:ticketId/items/:orderItemId/reroute")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsRerouteResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  rerouteKdsItem(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Param("orderItemId", ParseUUIDPipe) orderItemId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsRerouteSchema)) body: KdsRerouteInput,
  ) {
    return this.pos.rerouteKdsItem(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      orderItemId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/:ticketId/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsMutationResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  cancelKdsTicket(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsCancelSchema)) body: KdsCancelInput,
  ) {
    return this.pos.cancelKdsTicket(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/:ticketId/recall")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsMutationResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  recallKdsTicket(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsRecallSchema)) body: KdsRecallInput,
  ) {
    return this.pos.recallKdsTicket(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/:ticketId/items/:orderItemId/refire")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsMutationResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  refireKdsItem(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Param("orderItemId", ParseUUIDPipe) orderItemId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsRefireSchema)) body: KdsRefireInput,
  ) {
    return this.pos.refireKdsItem(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      orderItemId,
      idempotencyKey,
      body,
    );
  }

  @Put("kds/:ticketId/priority")
  @ApiOkResponse({ schema: toOpenApiSchema(kdsMutationResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  setKdsPriority(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsPrioritySchema)) body: KdsPriorityInput,
  ) {
    return this.pos.setKdsPriority(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/:ticketId/course")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsMutationResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  setKdsCourseState(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsCourseStateSchema)) body: KdsCourseStateInput,
  ) {
    return this.pos.setKdsCourseState(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      idempotencyKey,
      body,
    );
  }

  @Post("kds/orders/:orderId/handoff")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: toOpenApiSchema(kdsMutationResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  handoffKdsOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsOrderHandoffSchema)) body: KdsOrderHandoffInput,
  ) {
    return this.pos.handoffKdsOrder(
      request.auth.identityId,
      organizationId,
      unitId,
      orderId,
      idempotencyKey,
      body,
    );
  }

  @Put("kds/orders/:orderId/priority")
  @ApiOkResponse({ schema: toOpenApiSchema(kdsOrderPriorityResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  setKdsOrderPriority(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsOrderPrioritySchema)) body: KdsOrderPriorityInput,
  ) {
    return this.pos.setKdsOrderPriority(
      request.auth.identityId,
      organizationId,
      unitId,
      orderId,
      idempotencyKey,
      body,
    );
  }

  @Put("kds/products/:productId/availability")
  @ApiOkResponse({ schema: toOpenApiSchema(kdsProductAvailabilityResponseSchema) })
  @ApiConflictResponse({ schema: toOpenApiSchema(kdsConflictResponseSchema) })
  @ApiServiceUnavailableResponse({ schema: toOpenApiSchema(kdsUnavailableResponseSchema) })
  setKdsProductAvailability(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(kdsProductAvailabilitySchema)) body: KdsProductAvailabilityInput,
  ) {
    return this.pos.setKdsProductAvailability(
      request.auth.identityId,
      organizationId,
      unitId,
      productId,
      idempotencyKey,
      body,
    );
  }
}
