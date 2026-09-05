import {
  type ArgumentsHost,
  Body,
  Catch,
  ConflictException,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type CashApprovalDecisionInput,
  type CashMovementInput,
  type CashRegisterCreateInput,
  type CashRegisterUpdateInput,
  type CashSettingsInput,
  type CashShiftExportQuery,
  type CashShiftHandoverInput,
  type CashShiftHistoryQuery,
  type CashShiftReviewInput,
  type CashTerminalUpdateInput,
  type CashTransferDecisionInput,
  type CashTransferInput,
  type ClockOutInput,
  type CloseCashShiftInput,
  type CommissionInput,
  type CommissionRuleInput,
  type CommissionTransitionInput,
  cashApprovalDecisionSchema,
  cashMovementSchema,
  cashRegisterCreateSchema,
  cashRegisterUpdateSchema,
  cashSettingsSchema,
  cashShiftExportQuerySchema,
  cashShiftHandoverSchema,
  cashShiftHistoryQuerySchema,
  cashShiftReviewSchema,
  cashTerminalUpdateSchema,
  cashTransferDecisionSchema,
  cashTransferSchema,
  clockOutSchema,
  closeCashShiftSchema,
  commissionRuleSchema,
  commissionSchema,
  commissionTransitionSchema,
  type FinanceApprovalDecisionInput,
  type FinanceApprovalRequestInput,
  type FinanceEntryCancelInput,
  type FinanceEntryUpdateInput,
  type FinanceExportQuery,
  type FinanceListQuery,
  type FinancePaymentReversalInput,
  type FinanceReconciliationResolutionInput,
  type FinanceSettingsInput,
  type FinancialPaymentInput,
  financeApprovalDecisionSchema,
  financeApprovalRequestSchema,
  financeEntryCancelSchema,
  financeEntryUpdateSchema,
  financeExportQuerySchema,
  financeListQuerySchema,
  financePaymentReversalSchema,
  financeReconciliationResolutionSchema,
  financeSettingsSchema,
  financialPaymentSchema,
  type InterunitTransferCancellationInput,
  type InterunitTransferInput,
  type InterunitTransferReceiptInput,
  type InventoryAssetInput,
  type InventoryAssetUpdateInput,
  type InventoryClosingInput,
  type InventoryEventInput,
  type InventoryIssueRouteInput,
  type InventoryItemInput,
  type InventoryItemUpdateInput,
  type InventoryLotInput,
  type InventoryLotUpdateInput,
  type InventoryReservationInput,
  type InventoryReservationResolutionInput,
  type InventoryReviewInput,
  type InventoryTransferBatchInput,
  type InventoryTransferInput,
  type InventoryTransferResolutionInput,
  interunitTransferCancellationSchema,
  interunitTransferReceiptSchema,
  interunitTransferSchema,
  inventoryAssetSchema,
  inventoryAssetUpdateSchema,
  inventoryClosingSchema,
  inventoryEventSchema,
  inventoryIssueRouteSchema,
  inventoryItemSchema,
  inventoryItemUpdateSchema,
  inventoryLotSchema,
  inventoryLotUpdateSchema,
  inventoryReservationResolutionSchema,
  inventoryReservationSchema,
  inventoryReviewSchema,
  inventoryTransferBatchSchema,
  inventoryTransferResolutionSchema,
  inventoryTransferSchema,
  type NfeImportConfirmInput,
  type NfeImportInput,
  type NfeImportReviewInput,
  nfeImportConfirmSchema,
  nfeImportReviewSchema,
  nfeImportSchema,
  type OpenCashShiftInput,
  type OverviewPreferencesInput,
  type OverviewPriorityActionInput,
  type OverviewQueryInput,
  openCashShiftSchema,
  overviewPreferencesSchema,
  overviewPriorityActionSchema,
  overviewQuerySchema,
  type PayableInput,
  type PeopleAssignmentBatchInput,
  type PeopleExportInput,
  type PeopleListQuery,
  type PersonAccessInviteInput,
  type PersonAccessReactivateInput,
  type PersonAccessRoleUpdateInput,
  type PersonInput,
  type PersonStatusInput,
  type PersonUnitAccessInput,
  type PersonUnitAccessRemovalInput,
  type PersonUpdateInput,
  type ProductionBatchCancellationInput,
  type ProductionBatchCompletionInput,
  type ProductionBatchInput,
  type ProductReturnableClassificationInput,
  type ProductReturnableConfigurationInput,
  type ProductReturnableInput,
  type PurchaseInvoiceConfirmInput,
  type PurchaseListQuery,
  type PurchaseOrderInput,
  type PurchaseOrderUpdateInput,
  type PurchaseReceiptInput,
  type PurchaseReconciliationInput,
  type PurchaseReversalInput,
  type PurchaseTransitionInput,
  type PurchaseVersionInput,
  payableSchema,
  peopleAssignmentBatchSchema,
  peopleExportSchema,
  peopleListQuerySchema,
  personAccessInviteSchema,
  personAccessReactivateSchema,
  personAccessRoleUpdateSchema,
  personSchema,
  personStatusSchema,
  personUnitAccessRemovalSchema,
  personUnitAccessSchema,
  personUpdateSchema,
  productionBatchCancellationSchema,
  productionBatchCompletionSchema,
  productionBatchSchema,
  productReturnableClassificationSchema,
  productReturnableConfigurationSchema,
  productReturnableSchema,
  purchaseInvoiceConfirmSchema,
  purchaseListQuerySchema,
  purchaseOrderSchema,
  purchaseOrderUpdateSchema,
  purchaseReceiptSchema,
  purchaseReconciliationSchema,
  purchaseReversalSchema,
  purchaseTransitionSchema,
  purchaseVersionSchema,
  type ReceivableInput,
  type ReceivablePaymentInput,
  type RecipeConfigurationInput,
  type ReconciliationInput,
  type ReportPeriodInput,
  type ReturnableCustodyConfirmBulkInput,
  type ReturnableCustodyConfirmInput,
  type ReturnableCustodyHandoffInput,
  type ReturnableIncidentInput,
  type ReturnableIncidentReviewInput,
  type ReturnableSupplierExchangeInput,
  type ReturnableSupplierExchangeResolutionInput,
  receivablePaymentSchema,
  receivableSchema,
  recipeConfigurationSchema,
  reconciliationSchema,
  reportPeriodSchema,
  returnableCustodyConfirmBulkSchema,
  returnableCustodyConfirmSchema,
  returnableCustodyHandoffSchema,
  returnableIncidentReviewSchema,
  returnableIncidentSchema,
  returnableSupplierExchangeResolutionSchema,
  returnableSupplierExchangeSchema,
  type ScheduleBatchInput,
  type ScheduleCancelInput,
  type ScheduleInput,
  type ScheduleUpdateInput,
  type SelfBreakInput,
  type SelfClockInInput,
  type SelfClockOutInput,
  type StockLocationInput,
  type StockLocationItemSettingInput,
  type StockLocationUpdateInput,
  type SupplierInput,
  type SupplierInvoiceInput,
  type SupplierListQuery,
  type SupplierUpdateInput,
  scheduleBatchSchema,
  scheduleCancelSchema,
  scheduleSchema,
  scheduleUpdateSchema,
  selfBreakSchema,
  selfClockInSchema,
  selfClockOutSchema,
  stockLocationItemSettingSchema,
  stockLocationSchema,
  stockLocationUpdateSchema,
  supplierInvoiceSchema,
  supplierListQuerySchema,
  supplierSchema,
  supplierUpdateSchema,
  type TimeCorrectionDecisionInput,
  type TimeCorrectionInput,
  type TimeEntryInput,
  type TimeTrackingClosureInput,
  type TimeTrackingSettingsInput,
  timeCorrectionDecisionSchema,
  timeCorrectionSchema,
  timeEntrySchema,
  timeTrackingClosureSchema,
  timeTrackingSettingsSchema,
} from "./management.schemas.js";
import { ManagementService, type PunchContext } from "./management.service.js";
import { ManagementOverviewService } from "./management-overview.service.js";
import {
  type ReportAlertActionInput,
  type ReportAlertEvaluateInput,
  type ReportAlertListQuery,
  type ReportBudgetInput,
  type ReportCostBackfillInput,
  type ReportCostPreviewInput,
  type ReportDrillDownQuery,
  type ReportExportInput,
  type ReportExportListQuery,
  type ReportQueryInput,
  type ReportReconciliationClosureInput,
  type ReportScheduleCreateInput,
  type ReportScheduleDeleteInput,
  type ReportScheduleUpdateInput,
  type ReportViewCreateInput,
  type ReportViewDeleteInput,
  type ReportViewUpdateInput,
  reportAlertActionSchema,
  reportAlertEvaluateSchema,
  reportAlertListQuerySchema,
  reportBudgetInputSchema,
  reportBudgetMonthSchema,
  reportCostBackfillSchema,
  reportCostPreviewSchema,
  reportDrillDownQuerySchema,
  reportExportInputSchema,
  reportExportListQuerySchema,
  reportQuerySchema,
  reportReconciliationClosureSchema,
  reportScheduleCreateSchema,
  reportScheduleDeleteSchema,
  reportScheduleUpdateSchema,
  reportViewCreateSchema,
  reportViewDeleteSchema,
  reportViewUpdateSchema,
} from "./management-report.schemas.js";
import { ManagementReportService } from "./management-report.service.js";

