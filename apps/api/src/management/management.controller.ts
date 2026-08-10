import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type CashMovementInput,
  type ClockOutInput,
  type CloseCashShiftInput,
  type CommissionInput,
  type CommissionRuleInput,
  cashMovementSchema,
  clockOutSchema,
  closeCashShiftSchema,
  commissionRuleSchema,
  commissionSchema,
  type FinancialPaymentInput,
  financialPaymentSchema,
  type InventoryEventInput,
  type InventoryItemInput,
  inventoryEventSchema,
  inventoryItemSchema,
  type OpenCashShiftInput,
  openCashShiftSchema,
  type PayableInput,
  type PersonInput,
  type PurchaseOrderInput,
  type PurchaseReceiptInput,
  payableSchema,
  personSchema,
  purchaseOrderSchema,
  purchaseReceiptSchema,
  type ReceivableInput,
  type ReceivablePaymentInput,
  type RecipeConfigurationInput,
  type ReconciliationInput,
  type ReportPeriodInput,
  receivablePaymentSchema,
  receivableSchema,
  recipeConfigurationSchema,
  reconciliationSchema,
  reportPeriodSchema,
  type ScheduleInput,
  type StockLocationInput,
  type SupplierInput,
  scheduleSchema,
  stockLocationSchema,
  supplierSchema,
  type TimeEntryInput,
  timeEntrySchema,
} from "./management.schemas.js";
import { ManagementService } from "./management.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/management",
  "v1/organizations/:organizationId/units/:unitId/management",
])
export class ManagementController {
  constructor(private readonly management: ManagementService) {}

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
    @Body(new ZodPipe(stockLocationSchema)) body: StockLocationInput,
  ) {
    return this.management.createStockLocation(
      request.auth.identityId,
      organizationId,
      unitId,
      body,
    );
  }

  @Post("inventory/items")
  createItem(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(inventoryItemSchema)) body: InventoryItemInput,
  ) {
    return this.management.createInventoryItem(
      request.auth.identityId,
      organizationId,
      unitId,
      body,
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
  ) {
    return this.management.listSuppliers(request.auth.identityId, organizationId, unitId);
  }

  @Post("suppliers")
  createSupplier(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(supplierSchema)) body: SupplierInput,
  ) {
    return this.management.createSupplier(request.auth.identityId, organizationId, unitId, body);
  }

  @Get("purchases")
  purchases(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.listPurchases(request.auth.identityId, organizationId, unitId);
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

  @Post("purchases/:purchaseOrderId/approve")
  approvePurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("purchaseOrderId", ParseUUIDPipe) purchaseOrderId: string,
    @Headers("idempotency-key") idempotencyKey: string,
  ) {
    return this.management.approvePurchaseOrder(
      request.auth.identityId,
      organizationId,
      unitId,
      purchaseOrderId,
      idempotencyKey,
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

  @Get("finance")
  finance(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.financeDashboard(request.auth.identityId, organizationId, unitId);
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

  @Get("cash-shifts")
  cashShifts(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.listCashShifts(request.auth.identityId, organizationId, unitId);
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

  @Get("reports")
  reports(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(reportPeriodSchema)) query: ReportPeriodInput,
  ) {
    return this.management.reports(request.auth.identityId, organizationId, unitId, query);
  }

  @Get("people")
  people(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.management.peopleDashboard(request.auth.identityId, organizationId, unitId);
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

  @Post("people/schedules")
  createSchedule(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(scheduleSchema)) body: ScheduleInput,
  ) {
    return this.management.createSchedule(request.auth.identityId, organizationId, unitId, body);
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
}
