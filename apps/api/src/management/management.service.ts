import { randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  managementAccountsPayable,
  managementAccountsReceivable,
  managementCashMovements,
  managementCashShifts,
  managementCommissionRules,
  managementCommissions,
  managementIdempotency,
  managementInventoryEventLines,
  managementInventoryEvents,
  managementInventoryItems,
  managementInventoryMovements,
  managementPayablePayments,
  managementPeople,
  managementPurchaseOrderItems,
  managementPurchaseOrders,
  managementPurchaseReceiptLines,
  managementPurchaseReceipts,
  managementReceivableLines,
  managementReceivablePayments,
  managementRecipeComponents,
  managementRecipeVersions,
  managementReconciliationEntries,
  managementReconciliationImports,
  managementSchedules,
  managementStockBalances,
  managementStockLocations,
  managementSuppliers,
  managementTimeEntries,
  memberships,
  outboxEvents,
  posOrders,
  posProducts,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import {
  cashConference,
  inventoryChange,
  managementReplay,
  managementRequestHash,
  milliToQuantity,
  profitabilityCoverage,
  purchaseReceiptPlan,
  quantityToMilli,
  settlement,
} from "./management.rules.js";
import type {
  CashMovementInput,
  ClockOutInput,
  CloseCashShiftInput,
  CommissionInput,
  CommissionRuleInput,
  FinancialPaymentInput,
  InventoryEventInput,
  InventoryItemInput,
  OpenCashShiftInput,
  PayableInput,
  PersonInput,
  PurchaseOrderInput,
  PurchaseReceiptInput,
  ReceivableInput,
  ReceivablePaymentInput,
  RecipeConfigurationInput,
  ReconciliationInput,
  ReportPeriodInput,
  ScheduleInput,
  StockLocationInput,
  SupplierInput,
  TimeEntryInput,
} from "./management.schemas.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type JsonResponse = Record<string, unknown>;
type ManagementRole = "owner" | "manager" | "inventory" | "finance" | "cashier";

const INVENTORY_ROLES = ["owner", "manager", "inventory"] as const;
const FINANCE_ROLES = ["owner", "manager", "finance"] as const;
const CASH_ROLES = ["owner", "manager", "finance", "cashier"] as const;
const PEOPLE_ROLES = ["owner", "manager"] as const;

@Injectable()
export class ManagementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async requireRole(
    identityId: string,
    organizationId: string,
    unitId: string,
    allowed: readonly ManagementRole[],
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const rows = await this.scope.requireOrganizationRole(identityId, organizationId, allowed);
    if (
      !rows.some(
        (row) =>
          allowed.includes(row.role as ManagementRole) &&
          (row.unitId === null || row.unitId === unitId),
      )
    ) {
      throw new ForbiddenException({
        code: "MANAGEMENT_ROLE_DENIED",
        message: "Ação não autorizada nesta unidade.",
      });
    }
  }

  private async idempotent<T extends JsonResponse>(
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    key: string,
    operation: string,
    payload: unknown,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T & { idempotentReplay: boolean }> {
    const normalizedKey = key.trim();
    if (normalizedKey.length < 8 || normalizedKey.length > 160) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Envie Idempotency-Key com 8 a 160 caracteres.",
      });
    }
    const payloadHash = managementRequestHash(operation, payload);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`management:${organizationId}:${unitId}:${operation}:${normalizedKey}`}))`,
      );
      const [existing] = await tx
        .select({
          payloadHash: managementIdempotency.payloadHash,
          response: managementIdempotency.response,
        })
        .from(managementIdempotency)
        .where(
          and(
            eq(managementIdempotency.organizationId, organizationId),
            eq(managementIdempotency.unitId, unitId),
            eq(managementIdempotency.operation, operation),
            eq(managementIdempotency.idempotencyKey, normalizedKey),
          ),
        )
        .limit(1);
      if (existing) {
        const replay = managementReplay<T>(existing, payloadHash);
        if (replay) return replay;
      }
      const response = await work(tx);
      const stored = JSON.parse(JSON.stringify(response)) as T;
      await tx.insert(managementIdempotency).values({
        organizationId,
        unitId,
        actorIdentityId,
        operation,
        idempotencyKey: normalizedKey,
        payloadHash,
        response: stored,
      });
      return { ...stored, idempotentReplay: false };
    });
  }

  private async record(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    await tx
      .insert(auditEvents)
      .values({ organizationId, unitId, actorIdentityId, action, entityType, entityId, metadata });
    await tx.insert(outboxEvents).values({
      organizationId,
      unitId,
      topic: action,
      aggregateType: entityType,
      aggregateId: entityId,
      payload: { organizationId, unitId, actorIdentityId, ...metadata },
    });
  }

  private async requireProduct(tx: Transaction, organizationId: string, productId: string) {
    const [product] = await tx
      .select({ id: posProducts.id })
      .from(posProducts)
      .where(
        and(
          eq(posProducts.organizationId, organizationId),
          eq(posProducts.id, productId),
          eq(posProducts.active, true),
        ),
      )
      .limit(1);
    if (!product)
      throw new NotFoundException({
        code: "PRODUCT_NOT_FOUND",
        message: "Produto não encontrado nesta organização.",
      });
  }

  private async requireOrder(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    orderId: string,
  ) {
    const [order] = await tx
      .select({ id: posOrders.id })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      )
      .limit(1);
    if (!order)
      throw new NotFoundException({
        code: "ORDER_NOT_FOUND",
        message: "Pedido não encontrado nesta unidade.",
      });
  }

  async inventoryDashboard(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const scope = and(
      eq(managementStockLocations.organizationId, organizationId),
      eq(managementStockLocations.unitId, unitId),
    );
    const [locations, items, balances, movements] = await Promise.all([
      this.database.db
        .select()
        .from(managementStockLocations)
        .where(scope)
        .orderBy(managementStockLocations.name),
      this.database.db
        .select()
        .from(managementInventoryItems)
        .where(
          and(
            eq(managementInventoryItems.organizationId, organizationId),
            eq(managementInventoryItems.unitId, unitId),
          ),
        )
        .orderBy(managementInventoryItems.name),
      this.database.db
        .select()
        .from(managementStockBalances)
        .where(
          and(
            eq(managementStockBalances.organizationId, organizationId),
            eq(managementStockBalances.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementInventoryMovements)
        .where(
          and(
            eq(managementInventoryMovements.organizationId, organizationId),
            eq(managementInventoryMovements.unitId, unitId),
          ),
        )
        .orderBy(desc(managementInventoryMovements.occurredAt))
        .limit(200),
    ]);
    return { locations, items, balances, recentMovements: movements };
  }

  async createStockLocation(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: StockLocationInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.database.db.transaction(async (tx) => {
      const id = randomUUID();
      const [location] = await tx
        .insert(managementStockLocations)
        .values({ id, organizationId, unitId, ...input, code: input.code.toUpperCase() })
        .returning();
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.stock-location.created",
        "stock_location",
        id,
        { code: location?.code },
      );
      return location;
    });
  }

  async createInventoryItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: InventoryItemInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    return this.database.db.transaction(async (tx) => {
      if (input.productId) await this.requireProduct(tx, organizationId, input.productId);
      const id = randomUUID();
      const [item] = await tx
        .insert(managementInventoryItems)
        .values({
          id,
          organizationId,
          unitId,
          ...input,
          minimumQuantity: String(input.minimumQuantity),
        })
        .returning();
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.inventory-item.created",
        "inventory_item",
        id,
        { productId: input.productId ?? null },
      );
      return item;
    });
  }

  async listRecipeConfigurations(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const versions = await this.database.db
      .select()
      .from(managementRecipeVersions)
      .where(
        and(
          eq(managementRecipeVersions.organizationId, organizationId),
          eq(managementRecipeVersions.unitId, unitId),
          isNull(managementRecipeVersions.validUntil),
        ),
      )
      .orderBy(managementRecipeVersions.productId);
    if (versions.length === 0) return [];
    const components = await this.database.db
      .select()
      .from(managementRecipeComponents)
      .where(
        and(
          eq(managementRecipeComponents.organizationId, organizationId),
          eq(managementRecipeComponents.unitId, unitId),
          inArray(
            managementRecipeComponents.recipeVersionId,
            versions.map((version) => version.id),
          ),
        ),
      );
    return versions.map((version) => ({
      ...version,
      components: components.filter((component) => component.recipeVersionId === version.id),
    }));
  }

  async configureRecipe(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: RecipeConfigurationInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const componentKeys = input.components.map(
      (component) => `${component.inventoryItemId}:${component.locationId}`,
    );
    if (new Set(componentKeys).size !== componentKeys.length) {
      throw new BadRequestException({
        code: "RECIPE_COMPONENT_DUPLICATE",
        message: "Cada item e local deve aparecer uma única vez na ficha técnica.",
      });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "recipe.configure",
      input,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`management-recipe:${organizationId}:${unitId}:${input.productId}`}))`,
        );
        await this.requireProduct(tx, organizationId, input.productId);
        const itemIds = [
          ...new Set(input.components.map((component) => component.inventoryItemId)),
        ];
        const locationIds = [...new Set(input.components.map((component) => component.locationId))];
        const [items, locations] = await Promise.all([
          tx
            .select({ id: managementInventoryItems.id })
            .from(managementInventoryItems)
            .where(
              and(
                eq(managementInventoryItems.organizationId, organizationId),
                eq(managementInventoryItems.unitId, unitId),
                eq(managementInventoryItems.active, true),
                inArray(managementInventoryItems.id, itemIds),
              ),
            ),
          tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, unitId),
                eq(managementStockLocations.active, true),
                inArray(managementStockLocations.id, locationIds),
              ),
            ),
        ]);
        if (items.length !== itemIds.length || locations.length !== locationIds.length) {
          throw new NotFoundException({
            code: "RECIPE_INVENTORY_SCOPE_INVALID",
            message: "Item ou local de estoque não pertence a esta unidade.",
          });
        }
        const [latest] = await tx
          .select({
            version: managementRecipeVersions.version,
            validFrom: managementRecipeVersions.validFrom,
          })
          .from(managementRecipeVersions)
          .where(
            and(
              eq(managementRecipeVersions.organizationId, organizationId),
              eq(managementRecipeVersions.unitId, unitId),
              eq(managementRecipeVersions.productId, input.productId),
            ),
          )
          .orderBy(desc(managementRecipeVersions.version))
          .limit(1);
        const validFrom = new Date(Math.max(Date.now(), (latest?.validFrom.getTime() ?? 0) + 1));
        await tx
          .update(managementRecipeVersions)
          .set({ validUntil: validFrom })
          .where(
            and(
              eq(managementRecipeVersions.organizationId, organizationId),
              eq(managementRecipeVersions.unitId, unitId),
              eq(managementRecipeVersions.productId, input.productId),
              isNull(managementRecipeVersions.validUntil),
            ),
          );
        const recipeVersionId = randomUUID();
        const version = (latest?.version ?? 0) + 1;
        await tx.insert(managementRecipeVersions).values({
          id: recipeVersionId,
          organizationId,
          unitId,
          productId: input.productId,
          version,
          validFrom,
          createdByIdentityId: identityId,
        });
        await tx.insert(managementRecipeComponents).values(
          input.components.map((component) => ({
            id: randomUUID(),
            organizationId,
            unitId,
            recipeVersionId,
            ...component,
          })),
        );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.recipe.configured",
          "recipe_version",
          recipeVersionId,
          { productId: input.productId, version, componentCount: input.components.length },
        );
        return {
          recipeVersionId,
          productId: input.productId,
          version,
          validFrom: validFrom.toISOString(),
          components: input.components,
        };
      },
    );
  }

  async createSupplier(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: SupplierInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, [...INVENTORY_ROLES, "finance"]);
    return this.database.db.transaction(async (tx) => {
      const id = randomUUID();
      const [supplier] = await tx
        .insert(managementSuppliers)
        .values({ id, organizationId, unitId, ...input })
        .returning();
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.supplier.created",
        "supplier",
        id,
        {},
      );
      return supplier;
    });
  }

  async listSuppliers(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, [...INVENTORY_ROLES, "finance"]);
    return this.database.db
      .select()
      .from(managementSuppliers)
      .where(
        and(
          eq(managementSuppliers.organizationId, organizationId),
          eq(managementSuppliers.unitId, unitId),
        ),
      )
      .orderBy(managementSuppliers.name);
  }

  async recordInventoryEvent(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: InventoryEventInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const unique = new Set(input.lines.map((line) => `${line.locationId}:${line.inventoryItemId}`));
    if (unique.size !== input.lines.length)
      throw new BadRequestException({
        code: "DUPLICATE_INVENTORY_LINE",
        message: "O mesmo item e local não pode aparecer duas vezes.",
      });
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "inventory-event",
      input,
      async (tx) => {
        const eventId = randomUUID();
        await tx.insert(managementInventoryEvents).values({
          id: eventId,
          organizationId,
          unitId,
          type: input.type,
          reason: input.reason,
          idempotencyKey,
          actorIdentityId: identityId,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        });
        const results: Array<Record<string, unknown>> = [];
        for (const line of input.lines) {
          const [item] = await tx
            .select({
              id: managementInventoryItems.id,
              allowNegative: managementInventoryItems.allowNegative,
            })
            .from(managementInventoryItems)
            .where(
              and(
                eq(managementInventoryItems.organizationId, organizationId),
                eq(managementInventoryItems.unitId, unitId),
                eq(managementInventoryItems.id, line.inventoryItemId),
                eq(managementInventoryItems.active, true),
              ),
            )
            .limit(1);
          if (!item)
            throw new NotFoundException({
              code: "INVENTORY_ITEM_NOT_FOUND",
              message: "Item de estoque não encontrado nesta unidade.",
            });
          const [location] = await tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, unitId),
                eq(managementStockLocations.id, line.locationId),
                eq(managementStockLocations.active, true),
              ),
            )
            .limit(1);
          if (!location)
            throw new NotFoundException({
              code: "STOCK_LOCATION_NOT_FOUND",
              message: "Local de estoque não encontrado nesta unidade.",
            });
          await tx
            .insert(managementStockBalances)
            .values({
              organizationId,
              unitId,
              locationId: line.locationId,
              inventoryItemId: line.inventoryItemId,
            })
            .onConflictDoNothing({
              target: [
                managementStockBalances.organizationId,
                managementStockBalances.unitId,
                managementStockBalances.locationId,
                managementStockBalances.inventoryItemId,
              ],
            });
          await tx.execute(
            sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and location_id=${line.locationId}::uuid and inventory_item_id=${line.inventoryItemId}::uuid for update`,
          );
          const [balance] = await tx
            .select()
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                eq(managementStockBalances.locationId, line.locationId),
                eq(managementStockBalances.inventoryItemId, line.inventoryItemId),
              ),
            )
            .limit(1);
          if (!balance)
            throw new ConflictException({
              code: "BALANCE_LOCK_FAILED",
              message: "Não foi possível bloquear o saldo.",
            });
          const change = inventoryChange(
            balance.quantity,
            input.type,
            line.quantity,
            item.allowNegative,
          );
          const lineId = randomUUID();
          await tx.insert(managementInventoryEventLines).values({
            id: lineId,
            organizationId,
            unitId,
            eventId,
            locationId: line.locationId,
            inventoryItemId: line.inventoryItemId,
            ...change,
          });
          await tx.insert(managementInventoryMovements).values({
            organizationId,
            unitId,
            locationId: line.locationId,
            inventoryItemId: line.inventoryItemId,
            type: input.type,
            quantityDelta: change.quantityDelta,
            unitCostCents: balance.averageCostCents,
            sourceType: "inventory_event_line",
            sourceId: lineId,
            actorIdentityId: identityId,
            occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
          });
          await tx
            .update(managementStockBalances)
            .set({
              quantity: change.resultingQuantity,
              version: balance.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(managementStockBalances.id, balance.id));
          results.push({ lineId, ...change });
        }
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.inventory.event-recorded",
          "inventory_event",
          eventId,
          { type: input.type, lineCount: input.lines.length },
        );
        return { eventId, lines: results };
      },
    );
  }

  async createPurchaseOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: PurchaseOrderInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const unique = new Set(input.items.map((item) => item.inventoryItemId));
    if (unique.size !== input.items.length)
      throw new BadRequestException({
        code: "DUPLICATE_PURCHASE_ITEM",
        message: "Cada item deve aparecer uma vez.",
      });
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-order",
      input,
      async (tx) => {
        const [supplier] = await tx
          .select({ id: managementSuppliers.id })
          .from(managementSuppliers)
          .where(
            and(
              eq(managementSuppliers.organizationId, organizationId),
              eq(managementSuppliers.unitId, unitId),
              eq(managementSuppliers.id, input.supplierId),
              eq(managementSuppliers.active, true),
            ),
          )
          .limit(1);
        if (!supplier)
          throw new NotFoundException({
            code: "SUPPLIER_NOT_FOUND",
            message: "Fornecedor não encontrado nesta unidade.",
          });
        const ids = input.items.map((item) => item.inventoryItemId);
        const items = await tx
          .select({ id: managementInventoryItems.id })
          .from(managementInventoryItems)
          .where(
            and(
              eq(managementInventoryItems.organizationId, organizationId),
              eq(managementInventoryItems.unitId, unitId),
              inArray(managementInventoryItems.id, ids),
              eq(managementInventoryItems.active, true),
            ),
          );
        if (items.length !== ids.length)
          throw new NotFoundException({
            code: "INVENTORY_ITEM_NOT_FOUND",
            message: "Um ou mais itens não pertencem à unidade.",
          });
        const totalCents = input.items.reduce(
          (sum, item) =>
            sum + Math.round((quantityToMilli(item.quantity) * item.unitCostCents) / 1_000),
          0,
        );
        const purchaseOrderId = randomUUID();
        await tx.insert(managementPurchaseOrders).values({
          id: purchaseOrderId,
          organizationId,
          unitId,
          supplierId: input.supplierId,
          totalCents,
          idempotencyKey,
          expectedAt: input.expectedAt ? new Date(input.expectedAt) : undefined,
        });
        await tx.insert(managementPurchaseOrderItems).values(
          input.items.map((item) => ({
            organizationId,
            unitId,
            purchaseOrderId,
            inventoryItemId: item.inventoryItemId,
            quantity: String(item.quantity),
            unitCostCents: item.unitCostCents,
            totalCents: Math.round((quantityToMilli(item.quantity) * item.unitCostCents) / 1_000),
          })),
        );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-order.created",
          "purchase_order",
          purchaseOrderId,
          { supplierId: input.supplierId, totalCents },
        );
        return { purchaseOrderId, status: "draft", totalCents };
      },
    );
  }

  async approvePurchaseOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    purchaseOrderId: string,
    idempotencyKey: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-order-approve",
      { purchaseOrderId },
      async (tx) => {
        await tx.execute(
          sql`select id from management_purchase_orders where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${purchaseOrderId}::uuid for update`,
        );
        const [order] = await tx
          .select()
          .from(managementPurchaseOrders)
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, purchaseOrderId),
            ),
          )
          .limit(1);
        if (!order)
          throw new NotFoundException({
            code: "PURCHASE_ORDER_NOT_FOUND",
            message: "Pedido de compra não encontrado.",
          });
        if (order.status !== "draft")
          throw new ConflictException({
            code: "PURCHASE_ORDER_NOT_DRAFT",
            message: "Somente pedidos em rascunho podem ser aprovados.",
          });
        await tx
          .update(managementPurchaseOrders)
          .set({
            status: "approved",
            approvedAt: new Date(),
            approvedByIdentityId: identityId,
            version: order.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(managementPurchaseOrders.id, order.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-order.approved",
          "purchase_order",
          order.id,
          { totalCents: order.totalCents },
        );
        return { purchaseOrderId: order.id, status: "approved" };
      },
    );
  }

  async receivePurchaseOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    purchaseOrderId: string,
    idempotencyKey: string,
    input: PurchaseReceiptInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, INVENTORY_ROLES);
    const unique = new Set(input.lines.map((line) => line.purchaseOrderItemId));
    if (unique.size !== input.lines.length)
      throw new BadRequestException({
        code: "DUPLICATE_RECEIPT_LINE",
        message: "Cada item do pedido deve aparecer uma vez por recebimento.",
      });
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "purchase-receipt",
      { purchaseOrderId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_purchase_orders where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${purchaseOrderId}::uuid for update`,
        );
        const [order] = await tx
          .select()
          .from(managementPurchaseOrders)
          .where(
            and(
              eq(managementPurchaseOrders.organizationId, organizationId),
              eq(managementPurchaseOrders.unitId, unitId),
              eq(managementPurchaseOrders.id, purchaseOrderId),
            ),
          )
          .limit(1);
        if (!order)
          throw new NotFoundException({
            code: "PURCHASE_ORDER_NOT_FOUND",
            message: "Pedido de compra não encontrado.",
          });
        if (order.status !== "approved" && order.status !== "partially_received")
          throw new ConflictException({
            code: "PURCHASE_ORDER_NOT_RECEIVABLE",
            message: "O pedido não está aprovado ou parcialmente recebido.",
          });
        const orderItems = await tx
          .select()
          .from(managementPurchaseOrderItems)
          .where(
            and(
              eq(managementPurchaseOrderItems.organizationId, organizationId),
              eq(managementPurchaseOrderItems.unitId, unitId),
              eq(managementPurchaseOrderItems.purchaseOrderId, purchaseOrderId),
            ),
          );
        const byId = new Map(orderItems.map((item) => [item.id, item]));
        const receiptId = randomUUID();
        const plan = purchaseReceiptPlan(orderItems, input.lines);
        const totalCents = plan.totalCents;
        if (totalCents <= 0)
          throw new BadRequestException({
            code: "ZERO_RECEIPT",
            message: "O recebimento deve possuir valor positivo.",
          });
        await tx.insert(managementPurchaseReceipts).values({
          id: receiptId,
          organizationId,
          unitId,
          purchaseOrderId,
          supplierId: order.supplierId,
          totalCents,
          idempotencyKey,
          receivedByIdentityId: identityId,
          receivedAt: input.receivedAt ? new Date(input.receivedAt) : undefined,
        });
        const receivedByItem = new Map(
          orderItems.map((item) => [item.id, quantityToMilli(item.receivedQuantity)]),
        );
        for (const line of input.lines) {
          const item = byId.get(line.purchaseOrderItemId);
          if (!item)
            throw new NotFoundException({
              code: "PURCHASE_ORDER_ITEM_NOT_FOUND",
              message: "Item não pertence ao pedido desta unidade.",
            });
          const quantityMilli = quantityToMilli(line.quantity);
          const nextReceivedMilli = quantityToMilli(item.receivedQuantity) + quantityMilli;
          if (nextReceivedMilli > quantityToMilli(item.quantity))
            throw new ConflictException({
              code: "RECEIPT_EXCEEDS_ORDER",
              message: "O recebimento excede a quantidade comprada.",
            });
          const [location] = await tx
            .select({ id: managementStockLocations.id })
            .from(managementStockLocations)
            .where(
              and(
                eq(managementStockLocations.organizationId, organizationId),
                eq(managementStockLocations.unitId, unitId),
                eq(managementStockLocations.id, line.locationId),
                eq(managementStockLocations.active, true),
              ),
            )
            .limit(1);
          if (!location)
            throw new NotFoundException({
              code: "STOCK_LOCATION_NOT_FOUND",
              message: "Local de estoque não encontrado nesta unidade.",
            });
          await tx
            .insert(managementStockBalances)
            .values({
              organizationId,
              unitId,
              locationId: line.locationId,
              inventoryItemId: item.inventoryItemId,
            })
            .onConflictDoNothing({
              target: [
                managementStockBalances.organizationId,
                managementStockBalances.unitId,
                managementStockBalances.locationId,
                managementStockBalances.inventoryItemId,
              ],
            });
          await tx.execute(
            sql`select id from management_stock_balances where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and location_id=${line.locationId}::uuid and inventory_item_id=${item.inventoryItemId}::uuid for update`,
          );
          const [balance] = await tx
            .select()
            .from(managementStockBalances)
            .where(
              and(
                eq(managementStockBalances.organizationId, organizationId),
                eq(managementStockBalances.unitId, unitId),
                eq(managementStockBalances.locationId, line.locationId),
                eq(managementStockBalances.inventoryItemId, item.inventoryItemId),
              ),
            )
            .limit(1);
          if (!balance)
            throw new ConflictException({
              code: "BALANCE_LOCK_FAILED",
              message: "Não foi possível bloquear o saldo.",
            });
          const previousMilli = quantityToMilli(balance.quantity);
          const resultingMilli = previousMilli + quantityMilli;
          const previousCost = balance.averageCostCents ?? item.unitCostCents;
          const averageCostCents =
            previousMilli > 0
              ? Math.round(
                  (previousMilli * previousCost + quantityMilli * item.unitCostCents) /
                    resultingMilli,
                )
              : item.unitCostCents;
          const lineTotalCents = Math.round((quantityMilli * item.unitCostCents) / 1_000);
          const receiptLineId = randomUUID();
          await tx.insert(managementPurchaseReceiptLines).values({
            id: receiptLineId,
            organizationId,
            unitId,
            receiptId,
            purchaseOrderItemId: item.id,
            inventoryItemId: item.inventoryItemId,
            locationId: line.locationId,
            quantity: milliToQuantity(quantityMilli),
            unitCostCents: item.unitCostCents,
            totalCents: lineTotalCents,
          });
          await tx.insert(managementInventoryMovements).values({
            organizationId,
            unitId,
            locationId: line.locationId,
            inventoryItemId: item.inventoryItemId,
            type: "purchase_receipt",
            quantityDelta: milliToQuantity(quantityMilli),
            unitCostCents: item.unitCostCents,
            sourceType: "purchase_receipt_line",
            sourceId: receiptLineId,
            actorIdentityId: identityId,
            occurredAt: input.receivedAt ? new Date(input.receivedAt) : undefined,
          });
          await tx
            .update(managementStockBalances)
            .set({
              quantity: milliToQuantity(resultingMilli),
              averageCostCents,
              version: balance.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(managementStockBalances.id, balance.id));
          await tx
            .update(managementPurchaseOrderItems)
            .set({ receivedQuantity: milliToQuantity(nextReceivedMilli), updatedAt: new Date() })
            .where(eq(managementPurchaseOrderItems.id, item.id));
          receivedByItem.set(item.id, nextReceivedMilli);
        }
        const complete = orderItems.every(
          (item) => receivedByItem.get(item.id) === quantityToMilli(item.quantity),
        );
        const status = complete ? "received" : "partially_received";
        await tx
          .update(managementPurchaseOrders)
          .set({ status, version: order.version + 1, updatedAt: new Date() })
          .where(eq(managementPurchaseOrders.id, order.id));
        const payableId = randomUUID();
        await tx.insert(managementAccountsPayable).values({
          id: payableId,
          organizationId,
          unitId,
          supplierId: order.supplierId,
          purchaseReceiptId: receiptId,
          description: `Recebimento ${receiptId}`,
          amountCents: totalCents,
          competenceDate: input.competenceDate,
          dueDate: input.dueDate,
          idempotencyKey: `receipt:${receiptId}`,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.purchase-receipt.recorded",
          "purchase_receipt",
          receiptId,
          { purchaseOrderId, payableId, totalCents, status },
        );
        return { receiptId, purchaseOrderId, payableId, totalCents, purchaseOrderStatus: status };
      },
    );
  }

  async listPurchases(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, [...INVENTORY_ROLES, "finance"]);
    const [orders, items, receipts] = await Promise.all([
      this.database.db
        .select()
        .from(managementPurchaseOrders)
        .where(
          and(
            eq(managementPurchaseOrders.organizationId, organizationId),
            eq(managementPurchaseOrders.unitId, unitId),
          ),
        )
        .orderBy(desc(managementPurchaseOrders.createdAt)),
      this.database.db
        .select()
        .from(managementPurchaseOrderItems)
        .where(
          and(
            eq(managementPurchaseOrderItems.organizationId, organizationId),
            eq(managementPurchaseOrderItems.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementPurchaseReceipts)
        .where(
          and(
            eq(managementPurchaseReceipts.organizationId, organizationId),
            eq(managementPurchaseReceipts.unitId, unitId),
          ),
        )
        .orderBy(desc(managementPurchaseReceipts.receivedAt)),
    ]);
    return { orders, items, receipts };
  }

  async createPayable(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: PayableInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "payable-create",
      input,
      async (tx) => {
        if (input.supplierId) {
          const [supplier] = await tx
            .select({ id: managementSuppliers.id })
            .from(managementSuppliers)
            .where(
              and(
                eq(managementSuppliers.organizationId, organizationId),
                eq(managementSuppliers.unitId, unitId),
                eq(managementSuppliers.id, input.supplierId),
              ),
            )
            .limit(1);
          if (!supplier)
            throw new NotFoundException({
              code: "SUPPLIER_NOT_FOUND",
              message: "Fornecedor não encontrado nesta unidade.",
            });
        }
        const id = randomUUID();
        await tx
          .insert(managementAccountsPayable)
          .values({ id, organizationId, unitId, ...input, idempotencyKey });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.payable.created",
          "payable",
          id,
          { amountCents: input.amountCents },
        );
        return { payableId: id, status: "open", amountCents: input.amountCents };
      },
    );
  }

  async payPayable(
    identityId: string,
    organizationId: string,
    unitId: string,
    payableId: string,
    idempotencyKey: string,
    input: FinancialPaymentInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "payable-payment",
      { payableId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_accounts_payable where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${payableId}::uuid for update`,
        );
        const [payable] = await tx
          .select()
          .from(managementAccountsPayable)
          .where(
            and(
              eq(managementAccountsPayable.organizationId, organizationId),
              eq(managementAccountsPayable.unitId, unitId),
              eq(managementAccountsPayable.id, payableId),
            ),
          )
          .limit(1);
        if (!payable)
          throw new NotFoundException({
            code: "PAYABLE_NOT_FOUND",
            message: "Conta a pagar não encontrada.",
          });
        if (payable.status === "canceled" || payable.status === "paid")
          throw new ConflictException({
            code: "PAYABLE_NOT_OPEN",
            message: "A conta não aceita pagamentos.",
          });
        const next = settlement(payable.amountCents, payable.paidCents, input.amountCents);
        const paymentId = randomUUID();
        await tx.insert(managementPayablePayments).values({
          id: paymentId,
          organizationId,
          unitId,
          payableId,
          amountCents: input.amountCents,
          method: input.method,
          reference: input.reference,
          idempotencyKey,
          paidByIdentityId: identityId,
          paidAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        });
        const status = next.status === "settled" ? "paid" : "partially_paid";
        await tx
          .update(managementAccountsPayable)
          .set({
            paidCents: next.settledCents,
            status,
            version: payable.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(managementAccountsPayable.id, payable.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.payable.paid",
          "payable",
          payable.id,
          { paymentId, amountCents: input.amountCents, status },
        );
        return { payableId, paymentId, paidCents: next.settledCents, status };
      },
    );
  }

  async createReceivable(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReceivableInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    const lineTotal = input.lines.reduce((sum, line) => sum + line.revenueCents, 0);
    if (input.lines.length > 0 && lineTotal !== input.amountCents)
      throw new BadRequestException({
        code: "RECEIVABLE_LINES_TOTAL_MISMATCH",
        message: "A soma das linhas deve ser igual ao valor da conta.",
      });
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "receivable-create",
      input,
      async (tx) => {
        if (input.sourceOrderId)
          await this.requireOrder(tx, organizationId, unitId, input.sourceOrderId);
        for (const line of input.lines)
          if (line.productId) await this.requireProduct(tx, organizationId, line.productId);
        const id = randomUUID();
        await tx.insert(managementAccountsReceivable).values({
          id,
          organizationId,
          unitId,
          sourceOrderId: input.sourceOrderId,
          description: input.description,
          amountCents: input.amountCents,
          competenceDate: input.competenceDate,
          dueDate: input.dueDate,
          idempotencyKey,
        });
        if (input.lines.length > 0)
          await tx.insert(managementReceivableLines).values(
            input.lines.map((line) => ({
              organizationId,
              unitId,
              receivableId: id,
              productId: line.productId,
              description: line.description,
              revenueCents: line.revenueCents,
              costCents: line.costCents ?? null,
            })),
          );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.receivable.created",
          "receivable",
          id,
          { amountCents: input.amountCents, sourceOrderId: input.sourceOrderId ?? null },
        );
        return { receivableId: id, status: "open", amountCents: input.amountCents };
      },
    );
  }

  async receiveReceivable(
    identityId: string,
    organizationId: string,
    unitId: string,
    receivableId: string,
    idempotencyKey: string,
    input: ReceivablePaymentInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_ROLES);
    if (input.method.toLowerCase() === "cash" && !input.cashShiftId)
      throw new BadRequestException({
        code: "CASH_SHIFT_REQUIRED",
        message: "Recebimentos em dinheiro exigem um caixa aberto.",
      });
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "receivable-payment",
      { receivableId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_accounts_receivable where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${receivableId}::uuid for update`,
        );
        const [receivable] = await tx
          .select()
          .from(managementAccountsReceivable)
          .where(
            and(
              eq(managementAccountsReceivable.organizationId, organizationId),
              eq(managementAccountsReceivable.unitId, unitId),
              eq(managementAccountsReceivable.id, receivableId),
            ),
          )
          .limit(1);
        if (!receivable)
          throw new NotFoundException({
            code: "RECEIVABLE_NOT_FOUND",
            message: "Conta a receber não encontrada.",
          });
        if (receivable.status === "canceled" || receivable.status === "received")
          throw new ConflictException({
            code: "RECEIVABLE_NOT_OPEN",
            message: "A conta não aceita recebimentos.",
          });
        if (input.cashShiftId) {
          const [shift] = await tx
            .select({ id: managementCashShifts.id, status: managementCashShifts.status })
            .from(managementCashShifts)
            .where(
              and(
                eq(managementCashShifts.organizationId, organizationId),
                eq(managementCashShifts.unitId, unitId),
                eq(managementCashShifts.id, input.cashShiftId),
              ),
            )
            .limit(1);
          if (!shift)
            throw new NotFoundException({
              code: "CASH_SHIFT_NOT_FOUND",
              message: "Caixa não encontrado nesta unidade.",
            });
          if (shift.status !== "open")
            throw new ConflictException({
              code: "CASH_SHIFT_CLOSED",
              message: "O caixa informado não está aberto.",
            });
        }
        const next = settlement(
          receivable.amountCents,
          receivable.receivedCents,
          input.amountCents,
        );
        const paymentId = randomUUID();
        await tx.insert(managementReceivablePayments).values({
          id: paymentId,
          organizationId,
          unitId,
          receivableId,
          cashShiftId: input.cashShiftId,
          amountCents: input.amountCents,
          method: input.method.toLowerCase(),
          reference: input.reference,
          idempotencyKey,
          receivedByIdentityId: identityId,
          receivedAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        });
        const status = next.status === "settled" ? "received" : "partially_received";
        await tx
          .update(managementAccountsReceivable)
          .set({
            receivedCents: next.settledCents,
            status,
            version: receivable.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(managementAccountsReceivable.id, receivable.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.receivable.received",
          "receivable",
          receivable.id,
          { paymentId, amountCents: input.amountCents, status },
        );
        return { receivableId, paymentId, receivedCents: next.settledCents, status };
      },
    );
  }

  async financeDashboard(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, [...FINANCE_ROLES, "cashier"]);
    const [
      payables,
      payablePayments,
      receivables,
      receivablePayments,
      reconciliationImports,
      reconciliationEntries,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(managementAccountsPayable)
        .where(
          and(
            eq(managementAccountsPayable.organizationId, organizationId),
            eq(managementAccountsPayable.unitId, unitId),
          ),
        )
        .orderBy(managementAccountsPayable.dueDate),
      this.database.db
        .select()
        .from(managementPayablePayments)
        .where(
          and(
            eq(managementPayablePayments.organizationId, organizationId),
            eq(managementPayablePayments.unitId, unitId),
          ),
        )
        .orderBy(desc(managementPayablePayments.paidAt))
        .limit(500),
      this.database.db
        .select()
        .from(managementAccountsReceivable)
        .where(
          and(
            eq(managementAccountsReceivable.organizationId, organizationId),
            eq(managementAccountsReceivable.unitId, unitId),
          ),
        )
        .orderBy(managementAccountsReceivable.dueDate),
      this.database.db
        .select()
        .from(managementReceivablePayments)
        .where(
          and(
            eq(managementReceivablePayments.organizationId, organizationId),
            eq(managementReceivablePayments.unitId, unitId),
          ),
        )
        .orderBy(desc(managementReceivablePayments.receivedAt))
        .limit(500),
      this.database.db
        .select()
        .from(managementReconciliationImports)
        .where(
          and(
            eq(managementReconciliationImports.organizationId, organizationId),
            eq(managementReconciliationImports.unitId, unitId),
          ),
        )
        .orderBy(desc(managementReconciliationImports.importedAt))
        .limit(100),
      this.database.db
        .select()
        .from(managementReconciliationEntries)
        .where(
          and(
            eq(managementReconciliationEntries.organizationId, organizationId),
            eq(managementReconciliationEntries.unitId, unitId),
          ),
        )
        .orderBy(desc(managementReconciliationEntries.createdAt))
        .limit(1_000),
    ]);
    return {
      payables,
      payablePayments,
      receivables,
      receivablePayments,
      reconciliationImports,
      reconciliationEntries,
    };
  }

  async openCashShift(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: OpenCashShiftInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-shift-open",
      input,
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`cash-shift:${organizationId}:${unitId}`}))`,
        );
        const [open] = await tx
          .select({ id: managementCashShifts.id })
          .from(managementCashShifts)
          .where(
            and(
              eq(managementCashShifts.organizationId, organizationId),
              eq(managementCashShifts.unitId, unitId),
              eq(managementCashShifts.status, "open"),
            ),
          )
          .limit(1);
        if (open)
          throw new ConflictException({
            code: "CASH_SHIFT_ALREADY_OPEN",
            message: "A unidade já possui um caixa aberto.",
          });
        const id = randomUUID();
        await tx.insert(managementCashShifts).values({
          id,
          organizationId,
          unitId,
          operatorIdentityId: identityId,
          openingCents: input.openingCents,
          openIdempotencyKey: idempotencyKey,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.cash-shift.opened",
          "cash_shift",
          id,
          { openingCents: input.openingCents },
        );
        return { cashShiftId: id, status: "open", openingCents: input.openingCents };
      },
    );
  }

  async addCashMovement(
    identityId: string,
    organizationId: string,
    unitId: string,
    cashShiftId: string,
    idempotencyKey: string,
    input: CashMovementInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-movement",
      { cashShiftId, ...input },
      async (tx) => {
        const [shift] = await tx
          .select({ id: managementCashShifts.id, status: managementCashShifts.status })
          .from(managementCashShifts)
          .where(
            and(
              eq(managementCashShifts.organizationId, organizationId),
              eq(managementCashShifts.unitId, unitId),
              eq(managementCashShifts.id, cashShiftId),
            ),
          )
          .limit(1);
        if (!shift)
          throw new NotFoundException({
            code: "CASH_SHIFT_NOT_FOUND",
            message: "Caixa não encontrado nesta unidade.",
          });
        if (shift.status !== "open")
          throw new ConflictException({
            code: "CASH_SHIFT_CLOSED",
            message: "O caixa não está aberto.",
          });
        const id = randomUUID();
        await tx.insert(managementCashMovements).values({
          id,
          organizationId,
          unitId,
          cashShiftId,
          ...input,
          idempotencyKey,
          actorIdentityId: identityId,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          `management.cash.${input.type}`,
          "cash_shift",
          cashShiftId,
          { movementId: id, amountCents: input.amountCents, reason: input.reason },
        );
        return { movementId: id, cashShiftId, type: input.type, amountCents: input.amountCents };
      },
    );
  }

  async closeCashShift(
    identityId: string,
    organizationId: string,
    unitId: string,
    cashShiftId: string,
    idempotencyKey: string,
    input: CloseCashShiftInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, CASH_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "cash-shift-close",
      { cashShiftId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_cash_shifts where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${cashShiftId}::uuid for update`,
        );
        const [shift] = await tx
          .select()
          .from(managementCashShifts)
          .where(
            and(
              eq(managementCashShifts.organizationId, organizationId),
              eq(managementCashShifts.unitId, unitId),
              eq(managementCashShifts.id, cashShiftId),
            ),
          )
          .limit(1);
        if (!shift)
          throw new NotFoundException({
            code: "CASH_SHIFT_NOT_FOUND",
            message: "Caixa não encontrado nesta unidade.",
          });
        if (shift.status !== "open")
          throw new ConflictException({
            code: "CASH_SHIFT_CLOSED",
            message: "O caixa já foi fechado.",
          });
        const [movements, receipts] = await Promise.all([
          tx
            .select({
              type: managementCashMovements.type,
              amountCents: managementCashMovements.amountCents,
            })
            .from(managementCashMovements)
            .where(
              and(
                eq(managementCashMovements.organizationId, organizationId),
                eq(managementCashMovements.unitId, unitId),
                eq(managementCashMovements.cashShiftId, cashShiftId),
              ),
            ),
          tx
            .select({ amountCents: managementReceivablePayments.amountCents })
            .from(managementReceivablePayments)
            .where(
              and(
                eq(managementReceivablePayments.organizationId, organizationId),
                eq(managementReceivablePayments.unitId, unitId),
                eq(managementReceivablePayments.cashShiftId, cashShiftId),
                eq(managementReceivablePayments.method, "cash"),
              ),
            ),
        ]);
        const suppliesCents = movements
          .filter((movement) => movement.type === "supply")
          .reduce((sum, movement) => sum + movement.amountCents, 0);
        const withdrawalsCents = movements
          .filter((movement) => movement.type === "withdrawal")
          .reduce((sum, movement) => sum + movement.amountCents, 0);
        const cashReceiptsCents = receipts.reduce((sum, receipt) => sum + receipt.amountCents, 0);
        const conference = cashConference({
          openingCents: shift.openingCents,
          suppliesCents,
          withdrawalsCents,
          cashReceiptsCents,
          countedCents: input.countedCents,
        });
        await tx
          .update(managementCashShifts)
          .set({
            status: "closed",
            ...conference,
            countedCents: input.countedCents,
            closedAt: new Date(),
            closeReason: input.closeReason,
            closeIdempotencyKey: idempotencyKey,
            version: shift.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(managementCashShifts.id, shift.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.cash-shift.closed",
          "cash_shift",
          shift.id,
          {
            ...conference,
            countedCents: input.countedCents,
            suppliesCents,
            withdrawalsCents,
            cashReceiptsCents,
          },
        );
        return {
          cashShiftId,
          status: "closed",
          ...conference,
          countedCents: input.countedCents,
          suppliesCents,
          withdrawalsCents,
          cashReceiptsCents,
        };
      },
    );
  }

  async listCashShifts(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, CASH_ROLES);
    const [shifts, movements] = await Promise.all([
      this.database.db
        .select()
        .from(managementCashShifts)
        .where(
          and(
            eq(managementCashShifts.organizationId, organizationId),
            eq(managementCashShifts.unitId, unitId),
          ),
        )
        .orderBy(desc(managementCashShifts.openedAt))
        .limit(200),
      this.database.db
        .select()
        .from(managementCashMovements)
        .where(
          and(
            eq(managementCashMovements.organizationId, organizationId),
            eq(managementCashMovements.unitId, unitId),
          ),
        )
        .orderBy(desc(managementCashMovements.occurredAt))
        .limit(500),
    ]);
    return { shifts, movements };
  }

  async importReconciliation(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: ReconciliationInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    const uniqueKeys = new Set(input.entries.map((entry) => entry.externalKey));
    if (uniqueKeys.size !== input.entries.length) {
      throw new BadRequestException({
        code: "DUPLICATE_RECONCILIATION_KEY",
        message: "Cada chave externa deve aparecer uma única vez no lote.",
      });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "reconciliation-import",
      input,
      async (tx) => {
        for (const entry of input.entries) {
          if ((entry.status === "matched" || entry.status === "resolved") && !entry.paymentId) {
            throw new BadRequestException({
              code: "RECONCILIATION_PAYMENT_REQUIRED",
              message: "Entradas conciliadas ou resolvidas devem referenciar um pagamento interno.",
            });
          }
          if (!entry.paymentId) continue;
          const table =
            entry.paymentDirection === "payable"
              ? managementPayablePayments
              : managementReceivablePayments;
          const [payment] = await tx
            .select({ id: table.id })
            .from(table)
            .where(
              and(
                eq(table.organizationId, organizationId),
                eq(table.unitId, unitId),
                eq(table.id, entry.paymentId),
              ),
            )
            .limit(1);
          if (!payment) {
            throw new NotFoundException({
              code: "RECONCILIATION_PAYMENT_NOT_FOUND",
              message: "Pagamento interno não encontrado nesta unidade.",
            });
          }
        }
        const importId = randomUUID();
        await tx.insert(managementReconciliationImports).values({
          id: importId,
          organizationId,
          unitId,
          source: input.source,
          fileHash: input.fileHash,
          idempotencyKey,
          importedByIdentityId: identityId,
        });
        await tx.insert(managementReconciliationEntries).values(
          input.entries.map((entry) => ({
            organizationId,
            unitId,
            importId,
            ...entry,
            resolvedByIdentityId: entry.status === "resolved" ? identityId : undefined,
            resolvedAt: entry.status === "resolved" ? new Date() : undefined,
          })),
        );
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.reconciliation.imported",
          "reconciliation_import",
          importId,
          { source: input.source, entryCount: input.entries.length, providerConnected: false },
        );
        return {
          importId,
          source: input.source,
          entryCount: input.entries.length,
          providerConnected: false,
        };
      },
    );
  }

  async reports(
    identityId: string,
    organizationId: string,
    unitId: string,
    period: ReportPeriodInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, FINANCE_ROLES);
    const start = new Date(`${period.from}T00:00:00.000Z`);
    const endExclusive = new Date(`${period.to}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const [payablePayments, receivablePayments, payables, receivables] = await Promise.all([
      this.database.db
        .select()
        .from(managementPayablePayments)
        .where(
          and(
            eq(managementPayablePayments.organizationId, organizationId),
            eq(managementPayablePayments.unitId, unitId),
            gte(managementPayablePayments.paidAt, start),
            lt(managementPayablePayments.paidAt, endExclusive),
          ),
        ),
      this.database.db
        .select()
        .from(managementReceivablePayments)
        .where(
          and(
            eq(managementReceivablePayments.organizationId, organizationId),
            eq(managementReceivablePayments.unitId, unitId),
            gte(managementReceivablePayments.receivedAt, start),
            lt(managementReceivablePayments.receivedAt, endExclusive),
          ),
        ),
      this.database.db
        .select()
        .from(managementAccountsPayable)
        .where(
          and(
            eq(managementAccountsPayable.organizationId, organizationId),
            eq(managementAccountsPayable.unitId, unitId),
            gte(managementAccountsPayable.competenceDate, period.from),
            lte(managementAccountsPayable.competenceDate, period.to),
            isNull(managementAccountsPayable.purchaseReceiptId),
          ),
        ),
      this.database.db
        .select()
        .from(managementAccountsReceivable)
        .where(
          and(
            eq(managementAccountsReceivable.organizationId, organizationId),
            eq(managementAccountsReceivable.unitId, unitId),
            gte(managementAccountsReceivable.competenceDate, period.from),
            lte(managementAccountsReceivable.competenceDate, period.to),
          ),
        ),
    ]);
    const receivableIds = receivables.map((entry) => entry.id);
    const lines =
      receivableIds.length === 0
        ? []
        : await this.database.db
            .select({
              revenueCents: managementReceivableLines.revenueCents,
              costCents: managementReceivableLines.costCents,
            })
            .from(managementReceivableLines)
            .where(
              and(
                eq(managementReceivableLines.organizationId, organizationId),
                eq(managementReceivableLines.unitId, unitId),
                inArray(managementReceivableLines.receivableId, receivableIds),
              ),
            );
    const coverage = profitabilityCoverage(lines);
    const revenueCents = receivables.reduce((sum, entry) => sum + entry.amountCents, 0);
    const operatingExpensesCents = payables.reduce((sum, entry) => sum + entry.amountCents, 0);
    const cmvCents =
      coverage.coverage === "complete" && coverage.revenueCents === revenueCents
        ? coverage.cmvCents
        : null;
    const grossMarginCents = cmvCents === null ? null : revenueCents - cmvCents;
    return {
      period,
      cashFlow: {
        inflowsCents: receivablePayments.reduce((sum, entry) => sum + entry.amountCents, 0),
        outflowsCents: payablePayments.reduce((sum, entry) => sum + entry.amountCents, 0),
        netCents:
          receivablePayments.reduce((sum, entry) => sum + entry.amountCents, 0) -
          payablePayments.reduce((sum, entry) => sum + entry.amountCents, 0),
        basis: "realized_payments_utc",
      },
      incomeStatement: {
        revenueCents,
        cmvCents,
        grossMarginCents,
        operatingExpensesCents,
        operatingResultCents:
          grossMarginCents === null ? null : grossMarginCents - operatingExpensesCents,
        costCoverage: {
          ...coverage,
          completeForRevenue:
            coverage.coverage === "complete" && coverage.revenueCents === revenueCents,
        },
        basis: "competence",
      },
    };
  }

  async peopleDashboard(identityId: string, organizationId: string, unitId: string) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    const [people, schedules, timeEntries, rules, commissions] = await Promise.all([
      this.database.db
        .select()
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
          ),
        )
        .orderBy(managementPeople.name),
      this.database.db
        .select()
        .from(managementSchedules)
        .where(
          and(
            eq(managementSchedules.organizationId, organizationId),
            eq(managementSchedules.unitId, unitId),
          ),
        )
        .orderBy(desc(managementSchedules.startsAt))
        .limit(500),
      this.database.db
        .select()
        .from(managementTimeEntries)
        .where(
          and(
            eq(managementTimeEntries.organizationId, organizationId),
            eq(managementTimeEntries.unitId, unitId),
          ),
        )
        .orderBy(desc(managementTimeEntries.clockedInAt))
        .limit(500),
      this.database.db
        .select()
        .from(managementCommissionRules)
        .where(
          and(
            eq(managementCommissionRules.organizationId, organizationId),
            eq(managementCommissionRules.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(managementCommissions)
        .where(
          and(
            eq(managementCommissions.organizationId, organizationId),
            eq(managementCommissions.unitId, unitId),
          ),
        )
        .orderBy(desc(managementCommissions.createdAt))
        .limit(500),
    ]);
    return { people, schedules, timeEntries, commissionRules: rules, commissions };
  }

  async createPerson(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: PersonInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      if (input.identityId) {
        const [membership] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.identityId, input.identityId),
              eq(memberships.status, "active"),
            ),
          )
          .limit(1);
        if (!membership) {
          throw new NotFoundException({
            code: "PERSON_IDENTITY_NOT_IN_ORGANIZATION",
            message: "A identidade informada não possui vínculo ativo com a organização.",
          });
        }
      }
      const id = randomUUID();
      const [person] = await tx
        .insert(managementPeople)
        .values({ id, organizationId, unitId, ...input })
        .returning();
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.person.created",
        "person",
        id,
        { identityId: input.identityId ?? null },
      );
      return person;
    });
  }

  async createSchedule(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ScheduleInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      const [person] = await tx
        .select({ id: managementPeople.id })
        .from(managementPeople)
        .where(
          and(
            eq(managementPeople.organizationId, organizationId),
            eq(managementPeople.unitId, unitId),
            eq(managementPeople.id, input.personId),
            eq(managementPeople.active, true),
          ),
        )
        .limit(1);
      if (!person)
        throw new NotFoundException({
          code: "PERSON_NOT_FOUND",
          message: "Pessoa não encontrada nesta unidade.",
        });
      const id = randomUUID();
      const [schedule] = await tx
        .insert(managementSchedules)
        .values({
          id,
          organizationId,
          unitId,
          personId: input.personId,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          breakMinutes: input.breakMinutes,
          notes: input.notes,
        })
        .returning();
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.schedule.created",
        "schedule",
        id,
        { personId: input.personId },
      );
      return schedule;
    });
  }

  async createTimeEntry(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: TimeEntryInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "time-entry",
      input,
      async (tx) => {
        const [person] = await tx
          .select({ id: managementPeople.id })
          .from(managementPeople)
          .where(
            and(
              eq(managementPeople.organizationId, organizationId),
              eq(managementPeople.unitId, unitId),
              eq(managementPeople.id, input.personId),
              eq(managementPeople.active, true),
            ),
          )
          .limit(1);
        if (!person)
          throw new NotFoundException({
            code: "PERSON_NOT_FOUND",
            message: "Pessoa não encontrada nesta unidade.",
          });
        const id = randomUUID();
        await tx.insert(managementTimeEntries).values({
          id,
          organizationId,
          unitId,
          personId: input.personId,
          clockedInAt: new Date(input.clockedInAt),
          clockedOutAt: input.clockedOutAt ? new Date(input.clockedOutAt) : undefined,
          source: input.source,
          idempotencyKey,
          recordedByIdentityId: identityId,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-entry.recorded",
          "time_entry",
          id,
          { personId: input.personId },
        );
        return { timeEntryId: id, personId: input.personId };
      },
    );
  }

  async clockOut(
    identityId: string,
    organizationId: string,
    unitId: string,
    timeEntryId: string,
    idempotencyKey: string,
    input: ClockOutInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "time-entry-clock-out",
      { timeEntryId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select id from management_time_entries where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${timeEntryId}::uuid for update`,
        );
        const [entry] = await tx
          .select()
          .from(managementTimeEntries)
          .where(
            and(
              eq(managementTimeEntries.organizationId, organizationId),
              eq(managementTimeEntries.unitId, unitId),
              eq(managementTimeEntries.id, timeEntryId),
            ),
          )
          .limit(1);
        if (!entry) {
          throw new NotFoundException({
            code: "TIME_ENTRY_NOT_FOUND",
            message: "Registro de ponto não encontrado nesta unidade.",
          });
        }
        if (entry.clockedOutAt) {
          throw new ConflictException({
            code: "TIME_ENTRY_ALREADY_CLOSED",
            message: "O registro de ponto já foi encerrado.",
          });
        }
        const clockedOutAt = new Date(input.clockedOutAt);
        if (clockedOutAt <= entry.clockedInAt) {
          throw new BadRequestException({
            code: "INVALID_TIME_ENTRY_WINDOW",
            message: "A saída deve ser posterior à entrada.",
          });
        }
        await tx
          .update(managementTimeEntries)
          .set({ clockedOutAt, updatedAt: new Date() })
          .where(eq(managementTimeEntries.id, entry.id));
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.time-entry.closed",
          "time_entry",
          entry.id,
          { personId: entry.personId, clockedOutAt: clockedOutAt.toISOString() },
        );
        return {
          timeEntryId: entry.id,
          personId: entry.personId,
          clockedOutAt: clockedOutAt.toISOString(),
        };
      },
    );
  }

  async createCommissionRule(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: CommissionRuleInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.database.db.transaction(async (tx) => {
      const id = randomUUID();
      const [rule] = await tx
        .insert(managementCommissionRules)
        .values({ id, organizationId, unitId, ...input })
        .returning();
      await this.record(
        tx,
        identityId,
        organizationId,
        unitId,
        "management.commission-rule.created",
        "commission_rule",
        id,
        { basisPoints: input.basisPoints },
      );
      return rule;
    });
  }

  async createCommission(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: CommissionInput,
  ) {
    await this.requireRole(identityId, organizationId, unitId, PEOPLE_ROLES);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "commission",
      input,
      async (tx) => {
        const [person] = await tx
          .select({ id: managementPeople.id })
          .from(managementPeople)
          .where(
            and(
              eq(managementPeople.organizationId, organizationId),
              eq(managementPeople.unitId, unitId),
              eq(managementPeople.id, input.personId),
            ),
          )
          .limit(1);
        if (!person)
          throw new NotFoundException({
            code: "PERSON_NOT_FOUND",
            message: "Pessoa não encontrada nesta unidade.",
          });
        if (input.sourceOrderId)
          await this.requireOrder(tx, organizationId, unitId, input.sourceOrderId);
        let amountCents = input.amountCents;
        if (input.ruleId) {
          const [rule] = await tx
            .select()
            .from(managementCommissionRules)
            .where(
              and(
                eq(managementCommissionRules.organizationId, organizationId),
                eq(managementCommissionRules.unitId, unitId),
                eq(managementCommissionRules.id, input.ruleId),
                eq(managementCommissionRules.active, true),
              ),
            )
            .limit(1);
          if (!rule)
            throw new NotFoundException({
              code: "COMMISSION_RULE_NOT_FOUND",
              message: "Regra de comissão não encontrada nesta unidade.",
            });
          const calculated = Math.round((input.baseCents * rule.basisPoints) / 10_000);
          if (amountCents !== undefined && amountCents !== calculated)
            throw new ConflictException({
              code: "COMMISSION_AMOUNT_MISMATCH",
              message: "O valor informado diverge da regra.",
            });
          amountCents = calculated;
        }
        if (amountCents === undefined)
          throw new BadRequestException({
            code: "COMMISSION_AMOUNT_REQUIRED",
            message: "Informe uma regra ou o valor da comissão.",
          });
        const id = randomUUID();
        await tx.insert(managementCommissions).values({
          id,
          organizationId,
          unitId,
          personId: input.personId,
          ruleId: input.ruleId,
          sourceOrderId: input.sourceOrderId,
          baseCents: input.baseCents,
          amountCents,
          idempotencyKey,
        });
        await this.record(
          tx,
          identityId,
          organizationId,
          unitId,
          "management.commission.created",
          "commission",
          id,
          { personId: input.personId, amountCents },
        );
        return { commissionId: id, amountCents, status: "pending" };
      },
    );
  }
}