function punchContext(request: AuthenticatedRequest): PunchContext {
  const userAgent = request.headers["user-agent"];
  return {
    ipAddress: request.ip,
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
  };
}

@Catch(DrizzleQueryError)
export class InventoryProductConflictFilter implements ExceptionFilter {
  catch(exception: DrizzleQueryError, host: ArgumentsHost) {
    const cause = exception.cause;
    if (
      typeof cause !== "object" ||
      !cause ||
      !("code" in cause) ||
      cause.code !== "23505" ||
      !("constraint_name" in cause) ||
      cause.constraint_name !== "management_inventory_items_resale_product_unique"
    )
      throw exception;
    const conflict = new ConflictException({
      code: "INVENTORY_PRODUCT_ALREADY_LINKED",
      message: "Este produto já está ligado a outro item de revenda ativo.",
    });
    const response = host.switchToHttp().getResponse<{
      status(code: number): { send(body: unknown): void };
    }>();
    response.status(conflict.getStatus()).send(conflict.getResponse());
  }
}

@UseGuards(SessionGuard)
@UseFilters(InventoryProductConflictFilter)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/management",
  "v1/organizations/:organizationId/units/:unitId/management",
])
export class ManagementController {
  constructor(
    private readonly management: ManagementService,
    private readonly overviewService: ManagementOverviewService,
    private readonly reportsService: ManagementReportService,
  ) {}

  @Get("overview")
  overview(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(overviewQuerySchema)) query: OverviewQueryInput,
  ) {
    return this.overviewService.overview(
      request.auth.identityId,
      organizationId,
      unitId,
      query.source,
    );
  }

  @Post("overview/priorities/:priorityId/actions")
  overviewPriorityAction(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("priorityId") priorityId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(overviewPriorityActionSchema)) body: OverviewPriorityActionInput,
  ) {
    return this.overviewService.updatePriority(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      priorityId,
      body,
    );
  }

  @Put("overview/preferences")
  overviewPreferences(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(overviewPreferencesSchema)) body: OverviewPreferencesInput,
  ) {
    return this.management.updateOverviewPreferences(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("overview/visit")
  overviewVisit(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.management.markOverviewVisited(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
    );
  }

  @Get("inventory")
  inventory(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.inventoryDashboard(request.auth.identityId, organizationId, unitId);
  }

  @Post("inventory/locations")
  createLocation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(stockLocationSchema)) body: StockLocationInput,
  ) {
    return this.management.createStockLocation(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Put("inventory/locations/:locationId")
  updateLocation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("locationId", ParseUUIDPipe) locationId: string,
    @Body(new ZodPipe(stockLocationUpdateSchema)) body: StockLocationUpdateInput,
  ) {
    return this.management.updateStockLocation(
      request.auth.identityId,
      organizationId,
      unitId,
      locationId,
      body,
    );
  }

  @Delete("inventory/locations/:locationId")
  archiveLocation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("locationId", ParseUUIDPipe) locationId: string,
  ) {
    return this.management.archiveStockLocation(
      request.auth.identityId,
      organizationId,
      unitId,
      locationId,
    );
  }

  @Post("inventory/items")
  createItem(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryItemSchema)) body: InventoryItemInput,
  ) {
    return this.management.createInventoryItem(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("inventory/returnables")
  returnables(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.returnablesDashboard(request.auth.identityId, organizationId, unitId);
  }

  @Post("inventory/returnables/configurations")
  configureReturnable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(productReturnableSchema)) body: ProductReturnableInput,
  ) {
    return this.management.configureProductReturnable(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Put("inventory/returnables/products/:productId/configuration")
  reconcileProductReturnableConfiguration(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(productReturnableConfigurationSchema))
    body: ProductReturnableConfigurationInput,
  ) {
    return this.management.reconcileProductReturnableConfiguration(
      request.auth.identityId,
      organizationId,
      unitId,
      productId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/returnables/custody/confirm")
  confirmReturnableCustody(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableCustodyConfirmSchema)) body: ReturnableCustodyConfirmInput,
  ) {
    return this.management.confirmReturnableCustody(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/returnables/custody/confirm-bulk")
  confirmReturnableCustodyBulk(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableCustodyConfirmBulkSchema)) body: ReturnableCustodyConfirmBulkInput,
  ) {
    return this.management.confirmReturnableCustodyBulk(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/returnables/custody/handoffs")
  handoffReturnableCustodies(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableCustodyHandoffSchema)) body: ReturnableCustodyHandoffInput,
  ) {
    return this.management.handoffReturnableCustodies(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Put("inventory/returnables/products/:productId/classification")
  classifyProductReturnable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(productReturnableClassificationSchema))
    body: ProductReturnableClassificationInput,
  ) {
    return this.management.classifyProductReturnable(
      request.auth.identityId,
      organizationId,
      unitId,
      productId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/returnables/incidents")
  createReturnableIncident(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableIncidentSchema)) body: ReturnableIncidentInput,
  ) {
    return this.management.createReturnableIncident(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/returnables/incidents/:incidentId/review")
  reviewReturnableIncident(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("incidentId", ParseUUIDPipe) incidentId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableIncidentReviewSchema)) body: ReturnableIncidentReviewInput,
  ) {
    return this.management.reviewReturnableIncident(
      request.auth.identityId,
      organizationId,
      unitId,
      incidentId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/returnables/supplier-exchanges")
  exchangeReturnablesWithSupplier(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableSupplierExchangeSchema)) body: ReturnableSupplierExchangeInput,
  ) {
    return this.management.exchangeReturnablesWithSupplier(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/returnables/supplier-exchanges/:exchangeId/resolve")
  resolveReturnableSupplierExchange(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("exchangeId", ParseUUIDPipe) exchangeId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(returnableSupplierExchangeResolutionSchema))
    body: ReturnableSupplierExchangeResolutionInput,
  ) {
    return this.management.resolveReturnableSupplierExchange(
      request.auth.identityId,
      organizationId,
      unitId,
      exchangeId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/issue-routes")
  configureInventoryIssueRoute(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryIssueRouteSchema)) body: InventoryIssueRouteInput,
  ) {
    return this.management.configureInventoryIssueRoute(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Put("inventory/location-item-settings")
  configureStockLocationItemSetting(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(stockLocationItemSettingSchema)) body: StockLocationItemSettingInput,
  ) {
    return this.management.configureStockLocationItemSetting(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Put("inventory/items/:inventoryItemId")
  updateItem(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("inventoryItemId", ParseUUIDPipe) inventoryItemId: string,
    @Body(new ZodPipe(inventoryItemUpdateSchema)) body: InventoryItemUpdateInput,
  ) {
    return this.management.updateInventoryItem(
      request.auth.identityId,
      organizationId,
      unitId,
      inventoryItemId,
      body,
    );
  }

  @Delete("inventory/items/:inventoryItemId")
  archiveItem(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("inventoryItemId", ParseUUIDPipe) inventoryItemId: string,
  ) {
    return this.management.archiveInventoryItem(
      request.auth.identityId,
      organizationId,
      unitId,
      inventoryItemId,
    );
  }

  @Post("inventory/events")
  createInventoryEvent(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryEventSchema)) body: InventoryEventInput,
  ) {
    return this.management.recordInventoryEvent(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/events/reviews/:requestId")
  reviewInventoryEvent(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryReviewSchema)) body: InventoryReviewInput,
  ) {
    return this.management.reviewInventoryEvent(
      request.auth.identityId,
      organizationId,
      unitId,
      requestId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/transfers")
  transferInventory(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryTransferSchema)) body: InventoryTransferInput,
  ) {
    return this.management.transferInventory(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/transfers/batches")
  transferInventoryBatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryTransferBatchSchema)) body: InventoryTransferBatchInput,
  ) {
    return this.management.transferInventoryBatch(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/transfers/:transferId/resolve")
  resolveInventoryTransfer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("transferId", ParseUUIDPipe) transferId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryTransferResolutionSchema)) body: InventoryTransferResolutionInput,
  ) {
    return this.management.resolveInventoryTransfer(
      request.auth.identityId,
      organizationId,
      unitId,
      transferId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/reservations")
  createInventoryReservation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryReservationSchema)) body: InventoryReservationInput,
  ) {
    return this.management.createInventoryReservation(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/reservations/:reservationId/resolve")
  resolveInventoryReservation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("reservationId", ParseUUIDPipe) reservationId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryReservationResolutionSchema))
    body: InventoryReservationResolutionInput,
  ) {
    return this.management.resolveInventoryReservation(
      request.auth.identityId,
      organizationId,
      unitId,
      reservationId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/cycle-count-plan/generate")
  generateCycleCountPlan(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.management.generateCycleCountPlan(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
    );
  }

  @Post("inventory/production-batches")
  createProductionBatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(productionBatchSchema)) body: ProductionBatchInput,
  ) {
    return this.management.createProductionBatch(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/production-batches/:batchId/complete")
  completeProductionBatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("batchId", ParseUUIDPipe) batchId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(productionBatchCompletionSchema)) body: ProductionBatchCompletionInput,
  ) {
    return this.management.completeProductionBatch(
      request.auth.identityId,
      organizationId,
      unitId,
      batchId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/production-batches/:batchId/cancel")
  cancelProductionBatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("batchId", ParseUUIDPipe) batchId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(productionBatchCancellationSchema)) body: ProductionBatchCancellationInput,
  ) {
    return this.management.cancelProductionBatch(
      request.auth.identityId,
      organizationId,
      unitId,
      batchId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/interunit-transfers")
  createInterunitTransfer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(interunitTransferSchema)) body: InterunitTransferInput,
  ) {
    return this.management.createInterunitTransfer(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/interunit-transfers/:transferId/receive")
  receiveInterunitTransfer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("transferId", ParseUUIDPipe) transferId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(interunitTransferReceiptSchema)) body: InterunitTransferReceiptInput,
  ) {
    return this.management.receiveInterunitTransfer(
      request.auth.identityId,
      organizationId,
      unitId,
      transferId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/interunit-transfers/:transferId/cancel")
  cancelInterunitTransfer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("transferId", ParseUUIDPipe) transferId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(interunitTransferCancellationSchema))
    body: InterunitTransferCancellationInput,
  ) {
    return this.management.cancelInterunitTransfer(
      request.auth.identityId,
      organizationId,
      unitId,
      transferId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/closings")
  closeInventoryPeriod(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryClosingSchema)) body: InventoryClosingInput,
  ) {
    return this.management.closeInventoryPeriod(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("inventory/assets")
  createInventoryAsset(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryAssetSchema)) body: InventoryAssetInput,
  ) {
    return this.management.createInventoryAsset(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Put("inventory/assets/:assetId")
  updateInventoryAsset(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("assetId", ParseUUIDPipe) assetId: string,
    @Body(new ZodPipe(inventoryAssetUpdateSchema)) body: InventoryAssetUpdateInput,
  ) {
    return this.management.updateInventoryAsset(
      request.auth.identityId,
      organizationId,
      unitId,
      assetId,
      body,
    );
  }

  @Post("inventory/lots")
  createInventoryLot(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(inventoryLotSchema)) body: InventoryLotInput,
  ) {
    return this.management.createInventoryLot(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Put("inventory/lots/:lotId")
  updateInventoryLot(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("lotId", ParseUUIDPipe) lotId: string,
    @Body(new ZodPipe(inventoryLotUpdateSchema)) body: InventoryLotUpdateInput,
  ) {
    return this.management.updateInventoryLot(
      request.auth.identityId,
      organizationId,
      unitId,
      lotId,
      body,
    );
  }

  @Get("inventory/recipes")
  recipes(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.listRecipeConfigurations(
      request.auth.identityId,
      organizationId,
      unitId,
    );
  }

  @Post("inventory/recipes")
  configureRecipe(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(recipeConfigurationSchema)) body: RecipeConfigurationInput,
  ) {
    return this.management.configureRecipe(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("suppliers")
  suppliers(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(supplierListQuerySchema)) query: SupplierListQuery,
  ) {
    return this.management.listSuppliers(request.auth.identityId, organizationId, unitId, query);
  }

  @Put("suppliers/:supplierId")
  updateSupplier(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("supplierId", ParseUUIDPipe) supplierId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(supplierUpdateSchema)) body: SupplierUpdateInput,
  ) {
    return this.management.updateSupplier(
      request.auth.identityId,
      organizationId,
      unitId,
      supplierId,
      idempotencyKey,
      body,
    );
  }

  @Delete("suppliers/:supplierId")
  archiveSupplier(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("supplierId", ParseUUIDPipe) supplierId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseVersionSchema)) body: PurchaseVersionInput,
  ) {
    return this.management.archiveSupplier(
      request.auth.identityId,
      organizationId,
      unitId,
      supplierId,
      idempotencyKey,
      body,
    );
  }

  @Post("suppliers")
  createSupplier(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(supplierSchema)) body: SupplierInput,
  ) {
    return this.management.createSupplier(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("purchases")
  purchases(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(purchaseListQuerySchema)) query: PurchaseListQuery,
  ) {
    return this.management.listPurchases(request.auth.identityId, organizationId, unitId, query);
  }

  @Post("purchases")
  createPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseOrderSchema)) body: PurchaseOrderInput,
  ) {
    return this.management.createPurchaseOrder(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/nfe-imports")
  importNfe(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(nfeImportSchema)) body: NfeImportInput,
  ) {
    return this.management.importNfe(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Put("purchases/nfe-imports/:importId/review")
  reviewNfeImport(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("importId", ParseUUIDPipe) importId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(nfeImportReviewSchema)) body: NfeImportReviewInput,
  ) {
    return this.management.reviewNfeImport(
      request.auth.identityId,
      organizationId,
      unitId,
      importId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/nfe-imports/:importId/confirm")
  confirmNfeImport(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("importId", ParseUUIDPipe) importId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(nfeImportConfirmSchema)) body: NfeImportConfirmInput,
  ) {
    return this.management.confirmNfeImport(
      request.auth.identityId,
      organizationId,
      unitId,
      importId,
      idempotencyKey,
      body,
    );
  }

  @Put("purchases/:purchaseOrderId")
  updatePurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("purchaseOrderId", ParseUUIDPipe) purchaseOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseOrderUpdateSchema)) body: PurchaseOrderUpdateInput,
  ) {
    return this.management.updatePurchaseOrder(
      request.auth.identityId,
      organizationId,
      unitId,
      purchaseOrderId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/:purchaseOrderId/cancel")
  cancelPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("purchaseOrderId", ParseUUIDPipe) purchaseOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseTransitionSchema)) body: PurchaseTransitionInput,
  ) {
    return this.management.cancelPurchaseOrder(
      request.auth.identityId,
      organizationId,
      unitId,
      purchaseOrderId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/:purchaseOrderId/reject")
  rejectPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("purchaseOrderId", ParseUUIDPipe) purchaseOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseTransitionSchema)) body: PurchaseTransitionInput,
  ) {
    return this.management.rejectPurchaseOrder(
      request.auth.identityId,
      organizationId,
      unitId,
      purchaseOrderId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/:purchaseOrderId/approve")
  approvePurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("purchaseOrderId", ParseUUIDPipe) purchaseOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseVersionSchema)) body: PurchaseVersionInput,
  ) {
    return this.management.approvePurchaseOrder(
      request.auth.identityId,
      organizationId,
      unitId,
      purchaseOrderId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/:purchaseOrderId/receipts")
  receivePurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("purchaseOrderId", ParseUUIDPipe) purchaseOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseReceiptSchema)) body: PurchaseReceiptInput,
  ) {
    return this.management.receivePurchaseOrder(
      request.auth.identityId,
      organizationId,
      unitId,
      purchaseOrderId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/receipts/:receiptId/reverse")
  reversePurchaseReceipt(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("receiptId", ParseUUIDPipe) receiptId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseReversalSchema)) body: PurchaseReversalInput,
  ) {
    return this.management.reversePurchaseReceipt(
      request.auth.identityId,
      organizationId,
      unitId,
      receiptId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/:purchaseOrderId/invoices")
  createSupplierInvoice(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("purchaseOrderId", ParseUUIDPipe) purchaseOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(supplierInvoiceSchema)) body: SupplierInvoiceInput,
  ) {
    return this.management.createSupplierInvoice(
      request.auth.identityId,
      organizationId,
      unitId,
      purchaseOrderId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/invoices/:invoiceId/reconcile")
  reconcileSupplierInvoice(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("invoiceId", ParseUUIDPipe) invoiceId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseReconciliationSchema)) body: PurchaseReconciliationInput,
  ) {
    return this.management.reconcileSupplierInvoice(
      request.auth.identityId,
      organizationId,
      unitId,
      invoiceId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/invoices/:invoiceId/confirm")
  confirmSupplierInvoice(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("invoiceId", ParseUUIDPipe) invoiceId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseInvoiceConfirmSchema)) body: PurchaseInvoiceConfirmInput,
  ) {
    return this.management.confirmSupplierInvoice(
      request.auth.identityId,
      organizationId,
      unitId,
      invoiceId,
      idempotencyKey,
      body,
    );
  }

  @Post("purchases/invoices/:invoiceId/cancel")
  cancelSupplierInvoice(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("invoiceId", ParseUUIDPipe) invoiceId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(purchaseReversalSchema)) body: PurchaseReversalInput,
  ) {
    return this.management.cancelSupplierInvoice(
      request.auth.identityId,
      organizationId,
      unitId,
      invoiceId,
      idempotencyKey,
      body,
    );
  }

  @Get("finance")
  finance(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(financeListQuerySchema)) query: FinanceListQuery,
  ) {
    return this.management.financeDashboard(request.auth.identityId, organizationId, unitId, query);
  }

  @Get("finance/settings")
  financeSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.financeSettings(request.auth.identityId, organizationId, unitId);
  }

  @Put("finance/settings")
  updateFinanceSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financeSettingsSchema)) body: FinanceSettingsInput,
  ) {
    return this.management.updateFinanceSettings(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("finance/export")
  exportFinance(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(financeExportQuerySchema)) query: FinanceExportQuery,
  ) {
    return this.management.exportFinance(request.auth.identityId, organizationId, unitId, query);
  }

  @Post("finance/approvals")
  requestFinanceApproval(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financeApprovalRequestSchema)) body: FinanceApprovalRequestInput,
  ) {
    return this.management.requestFinanceApproval(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("finance/approvals/:approvalRequestId/decision")
  decideFinanceApproval(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("approvalRequestId", ParseUUIDPipe) approvalRequestId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financeApprovalDecisionSchema)) body: FinanceApprovalDecisionInput,
  ) {
    return this.management.decideFinanceApproval(
      request.auth.identityId,
      organizationId,
      unitId,
      approvalRequestId,
      idempotencyKey,
      body,
    );
  }

  @Post("finance/payables")
  createPayable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(payableSchema)) body: PayableInput,
  ) {
    return this.management.createPayable(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Patch("finance/payables/:payableId")
  updatePayable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("payableId", ParseUUIDPipe) payableId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financeEntryUpdateSchema)) body: FinanceEntryUpdateInput,
  ) {
    return this.management.updatePayable(
      request.auth.identityId,
      organizationId,
      unitId,
      payableId,
      idempotencyKey,
      body,
    );
  }

  @Post("finance/payables/:payableId/cancel")
  cancelPayable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("payableId", ParseUUIDPipe) payableId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financeEntryCancelSchema)) body: FinanceEntryCancelInput,
  ) {
    return this.management.cancelPayable(
      request.auth.identityId,
      organizationId,
      unitId,
      payableId,
      idempotencyKey,
      body,
    );
  }

  @Post("finance/payables/:payableId/payments")
  payPayable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("payableId", ParseUUIDPipe) payableId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financialPaymentSchema)) body: FinancialPaymentInput,
  ) {
    return this.management.payPayable(
      request.auth.identityId,
      organizationId,
      unitId,
      payableId,
      idempotencyKey,
      body,
    );
  }

  @Post("finance/payables/payments/:paymentId/reverse")
  reversePayablePayment(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financePaymentReversalSchema)) body: FinancePaymentReversalInput,
  ) {
    return this.management.reversePayablePayment(
      request.auth.identityId,
      organizationId,
      unitId,
      paymentId,
      idempotencyKey,
      body,
    );
  }

  @Post("finance/receivables")
  createReceivable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(receivableSchema)) body: ReceivableInput,
  ) {
    return this.management.createReceivable(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Patch("finance/receivables/:receivableId")
  updateReceivable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("receivableId", ParseUUIDPipe) receivableId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financeEntryUpdateSchema)) body: FinanceEntryUpdateInput,
  ) {
    return this.management.updateReceivable(
      request.auth.identityId,
      organizationId,
      unitId,
      receivableId,
      idempotencyKey,
      body,
    );
  }

  @Post("finance/receivables/:receivableId/cancel")
  cancelReceivable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("receivableId", ParseUUIDPipe) receivableId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financeEntryCancelSchema)) body: FinanceEntryCancelInput,
  ) {
    return this.management.cancelReceivable(
      request.auth.identityId,
      organizationId,
      unitId,
      receivableId,
      idempotencyKey,
      body,
    );
  }

  @Post("finance/receivables/:receivableId/payments")
  receiveReceivable(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("receivableId", ParseUUIDPipe) receivableId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(receivablePaymentSchema)) body: ReceivablePaymentInput,
  ) {
    return this.management.receiveReceivable(
      request.auth.identityId,
      organizationId,
      unitId,
      receivableId,
      idempotencyKey,
      body,
    );
  }

  @Post("finance/receivables/payments/:paymentId/reverse")
  reverseReceivablePayment(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financePaymentReversalSchema)) body: FinancePaymentReversalInput,
  ) {
    return this.management.reverseReceivablePayment(
      request.auth.identityId,
      organizationId,
      unitId,
      paymentId,
      idempotencyKey,
      body,
    );
  }

  @Get("cash-shifts")
  cashShifts(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.listCashShifts(request.auth.identityId, organizationId, unitId);
  }

  @Get("cash-settings")
  cashSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.getCashSettings(request.auth.identityId, organizationId, unitId);
  }

  @Put("cash-settings")
  updateCashSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cashSettingsSchema)) body: CashSettingsInput,
  ) {
    return this.management.updateCashSettings(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("cash-shifts/history")
  cashShiftHistory(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(cashShiftHistoryQuerySchema)) query: CashShiftHistoryQuery,
  ) {
    return this.management.cashShiftHistory(request.auth.identityId, organizationId, unitId, query);
  }

  @Get("cash-shifts/export")
  exportCashShifts(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(cashShiftExportQuerySchema)) query: CashShiftExportQuery,
  ) {
    return this.management.exportCashShifts(request.auth.identityId, organizationId, unitId, query);
  }

  @Get("cash-shifts/:cashShiftId/detail")
  cashShiftDetail(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("cashShiftId", ParseUUIDPipe) cashShiftId: string,
  ) {
    return this.management.cashShiftDetail(
      request.auth.identityId,
      organizationId,
      unitId,
      cashShiftId,
    );
  }

  @Patch("cash-terminals/:installationId")
  updateCashTerminal(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("installationId", ParseUUIDPipe) installationId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cashTerminalUpdateSchema)) body: CashTerminalUpdateInput,
  ) {
    return this.management.updateCashTerminal(
      request.auth.identityId,
      organizationId,
      unitId,
      installationId,
      idempotencyKey,
      body,
    );
  }

  @Post("cash-approvals/:approvalId/decision")
  decideCashApproval(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("approvalId", ParseUUIDPipe) approvalId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cashApprovalDecisionSchema)) body: CashApprovalDecisionInput,
  ) {
    return this.management.decideCashApproval(
      request.auth.identityId,
      organizationId,
      unitId,
      approvalId,
      idempotencyKey,
      body,
    );
  }

  @Get("cash-approvals")
  cashApprovals(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.listCashApprovals(request.auth.identityId, organizationId, unitId);
  }

  @Post("cash-registers")
  createCashRegister(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cashRegisterCreateSchema)) body: CashRegisterCreateInput,
  ) {
    return this.management.createCashRegister(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Patch("cash-registers/:cashRegisterId")
  updateCashRegister(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("cashRegisterId", ParseUUIDPipe) cashRegisterId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cashRegisterUpdateSchema)) body: CashRegisterUpdateInput,
  ) {
    return this.management.updateCashRegister(
      request.auth.identityId,
      organizationId,
      unitId,
      cashRegisterId,
      idempotencyKey,
      body,
    );
  }

  @Post("cash-transfers")
  transferCash(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cashTransferSchema)) body: CashTransferInput,
  ) {
    return this.management.transferCash(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("cash-transfers/:cashTransferId/decision")
  decideCashTransfer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("cashTransferId", ParseUUIDPipe) cashTransferId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cashTransferDecisionSchema)) body: CashTransferDecisionInput,
  ) {
    return this.management.decideCashTransfer(
      request.auth.identityId,
      organizationId,
      unitId,
      cashTransferId,
      idempotencyKey,
      body,
    );
  }

  @Post("cash-shifts")
  openCashShift(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(openCashShiftSchema)) body: OpenCashShiftInput,
  ) {
    return this.management.openCashShift(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("cash-shifts/:cashShiftId/movements")
  cashMovement(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("cashShiftId", ParseUUIDPipe) cashShiftId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cashMovementSchema)) body: CashMovementInput,
  ) {
    return this.management.addCashMovement(
      request.auth.identityId,
      organizationId,
      unitId,
      cashShiftId,
      idempotencyKey,
      body,
    );
  }

  @Post("cash-shifts/:cashShiftId/handover")
  handoverCashShift(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("cashShiftId", ParseUUIDPipe) cashShiftId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cashShiftHandoverSchema)) body: CashShiftHandoverInput,
  ) {
    return this.management.handoverCashShift(
      request.auth.identityId,
      organizationId,
      unitId,
      cashShiftId,
      idempotencyKey,
      body,
    );
  }

  @Post("cash-shifts/:cashShiftId/close")
  closeCashShift(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("cashShiftId", ParseUUIDPipe) cashShiftId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(closeCashShiftSchema)) body: CloseCashShiftInput,
  ) {
    return this.management.closeCashShift(
      request.auth.identityId,
      organizationId,
      unitId,
      cashShiftId,
      idempotencyKey,
      body,
    );
  }

  @Post("cash-shifts/:cashShiftId/review")
  reviewCashShift(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("cashShiftId", ParseUUIDPipe) cashShiftId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(cashShiftReviewSchema)) body: CashShiftReviewInput,
  ) {
    return this.management.reviewCashShift(
      request.auth.identityId,
      organizationId,
      unitId,
      cashShiftId,
      idempotencyKey,
      body,
    );
  }

  @Post("reconciliations")
  reconciliation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reconciliationSchema)) body: ReconciliationInput,
  ) {
    return this.management.importReconciliation(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("reconciliations/:reconciliationEntryId/resolve")
  resolveFinanceReconciliation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("reconciliationEntryId", ParseUUIDPipe) reconciliationEntryId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(financeReconciliationResolutionSchema))
    body: FinanceReconciliationResolutionInput,
  ) {
    return this.management.resolveFinanceReconciliation(
      request.auth.identityId,
      organizationId,
      unitId,
      reconciliationEntryId,
      idempotencyKey,
      body,
    );
  }

  @Get("reports")
  reports(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(reportQuerySchema)) query: ReportQueryInput,
  ) {
    return this.reportsService.reports(request.auth.identityId, organizationId, unitId, query);
  }

  @Get("reports/drill-down")
  reportDrillDown(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(reportDrillDownQuerySchema)) query: ReportDrillDownQuery,
  ) {
    return this.reportsService.drillDown(request.auth.identityId, organizationId, unitId, query);
  }

  @Get("reports/budgets")
  reportBudgets(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.reportsService.budgets(request.auth.identityId, organizationId, unitId);
  }

  @Put("reports/budgets/:month")
  putReportBudget(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("month", new ZodPipe(reportBudgetMonthSchema)) month: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reportBudgetInputSchema)) body: ReportBudgetInput,
  ) {
    return this.reportsService.putBudget(
      request.auth.identityId,
      organizationId,
      unitId,
      month,
      idempotencyKey,
      body,
    );
  }

  @Get("reports/budgets/:month")
  reportBudgetMonth(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("month", new ZodPipe(reportBudgetMonthSchema)) month: string,
  ) {
    return this.reportsService.budgetMonth(request.auth.identityId, organizationId, unitId, month);
  }

  @Post("reports/exports")
  createReportExport(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reportExportInputSchema)) body: ReportExportInput,
  ) {
    return this.reportsService.createExport(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("reports/exports")
  reportExports(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(reportExportListQuerySchema)) query: ReportExportListQuery,
  ) {
    return this.reportsService.exports(request.auth.identityId, organizationId, unitId, query);
  }

  @Get("reports/exports/:exportId/content")
  reportExportContent(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("exportId", ParseUUIDPipe) exportId: string,
  ) {
    return this.reportsService.exportContent(
      request.auth.identityId,
      organizationId,
      unitId,
      exportId,
    );
  }

  @Get("reports/views")
  reportViews(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.reportsService.views(request.auth.identityId, organizationId, unitId);
  }

  @Post("reports/views")
  createReportView(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reportViewCreateSchema)) body: ReportViewCreateInput,
  ) {
    return this.reportsService.createView(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Patch("reports/views/:viewId")
  updateReportView(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("viewId", ParseUUIDPipe) viewId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reportViewUpdateSchema)) body: ReportViewUpdateInput,
  ) {
    return this.reportsService.updateView(
      request.auth.identityId,
      organizationId,
      unitId,
      viewId,
      idempotencyKey,
      body,
    );
  }

  @Delete("reports/views/:viewId")
  deleteReportView(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("viewId", ParseUUIDPipe) viewId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Query(new ZodPipe(reportViewDeleteSchema)) query: ReportViewDeleteInput,
  ) {
    return this.reportsService.deleteView(
      request.auth.identityId,
      organizationId,
      unitId,
      viewId,
      query.version,
      idempotencyKey,
    );
  }

  @Get("reports/alerts")
  reportAlerts(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(reportAlertListQuerySchema)) query: ReportAlertListQuery,
  ) {
    return this.reportsService.alerts(request.auth.identityId, organizationId, unitId, query);
  }

  @Post("reports/alerts/evaluate")
  evaluateReportAlerts(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reportAlertEvaluateSchema)) body: ReportAlertEvaluateInput,
  ) {
    return this.reportsService.evaluateAlerts(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Patch("reports/alerts/:alertId")
  updateReportAlert(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("alertId", ParseUUIDPipe) alertId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reportAlertActionSchema)) body: ReportAlertActionInput,
  ) {
    return this.reportsService.updateAlert(
      request.auth.identityId,
      organizationId,
      unitId,
      alertId,
      idempotencyKey,
      body,
    );
  }

  @Post("reports/costs/backfill")
  backfillReportCosts(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reportCostBackfillSchema)) body: ReportCostBackfillInput,
  ) {
    return this.reportsService.backfillCosts(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("reports/costs/backfill/preview")
  previewReportCosts(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(reportCostPreviewSchema)) body: ReportCostPreviewInput,
  ) {
    return this.reportsService.previewCosts(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("reports/reconciliation/closure")
  closeReportReconciliation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reportReconciliationClosureSchema))
    body: ReportReconciliationClosureInput,
  ) {
    return this.reportsService.closeReconciliation(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("reports/schedules")
  reportSchedules(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.reportsService.schedules(request.auth.identityId, organizationId, unitId);
  }

  @Post("reports/schedules")
  createReportSchedule(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reportScheduleCreateSchema)) body: ReportScheduleCreateInput,
  ) {
    return this.reportsService.createSchedule(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Patch("reports/schedules/:scheduleId")
  updateReportSchedule(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("scheduleId", ParseUUIDPipe) scheduleId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(reportScheduleUpdateSchema)) body: ReportScheduleUpdateInput,
  ) {
    return this.reportsService.updateSchedule(
      request.auth.identityId,
      organizationId,
      unitId,
      scheduleId,
      idempotencyKey,
      body,
    );
  }

  @Delete("reports/schedules/:scheduleId")
  deleteReportSchedule(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("scheduleId", ParseUUIDPipe) scheduleId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Query(new ZodPipe(reportScheduleDeleteSchema)) query: ReportScheduleDeleteInput,
  ) {
    return this.reportsService.deleteSchedule(
      request.auth.identityId,
      organizationId,
      unitId,
      scheduleId,
      query.version,
      idempotencyKey,
    );
  }

  @Get("people")
  people(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.peopleDashboard(request.auth.identityId, organizationId, unitId);
  }

  @Get("people/directory")
  peopleDirectory(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(peopleListQuerySchema)) query: PeopleListQuery,
  ) {
    return this.management.peopleDirectory(request.auth.identityId, organizationId, unitId, query);
  }

  @Get("people/capabilities")
  peopleCapabilities(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.peopleCapabilities(request.auth.identityId, organizationId, unitId);
  }

  @Get("people/self")
  selfTimeTracking(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.selfTimeTracking(request.auth.identityId, organizationId, unitId);
  }

  @Get("people/time-tracking/settings")
  timeTrackingSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.getTimeTrackingSettings(request.auth.identityId, organizationId, unitId);
  }

  @Put("people/time-tracking/settings")
  updateTimeTrackingSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(timeTrackingSettingsSchema)) body: TimeTrackingSettingsInput,
  ) {
    return this.management.updateTimeTrackingSettings(
      request.auth.identityId,
      organizationId,
      unitId,
      body,
    );
  }

  @Get("people/time-tracking/settings/history")
  timeTrackingSettingsHistory(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.timeTrackingSettingsHistory(
      request.auth.identityId,
      organizationId,
      unitId,
    );
  }

  @Get("people/time-tracking/location-anomalies")
  timeTrackingLocationAnomalies(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(reportPeriodSchema)) query: ReportPeriodInput,
  ) {
    return this.management.timeTrackingLocationAnomalies(
      request.auth.identityId,
      organizationId,
      unitId,
      query,
    );
  }

  @Post("people/time-tracking/closures")
  closeTimeTrackingPeriod(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(timeTrackingClosureSchema)) body: TimeTrackingClosureInput,
  ) {
    return this.management.closeTimeTrackingPeriod(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("people/time-tracking/closures/:closureId/reopen")
  reopenTimeTrackingPeriod(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("closureId", ParseUUIDPipe) closureId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(personStatusSchema)) body: PersonStatusInput,
  ) {
    return this.management.reopenTimeTrackingPeriod(
      request.auth.identityId,
      organizationId,
      unitId,
      closureId,
      idempotencyKey,
      body,
    );
  }

  @Get("people/time-tracking/report")
  timeTrackingReport(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(reportPeriodSchema)) query: ReportPeriodInput,
  ) {
    return this.management.timeTrackingReport(
      request.auth.identityId,
      organizationId,
      unitId,
      query,
    );
  }

  @Post("people/self/clock-in")
  selfClockIn(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(selfClockInSchema)) body: SelfClockInInput,
  ) {
    return this.management.selfClockIn(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
      punchContext(request),
    );
  }

  @Post("people/self/time-corrections")
  requestTimeCorrection(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(timeCorrectionSchema)) body: TimeCorrectionInput,
  ) {
    return this.management.requestTimeCorrection(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("people/self/breaks")
  selfStartBreak(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(selfBreakSchema)) body: SelfBreakInput,
  ) {
    return this.management.selfStartBreak(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
      punchContext(request),
    );
  }

  @Post("people/self/breaks/:breakId/complete")
  selfCompleteBreak(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("breakId", ParseUUIDPipe) breakId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(selfClockOutSchema)) body: SelfClockOutInput,
  ) {
    return this.management.selfCompleteBreak(
      request.auth.identityId,
      organizationId,
      unitId,
      breakId,
      idempotencyKey,
      body,
      punchContext(request),
    );
  }

  @Post("people/self/clock-out")
  selfClockOut(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(selfClockOutSchema)) body: SelfClockOutInput,
  ) {
    return this.management.selfClockOut(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
      punchContext(request),
    );
  }

  @Post("people/time-corrections/:correctionId/decision")
  decideTimeCorrection(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("correctionId", ParseUUIDPipe) correctionId: string,
    @Body(new ZodPipe(timeCorrectionDecisionSchema)) body: TimeCorrectionDecisionInput,
  ) {
    return this.management.decideTimeCorrection(
      request.auth.identityId,
      organizationId,
      unitId,
      correctionId,
      body,
    );
  }

  @Post("people")
  createPerson(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(personSchema)) body: PersonInput,
  ) {
    return this.management.createPerson(request.auth.identityId, organizationId, unitId, body);
  }

  @Get("people/access-center")
  peopleAccessCenter(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.peopleAccessCenter(request.auth.identityId, organizationId, unitId);
  }

  @Post("people/terminals/:terminalSessionId/revoke")
  revokeManagedTerminal(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("terminalSessionId", ParseUUIDPipe) terminalSessionId: string,
    @Body(new ZodPipe(personStatusSchema)) body: PersonStatusInput,
  ) {
    return this.management.revokeManagedTerminal(
      request.auth.identityId,
      organizationId,
      unitId,
      terminalSessionId,
      body.reason,
    );
  }

  @Get("people/:personId/access-overview")
  personAccessOverview(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
  ) {
    return this.management.personAccessOverview(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
    );
  }

  @Get("people/:personId/offboarding-preflight")
  personOffboardingPreflight(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
  ) {
    return this.management.personOffboardingPreflight(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
    );
  }

  @Post("people/:personId/access/units")
  assignPersonUnitAccess(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Body(new ZodPipe(personUnitAccessSchema)) body: PersonUnitAccessInput,
  ) {
    return this.management.assignPersonUnitAccess(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      body,
    );
  }

  @Delete("people/:personId/access/units/:targetUnitId")
  removePersonUnitAccess(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Param("targetUnitId", ParseUUIDPipe) targetUnitId: string,
    @Body(new ZodPipe(personUnitAccessRemovalSchema)) body: PersonUnitAccessRemovalInput,
  ) {
    return this.management.removePersonUnitAccess(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      targetUnitId,
      body,
    );
  }

  @Post("people/:personId/access/invite")
  invitePersonAccess(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Body(new ZodPipe(personAccessInviteSchema)) body: PersonAccessInviteInput,
  ) {
    return this.management.invitePersonAccess(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      body,
    );
  }

  @Post("people/:personId/access/resend")
  resendPersonAccess(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
  ) {
    return this.management.resendPersonAccess(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
    );
  }

  @Post("people/:personId/access/cancel")
  cancelPersonAccess(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Body(new ZodPipe(personStatusSchema)) body: PersonStatusInput,
  ) {
    return this.management.cancelPersonAccess(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      body,
    );
  }

  @Patch("people/:personId/access")
  updatePersonAccess(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Body(new ZodPipe(personAccessRoleUpdateSchema)) body: PersonAccessRoleUpdateInput,
  ) {
    return this.management.updatePersonAccess(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      body,
    );
  }

  @Post("people/:personId/access/suspend")
  suspendPersonAccess(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Body(new ZodPipe(personStatusSchema)) body: PersonStatusInput,
  ) {
    return this.management.suspendPersonAccess(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      body,
    );
  }

  @Post("people/:personId/access/reactivate")
  reactivatePersonAccess(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Body(new ZodPipe(personAccessReactivateSchema)) body: PersonAccessReactivateInput,
  ) {
    return this.management.reactivatePersonAccess(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      body,
    );
  }

  @Patch("people/:personId")
  updatePerson(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Body(new ZodPipe(personUpdateSchema)) body: PersonUpdateInput,
  ) {
    return this.management.updatePerson(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      body,
    );
  }

  @Post("people/:personId/inactivate")
  inactivatePerson(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Body(new ZodPipe(personStatusSchema)) body: PersonStatusInput,
  ) {
    return this.management.changePersonStatus(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      false,
      body,
    );
  }

  @Post("people/:personId/reactivate")
  reactivatePerson(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Body(new ZodPipe(personStatusSchema)) body: PersonStatusInput,
  ) {
    return this.management.changePersonStatus(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      true,
      body,
    );
  }

  @Get("people/:personId/timeline")
  personTimeline(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("personId", ParseUUIDPipe) personId: string,
    @Query(new ZodPipe(reportPeriodSchema)) query: ReportPeriodInput,
  ) {
    return this.management.personTimeline(
      request.auth.identityId,
      organizationId,
      unitId,
      personId,
      query,
    );
  }

  @Get("people/indicators/operational")
  peopleIndicators(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(reportPeriodSchema)) query: ReportPeriodInput,
  ) {
    return this.management.peopleIndicators(request.auth.identityId, organizationId, unitId, query);
  }

  @Post("people/export")
  exportPeople(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(peopleExportSchema)) body: PeopleExportInput,
  ) {
    return this.management.exportPeople(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("people/time-tracking/assignments/batch")
  assignPeopleTimeTracking(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(peopleAssignmentBatchSchema)) body: PeopleAssignmentBatchInput,
  ) {
    return this.management.assignPeopleTimeTracking(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("people/schedules")
  createSchedule(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(scheduleSchema)) body: ScheduleInput,
  ) {
    return this.management.createSchedule(request.auth.identityId, organizationId, unitId, body);
  }

  @Patch("people/schedules/:scheduleId")
  updatePeopleSchedule(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("scheduleId", ParseUUIDPipe) scheduleId: string,
    @Body(new ZodPipe(scheduleUpdateSchema)) body: ScheduleUpdateInput,
  ) {
    return this.management.updateSchedule(
      request.auth.identityId,
      organizationId,
      unitId,
      scheduleId,
      body,
    );
  }

  @Post("people/schedules/:scheduleId/cancel")
  cancelPeopleSchedule(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("scheduleId", ParseUUIDPipe) scheduleId: string,
    @Body(new ZodPipe(scheduleCancelSchema)) body: ScheduleCancelInput,
  ) {
    return this.management.cancelSchedule(
      request.auth.identityId,
      organizationId,
      unitId,
      scheduleId,
      body,
    );
  }

  @Post("people/schedules/batch/preview")
  previewPeopleSchedules(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(scheduleBatchSchema)) body: ScheduleBatchInput,
  ) {
    return this.management.previewScheduleBatch(
      request.auth.identityId,
      organizationId,
      unitId,
      body,
    );
  }

  @Post("people/schedules/batch")
  createPeopleSchedulesBatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(scheduleBatchSchema)) body: ScheduleBatchInput,
  ) {
    return this.management.createScheduleBatch(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("people/time-entries")
  createTimeEntry(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(timeEntrySchema)) body: TimeEntryInput,
  ) {
    return this.management.createTimeEntry(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("people/time-entries/:timeEntryId/clock-out")
  clockOut(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("timeEntryId", ParseUUIDPipe) timeEntryId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(clockOutSchema)) body: ClockOutInput,
  ) {
    return this.management.clockOut(
      request.auth.identityId,
      organizationId,
      unitId,
      timeEntryId,
      idempotencyKey,
      body,
    );
  }

  @Post("people/commission-rules")
  createCommissionRule(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(commissionRuleSchema)) body: CommissionRuleInput,
  ) {
    return this.management.createCommissionRule(
      request.auth.identityId,
      organizationId,
      unitId,
      body,
    );
  }

  @Post("people/commissions")
  createCommission(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(commissionSchema)) body: CommissionInput,
  ) {
    return this.management.createCommission(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("people/commissions/:commissionId/transition")
  transitionCommission(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("commissionId", ParseUUIDPipe) commissionId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(commissionTransitionSchema)) body: CommissionTransitionInput,
  ) {
    return this.management.transitionCommission(
      request.auth.identityId,
      organizationId,
      unitId,
      commissionId,
      idempotencyKey,
      body,
    );
  }
}
