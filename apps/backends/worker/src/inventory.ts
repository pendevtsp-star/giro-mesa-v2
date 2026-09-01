import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  managementInventoryIssueRoutes,
  managementInventoryItems,
  managementInventoryLots,
  managementInventoryMovements,
  managementInventoryReservations,
  managementProductReturnables,
  managementRecipeComponents,
  managementRecipeVersions,
  managementReportCostSnapshots,
  managementReturnableCustodyMovements,
  managementReturnablePolicies,
  managementStockBalances,
  outboxEvents,
  posOrderItems,
  posOrders,
  posTabs,
} from "@giromesa/db";
import { and, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_SENT_KEYS = new Set(["orderId", "organizationId", "tabId", "ticketIds", "unitId"]);
const RECIPE_SOURCE_TYPE = "pos_order_recipe_component";
const DIRECT_SOURCE_TYPE = "pos_order_direct_item";
const CANCELLATION_SOURCE_TYPE = "pos_order_item_cancellation";
const RETURNABLE_ISSUE_SOURCE_TYPE = "pos_order_item_returnable_issue";
const RETURNABLE_CANCEL_SOURCE_TYPE = "pos_order_item_returnable_cancellation";
const ITEM_CANCELED_KEYS = new Set([
  "approvalId",
  "itemId",
  "organizationId",
  "reason",
  "tabId",
  "unitId",
]);

export interface OrderSentOutboxEvent {
  aggregate_id: string;
  aggregate_type: string;
  id: string;
  payload: Record<string, unknown>;
}

interface OrderSentPayload {
  orderId: string;
  organizationId: string;
  tabId: string;
  ticketIds: string[];
  unitId: string;
}

interface ItemCanceledPayload {
  approvalId: string;
  itemId: string;
  organizationId: string;
  reason: string;
  tabId: string;
  unitId: string;
}

interface InventoryItem {
  active: boolean;
  allowNegative: boolean;
  id: string;
  kind: "ingredient" | "prepared" | "resale" | "reusable" | "returnable_container";
  minimumQuantity: string;
  name: string;
  productId: string | null;
  unit: string;
}

interface ConsumptionTask {
  componentId: string;
  componentKind: "direct" | "recipe";
  inventoryItem: InventoryItem;
  locationId: string | null;
  orderItemId: string;
  productId: string;
  requiredMilli: bigint;
  recipeVersionId: string | null;
  sourceId: string;
  sourceType: typeof DIRECT_SOURCE_TYPE | typeof RECIPE_SOURCE_TYPE;
}

interface LockedBalance extends Record<string, unknown> {
  averageCostCents: number | null;
  id: string;
  locationCode: string;
  locationId: string;
  quantity: string;
  blockedQuantity: string;
  reservedOtherQuantity: string;
  version: number;
}

interface BalanceState extends LockedBalance {
  originalMilli: bigint;
  blockedMilli: bigint;
  reservedOtherMilli: bigint;
  virtualMilli: bigint;
}

interface Allocation {
  balance: BalanceState;
  quantityMilli: bigint;
}

interface PlannedConsumption {
  allocations: Allocation[];
  task: ConsumptionTask;
}

interface InventoryIssue {
  code:
    | "INVENTORY_MAPPING_AMBIGUOUS"
    | "INVENTORY_MAPPING_MISSING"
    | "INVENTORY_RECIPE_LOSS_INVALID"
    | "INVENTORY_STOCK_BALANCE_MISSING"
    | "INVENTORY_STOCK_INSUFFICIENT"
    | "INVENTORY_STOCK_LOW"
    | "INVENTORY_STOCK_NEGATIVE_ALLOWED"
    | "INVENTORY_ISSUE_ROUTE_MISSING";
  componentId?: string;
  currentQuantity?: string;
  inventoryItemId?: string;
  orderItemId: string;
  policy: "block_and_retry" | "deduct_and_alert" | "notify_only";
  requiredQuantity?: string;
  unit?: string;
}

export interface InventoryConsumptionResult {
  issueCodes: string[];
  movementCount: number;
  retryRequired: boolean;
}

export interface InventoryReversalResult {
  movementCount: number;
}

export class InventoryConsumptionError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "InventoryConsumptionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOrderSentPayload(payload: unknown): OrderSentPayload {
  if (!isRecord(payload)) throw new InventoryConsumptionError("INVENTORY_ORDER_EVENT_INVALID");
  const keys = Object.keys(payload);
  if (keys.length !== ORDER_SENT_KEYS.size || keys.some((key) => !ORDER_SENT_KEYS.has(key))) {
    throw new InventoryConsumptionError("INVENTORY_ORDER_EVENT_INVALID");
  }
  const { orderId, organizationId, tabId, ticketIds, unitId } = payload;
  if (
    typeof orderId !== "string" ||
    !UUID.test(orderId) ||
    typeof organizationId !== "string" ||
    !UUID.test(organizationId) ||
    typeof tabId !== "string" ||
    !UUID.test(tabId) ||
    !Array.isArray(ticketIds) ||
    ticketIds.length < 1 ||
    ticketIds.length > 1_000 ||
    ticketIds.some((ticketId) => typeof ticketId !== "string" || !UUID.test(ticketId)) ||
    new Set(ticketIds).size !== ticketIds.length ||
    typeof unitId !== "string" ||
    !UUID.test(unitId)
  ) {
    throw new InventoryConsumptionError("INVENTORY_ORDER_EVENT_INVALID");
  }
  return { orderId, organizationId, tabId, ticketIds: ticketIds as string[], unitId };
}

export function parseItemCanceledPayload(payload: unknown): ItemCanceledPayload {
  if (!isRecord(payload)) throw new InventoryConsumptionError("INVENTORY_CANCEL_EVENT_INVALID");
  const keys = Object.keys(payload);
  if (keys.length !== ITEM_CANCELED_KEYS.size || keys.some((key) => !ITEM_CANCELED_KEYS.has(key))) {
    throw new InventoryConsumptionError("INVENTORY_CANCEL_EVENT_INVALID");
  }
  const { approvalId, itemId, organizationId, reason, tabId, unitId } = payload;
  if (
    typeof approvalId !== "string" ||
    !UUID.test(approvalId) ||
    typeof itemId !== "string" ||
    !UUID.test(itemId) ||
    typeof organizationId !== "string" ||
    !UUID.test(organizationId) ||
    typeof reason !== "string" ||
    reason.trim().length < 1 ||
    reason.length > 1_000 ||
    typeof tabId !== "string" ||
    !UUID.test(tabId) ||
    typeof unitId !== "string" ||
    !UUID.test(unitId)
  ) {
    throw new InventoryConsumptionError("INVENTORY_CANCEL_EVENT_INVALID");
  }
  return { approvalId, itemId, organizationId, reason, tabId, unitId };
}

export function deterministicUuid(value: string) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] ?? 0) & 0x0f;
  bytes[6] = (bytes[6] ?? 0) | 0x50;
  bytes[8] = (bytes[8] ?? 0) & 0x3f;
  bytes[8] = (bytes[8] ?? 0) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function quantityToMilli(quantity: string) {
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(quantity)) {
    throw new InventoryConsumptionError("INVENTORY_QUANTITY_INVALID");
  }
  const negative = quantity.startsWith("-");
  const unsigned = negative ? quantity.slice(1) : quantity;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const milli = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
  return negative ? -milli : milli;
}

export function milliToQuantity(milli: bigint) {
  const negative = milli < 0n;
  const absolute = negative ? -milli : milli;
  const whole = absolute / 1_000n;
  const fraction = String(absolute % 1_000n).padStart(3, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function recipeConsumptionMilli(
  quantityMilli: number,
  orderQuantity: number,
  lossBasisPoints: number,
) {
  if (
    !Number.isInteger(quantityMilli) ||
    quantityMilli <= 0 ||
    !Number.isInteger(orderQuantity) ||
    orderQuantity <= 0 ||
    !Number.isInteger(lossBasisPoints) ||
    lossBasisPoints < 0 ||
    lossBasisPoints >= 10_000
  ) {
    throw new InventoryConsumptionError("INVENTORY_RECIPE_LOSS_INVALID");
  }
  const netMilli = BigInt(quantityMilli) * BigInt(orderQuantity);
  const yieldBasisPoints = BigInt(10_000 - lossBasisPoints);
  return (netMilli * 10_000n + yieldBasisPoints - 1n) / yieldBasisPoints;
}

function addAllocation(allocations: Allocation[], balance: BalanceState, quantityMilli: bigint) {
  if (quantityMilli <= 0n) return;
  const existing = allocations.find((allocation) => allocation.balance.id === balance.id);
  if (existing) existing.quantityMilli += quantityMilli;
  else allocations.push({ balance, quantityMilli });
}

async function recordIssue(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  event: OrderSentOutboxEvent,
  request: OrderSentPayload,
  actorIdentityId: string | null,
  issue: InventoryIssue,
) {
  const issueId = deterministicUuid(
    `inventory-issue:${request.organizationId}:${request.unitId}:${request.orderId}:${issue.orderItemId}:${issue.componentId ?? "order"}:${issue.inventoryItemId ?? "unmapped"}:${issue.code}`,
  );
  const inserted = await tx
    .insert(outboxEvents)
    .values({
      id: issueId,
      topic: "management.inventory_attention_required",
      aggregateType: "inventory_consumption_issue",
      aggregateId: issueId,
      payload: {
        code: issue.code,
        componentId: issue.componentId ?? null,
        currentQuantity: issue.currentQuantity ?? null,
        inventoryItemId: issue.inventoryItemId ?? null,
        orderId: request.orderId,
        orderItemId: issue.orderItemId,
        organizationId: request.organizationId,
        outboxEventId: event.id,
        policy: issue.policy,
        requiredQuantity: issue.requiredQuantity ?? null,
        unit: issue.unit ?? null,
        unitId: request.unitId,
      },
    })
    .onConflictDoNothing()
    .returning({ id: outboxEvents.id });
  if (inserted.length === 0) return;
  await tx.insert(auditEvents).values({
    id: deterministicUuid(`audit:${issueId}`),
    action: "management.inventory.consumption-attention-required",
    actorIdentityId,
    entityId: request.orderId,
    entityType: "order",
    metadata: {
      code: issue.code,
      componentId: issue.componentId ?? null,
      inventoryItemId: issue.inventoryItemId ?? null,
      orderItemId: issue.orderItemId,
      policy: issue.policy,
    },
    organizationId: request.organizationId,
    unitId: request.unitId,
  });
}

export async function consumeOrderSentInventory(
  database: Database,
  event: OrderSentOutboxEvent,
): Promise<InventoryConsumptionResult> {
  if (!UUID.test(event.id)) throw new InventoryConsumptionError("INVENTORY_ORDER_EVENT_INVALID");
  const request = parseOrderSentPayload(event.payload);
  if (event.aggregate_type !== "tab" || event.aggregate_id !== request.tabId) {
    throw new InventoryConsumptionError("INVENTORY_ORDER_EVENT_SCOPE_INVALID");
  }

  return database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`inventory-order:${request.organizationId}:${request.unitId}:${request.orderId}`}))`,
    );
    const [order] = await tx
      .select({
        createdByIdentityId: posOrders.createdByIdentityId,
        id: posOrders.id,
        sentAt: posOrders.sentAt,
        status: posOrders.status,
        tabId: posOrders.tabId,
        responsibleIdentityId: posTabs.responsibleIdentityId,
        counterpartyName: posTabs.customerName,
        promisedAt: posTabs.promisedAt,
      })
      .from(posOrders)
      .innerJoin(
        posTabs,
        and(
          eq(posTabs.organizationId, posOrders.organizationId),
          eq(posTabs.unitId, posOrders.unitId),
          eq(posTabs.id, posOrders.tabId),
        ),
      )
      .where(
        and(
          eq(posOrders.organizationId, request.organizationId),
          eq(posOrders.unitId, request.unitId),
          eq(posOrders.id, request.orderId),
        ),
      )
      .limit(1);
    if (!order || order.tabId !== request.tabId || order.status === "draft" || !order.sentAt) {
      throw new InventoryConsumptionError("INVENTORY_ORDER_EVENT_SCOPE_INVALID");
    }

    const completionAuditId = deterministicUuid(
      `inventory-order-completed:${request.organizationId}:${request.unitId}:${request.orderId}`,
    );
    const [completed] = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.id, completionAuditId))
      .limit(1);
    if (completed) return { issueCodes: [], movementCount: 0, retryRequired: false };

    const orderItems = await tx
      .select({
        id: posOrderItems.id,
        productId: posOrderItems.productId,
        quantity: posOrderItems.quantity,
        stationId: posOrderItems.stationId,
      })
      .from(posOrderItems)
      .where(
        and(
          eq(posOrderItems.organizationId, request.organizationId),
          eq(posOrderItems.unitId, request.unitId),
          eq(posOrderItems.orderId, request.orderId),
          ne(posOrderItems.status, "canceled"),
        ),
      );

    const productIds = [...new Set(orderItems.map((item) => item.productId))];
    const [components, inventoryRows, issueRoutes] = await Promise.all([
      tx
        .select({
          id: managementRecipeComponents.id,
          inventoryItemId: managementRecipeComponents.inventoryItemId,
          locationId: managementRecipeComponents.locationId,
          lossBasisPoints: managementRecipeComponents.lossBasisPoints,
          productId: managementRecipeVersions.productId,
          quantityMilli: managementRecipeComponents.quantityMilli,
          recipeVersionId: managementRecipeVersions.id,
          recipeVersion: managementRecipeVersions.version,
        })
        .from(managementRecipeVersions)
        .innerJoin(
          managementRecipeComponents,
          and(
            eq(managementRecipeComponents.organizationId, managementRecipeVersions.organizationId),
            eq(managementRecipeComponents.unitId, managementRecipeVersions.unitId),
            eq(managementRecipeComponents.recipeVersionId, managementRecipeVersions.id),
          ),
        )
        .where(
          and(
            eq(managementRecipeVersions.organizationId, request.organizationId),
            eq(managementRecipeVersions.unitId, request.unitId),
            inArray(managementRecipeVersions.productId, productIds),
            lte(managementRecipeVersions.validFrom, order.sentAt),
            or(
              isNull(managementRecipeVersions.validUntil),
              gt(managementRecipeVersions.validUntil, order.sentAt),
            ),
          ),
        ),
      tx
        .select({
          active: managementInventoryItems.active,
          allowNegative: managementInventoryItems.allowNegative,
          id: managementInventoryItems.id,
          kind: managementInventoryItems.kind,
          minimumQuantity: managementInventoryItems.minimumQuantity,
          name: managementInventoryItems.name,
          productId: managementInventoryItems.productId,
          unit: managementInventoryItems.unit,
        })
        .from(managementInventoryItems)
        .where(
          and(
            eq(managementInventoryItems.organizationId, request.organizationId),
            eq(managementInventoryItems.unitId, request.unitId),
          ),
        ),
      tx
        .select({
          locationId: managementInventoryIssueRoutes.locationId,
          productId: managementInventoryIssueRoutes.productId,
          stationId: managementInventoryIssueRoutes.stationId,
        })
        .from(managementInventoryIssueRoutes)
        .where(
          and(
            eq(managementInventoryIssueRoutes.organizationId, request.organizationId),
            eq(managementInventoryIssueRoutes.unitId, request.unitId),
            eq(managementInventoryIssueRoutes.active, true),
            inArray(managementInventoryIssueRoutes.productId, productIds),
          ),
        ),
    ]);
    const inventoryItems = inventoryRows as InventoryItem[];
    const recipesByProduct = new Map<string, typeof components>();
    for (const component of components) {
      const recipe = recipesByProduct.get(component.productId) ?? [];
      recipe.push(component);
      recipesByProduct.set(component.productId, recipe);
    }
    const inventoryById = new Map<string, InventoryItem>();
    const inventoryByProduct = new Map<string, InventoryItem[]>();
    for (const item of inventoryItems) {
      inventoryById.set(item.id, item);
      if (item.active && item.kind === "resale" && item.productId) {
        inventoryByProduct.set(item.productId, [
          ...(inventoryByProduct.get(item.productId) ?? []),
          item,
        ]);
      }
    }

    const blockingIssues: InventoryIssue[] = [];
    const tasks: ConsumptionTask[] = [];
    for (const orderItem of orderItems) {
      const recipe = recipesByProduct.get(orderItem.productId) ?? [];
      if (recipe.length === 0) {
        const directItems = inventoryByProduct.get(orderItem.productId) ?? [];
        if (directItems.length === 0) continue;
        if (directItems.length > 1) {
          blockingIssues.push({
            code: "INVENTORY_MAPPING_AMBIGUOUS",
            orderItemId: orderItem.id,
            policy: "block_and_retry",
          });
          continue;
        }
        const inventoryItem = directItems[0];
        if (!inventoryItem) continue;
        const issueRoute =
          issueRoutes.find(
            (route) =>
              route.productId === orderItem.productId &&
              orderItem.stationId !== null &&
              route.stationId === orderItem.stationId,
          ) ??
          issueRoutes.find(
            (route) => route.productId === orderItem.productId && route.stationId === null,
          );
        const sourceId = deterministicUuid(
          `inventory-direct:${request.organizationId}:${request.unitId}:${request.orderId}:${orderItem.id}:${inventoryItem.id}`,
        );
        tasks.push({
          componentId: inventoryItem.id,
          componentKind: "direct",
          inventoryItem,
          locationId: issueRoute?.locationId ?? null,
          orderItemId: orderItem.id,
          productId: orderItem.productId,
          requiredMilli: BigInt(orderItem.quantity) * 1_000n,
          recipeVersionId: null,
          sourceId,
          sourceType: DIRECT_SOURCE_TYPE,
        });
        continue;
      }
      for (const component of recipe) {
        const inventoryItem = inventoryById.get(component.inventoryItemId);
        if (!inventoryItem) {
          blockingIssues.push({
            code: "INVENTORY_MAPPING_MISSING",
            componentId: component.id,
            orderItemId: orderItem.id,
            policy: "block_and_retry",
          });
          continue;
        }
        let requiredMilli: bigint;
        try {
          requiredMilli = recipeConsumptionMilli(
            component.quantityMilli,
            orderItem.quantity,
            component.lossBasisPoints,
          );
        } catch {
          blockingIssues.push({
            code: "INVENTORY_RECIPE_LOSS_INVALID",
            componentId: component.id,
            inventoryItemId: inventoryItem.id,
            orderItemId: orderItem.id,
            policy: "block_and_retry",
            unit: inventoryItem.unit,
          });
          continue;
        }
        tasks.push({
          componentId: component.id,
          componentKind: "recipe",
          inventoryItem,
          locationId: component.locationId,
          orderItemId: orderItem.id,
          productId: orderItem.productId,
          requiredMilli,
          recipeVersionId: component.recipeVersionId,
          sourceId: deterministicUuid(
            `inventory-recipe:${request.organizationId}:${request.unitId}:${request.orderId}:${orderItem.id}:${component.id}`,
          ),
          sourceType: RECIPE_SOURCE_TYPE,
        });
      }
    }
    tasks.sort((left, right) =>
      `${left.inventoryItem.id}:${left.sourceId}`.localeCompare(
        `${right.inventoryItem.id}:${right.sourceId}`,
      ),
    );

    const balanceStates = new Map<string, BalanceState[]>();
    const balancesById = new Map<string, BalanceState>();
    const plans: PlannedConsumption[] = [];
    const warnings: InventoryIssue[] = [];
    for (const task of tasks) {
      const [existing] = await tx
        .select({ id: managementInventoryMovements.id })
        .from(managementInventoryMovements)
        .where(
          and(
            eq(managementInventoryMovements.organizationId, request.organizationId),
            eq(managementInventoryMovements.unitId, request.unitId),
            eq(managementInventoryMovements.sourceType, task.sourceType),
            eq(managementInventoryMovements.sourceId, task.sourceId),
          ),
        )
        .limit(1);
      if (existing) continue;

      const taskBalanceKey = `${task.inventoryItem.id}:${task.locationId ?? "*"}`;
      let balances = balanceStates.get(taskBalanceKey);
      if (!balances) {
        const rows = await tx.execute<LockedBalance>(sql`
          select balance.id,
                 balance.location_id as "locationId",
                 location.code as "locationCode",
                 balance.quantity,
                 balance.average_cost_cents as "averageCostCents",
                 coalesce((
                   select sum(lot.quantity)
                   from management_inventory_lots as lot
                   inner join management_inventory_lot_holds as hold
                     on hold.organization_id = lot.organization_id
                    and hold.unit_id = lot.unit_id
                    and hold.lot_id = lot.id
                    and hold.status = 'active'
                   where lot.organization_id = balance.organization_id
                     and lot.unit_id = balance.unit_id
                     and lot.location_id = balance.location_id
                     and lot.inventory_item_id = balance.inventory_item_id
                     and lot.active = true
                 ), 0) as "blockedQuantity",
                 coalesce((
                   select sum(reservation.quantity)
                   from management_inventory_reservations as reservation
                   where reservation.organization_id = balance.organization_id
                     and reservation.unit_id = balance.unit_id
                     and reservation.location_id = balance.location_id
                     and reservation.inventory_item_id = balance.inventory_item_id
                     and reservation.status = 'active'
                     and (reservation.expires_at is null or reservation.expires_at > now())
                     and not (
                       reservation.source_type = 'order'
                       and reservation.source_id = ${request.orderId}
                     )
                 ), 0) as "reservedOtherQuantity",
                 balance.version
          from management_stock_balances as balance
          inner join management_stock_locations as location
            on location.organization_id = balance.organization_id
           and location.unit_id = balance.unit_id
           and location.id = balance.location_id
          where balance.organization_id = ${request.organizationId}::uuid
            and balance.unit_id = ${request.unitId}::uuid
            and balance.inventory_item_id = ${task.inventoryItem.id}::uuid
            and (${task.locationId}::uuid is null or balance.location_id = ${task.locationId}::uuid)
            and (${task.locationId}::uuid is not null or location.active = true)
          order by location.code, balance.location_id
          for update of balance
        `);
        balances = [...rows].map((row) => {
          const existing = balancesById.get(row.id);
          if (existing) return existing;
          const state = {
            ...row,
            blockedMilli: quantityToMilli(row.blockedQuantity),
            originalMilli: quantityToMilli(row.quantity),
            reservedOtherMilli: quantityToMilli(row.reservedOtherQuantity),
            virtualMilli: quantityToMilli(row.quantity),
          };
          balancesById.set(row.id, state);
          return state;
        });
        balanceStates.set(taskBalanceKey, balances);
      }
      if (task.componentKind === "direct" && task.locationId === null && balances.length > 1) {
        blockingIssues.push({
          code: "INVENTORY_ISSUE_ROUTE_MISSING",
          componentId: task.componentId,
          inventoryItemId: task.inventoryItem.id,
          orderItemId: task.orderItemId,
          policy: "block_and_retry",
          unit: task.inventoryItem.unit,
        });
        continue;
      }
      if (balances.length === 0) {
        blockingIssues.push({
          code: "INVENTORY_STOCK_BALANCE_MISSING",
          componentId: task.componentId,
          inventoryItemId: task.inventoryItem.id,
          orderItemId: task.orderItemId,
          policy: "block_and_retry",
          requiredQuantity: milliToQuantity(task.requiredMilli),
          unit: task.inventoryItem.unit,
        });
        continue;
      }

      const availableMilli = balances.reduce((total, balance) => {
        const available = balance.virtualMilli - balance.reservedOtherMilli - balance.blockedMilli;
        return total + (available > 0n ? available : 0n);
      }, 0n);
      if (!task.inventoryItem.allowNegative && availableMilli < task.requiredMilli) {
        blockingIssues.push({
          code: "INVENTORY_STOCK_INSUFFICIENT",
          componentId: task.componentId,
          currentQuantity: milliToQuantity(availableMilli),
          inventoryItemId: task.inventoryItem.id,
          orderItemId: task.orderItemId,
          policy: "block_and_retry",
          requiredQuantity: milliToQuantity(task.requiredMilli),
          unit: task.inventoryItem.unit,
        });
        continue;
      }

      let remainingMilli = task.requiredMilli;
      const allocations: Allocation[] = [];
      for (const balance of balances) {
        const spendable = balance.virtualMilli - balance.reservedOtherMilli - balance.blockedMilli;
        const available = spendable > 0n ? spendable : 0n;
        const allocated = available < remainingMilli ? available : remainingMilli;
        addAllocation(allocations, balance, allocated);
        balance.virtualMilli -= allocated;
        remainingMilli -= allocated;
        if (remainingMilli === 0n) break;
      }
      if (remainingMilli > 0n) {
        const negativeBalance = balances[0];
        if (!negativeBalance) {
          throw new InventoryConsumptionError("INVENTORY_BALANCE_LOCK_FAILED");
        }
        addAllocation(allocations, negativeBalance, remainingMilli);
        negativeBalance.virtualMilli -= remainingMilli;
        warnings.push({
          code: "INVENTORY_STOCK_NEGATIVE_ALLOWED",
          componentId: task.componentId,
          currentQuantity: milliToQuantity(availableMilli),
          inventoryItemId: task.inventoryItem.id,
          orderItemId: task.orderItemId,
          policy: "deduct_and_alert",
          requiredQuantity: milliToQuantity(task.requiredMilli),
          unit: task.inventoryItem.unit,
        });
      }
      plans.push({ allocations, task });
    }

    if (blockingIssues.length > 0) {
      for (const issue of blockingIssues) {
        await recordIssue(tx, event, request, order.createdByIdentityId, issue);
      }
      return {
        issueCodes: [...new Set(blockingIssues.map((issue) => issue.code))],
        movementCount: 0,
        retryRequired: true,
      };
    }

    for (const plan of plans) {
      for (const allocation of plan.allocations) {
        const lotRows = await tx.execute<{
          id: string;
          quantity: string;
        }>(sql`
          select id, quantity
          from management_inventory_lots
          where organization_id = ${request.organizationId}::uuid
            and unit_id = ${request.unitId}::uuid
            and location_id = ${allocation.balance.locationId}::uuid
            and inventory_item_id = ${plan.task.inventoryItem.id}::uuid
            and active = true
            and quantity > 0
            and not exists (
              select 1
              from management_inventory_lot_holds hold
              where hold.organization_id = management_inventory_lots.organization_id
                and hold.unit_id = management_inventory_lots.unit_id
                and hold.lot_id = management_inventory_lots.id
                and hold.status = 'active'
            )
          order by expires_at asc nulls last, created_at, id
          for update
        `);
        let remainingLotMilli = allocation.quantityMilli;
        const consumedLotIds: string[] = [];
        for (const lot of lotRows) {
          if (remainingLotMilli === 0n) break;
          const availableLotMilli = quantityToMilli(lot.quantity);
          const consumedMilli =
            availableLotMilli < remainingLotMilli ? availableLotMilli : remainingLotMilli;
          if (consumedMilli <= 0n) continue;
          await tx
            .update(managementInventoryLots)
            .set({
              quantity: milliToQuantity(availableLotMilli - consumedMilli),
              updatedAt: new Date(),
            })
            .where(eq(managementInventoryLots.id, lot.id));
          consumedLotIds.push(lot.id);
          remainingLotMilli -= consumedMilli;
        }
        if (remainingLotMilli > 0n) {
          const held = await tx.execute<{ id: string }>(sql`
            select hold.id
            from management_inventory_lot_holds hold
            join management_inventory_lots lot on lot.organization_id = hold.organization_id
              and lot.unit_id = hold.unit_id
              and lot.id = hold.lot_id
            where hold.organization_id = ${request.organizationId}::uuid
              and hold.unit_id = ${request.unitId}::uuid
              and hold.status = 'active'
              and lot.location_id = ${allocation.balance.locationId}::uuid
              and lot.inventory_item_id = ${plan.task.inventoryItem.id}::uuid
            limit 1
          `);
          if (held.length) throw new InventoryConsumptionError("INVENTORY_STOCK_INSUFFICIENT");
        }
        const [movement] = await tx
          .insert(managementInventoryMovements)
          .values({
            actorIdentityId: order.createdByIdentityId,
            inventoryItemId: plan.task.inventoryItem.id,
            lotId:
              remainingLotMilli === 0n && consumedLotIds.length === 1 ? consumedLotIds[0] : null,
            locationId: allocation.balance.locationId,
            organizationId: request.organizationId,
            quantityDelta: milliToQuantity(-allocation.quantityMilli),
            sourceId: plan.task.sourceId,
            sourceType: plan.task.sourceType,
            type: "order_consumption",
            unitCostCents: allocation.balance.averageCostCents,
            unitId: request.unitId,
          })
          .onConflictDoNothing()
          .returning({ id: managementInventoryMovements.id });
        if (!movement) {
          throw new InventoryConsumptionError("INVENTORY_IDEMPOTENCY_CONFLICT");
        }
      }
      const taskBalanceKey = `${plan.task.inventoryItem.id}:${plan.task.locationId ?? "*"}`;
      const states = balanceStates.get(taskBalanceKey) ?? [];
      const resultingMilli = states.reduce((total, balance) => total + balance.virtualMilli, 0n);
      if (resultingMilli < quantityToMilli(plan.task.inventoryItem.minimumQuantity)) {
        warnings.push({
          code: "INVENTORY_STOCK_LOW",
          componentId: plan.task.componentId,
          currentQuantity: milliToQuantity(resultingMilli),
          inventoryItemId: plan.task.inventoryItem.id,
          orderItemId: plan.task.orderItemId,
          policy: "notify_only",
          unit: plan.task.inventoryItem.unit,
        });
      }
    }

    const costSnapshots = new Map<string, { covered: boolean; numerator: bigint }>();
    for (const plan of plans) {
      const snapshot = costSnapshots.get(plan.task.orderItemId) ?? {
        covered: true,
        numerator: 0n,
      };
      for (const allocation of plan.allocations) {
        if (allocation.balance.averageCostCents === null) snapshot.covered = false;
        else
          snapshot.numerator +=
            allocation.quantityMilli * BigInt(allocation.balance.averageCostCents);
      }
      costSnapshots.set(plan.task.orderItemId, snapshot);
    }
    for (const [orderItemId, snapshot] of costSnapshots) {
      const costCents = snapshot.covered ? Number((snapshot.numerator + 500n) / 1_000n) : null;
      if (costCents !== null && (!Number.isSafeInteger(costCents) || costCents > 2_147_483_647)) {
        throw new InventoryConsumptionError("INVENTORY_COST_SNAPSHOT_OVERFLOW");
      }
      await tx
        .update(posOrderItems)
        .set({ costCents, updatedAt: new Date() })
        .where(
          and(
            eq(posOrderItems.organizationId, request.organizationId),
            eq(posOrderItems.unitId, request.unitId),
            eq(posOrderItems.id, orderItemId),
          ),
        );
      if (costCents !== null)
        await tx
          .insert(managementReportCostSnapshots)
          .values({
            organizationId: request.organizationId,
            unitId: request.unitId,
            orderItemId,
            costCents,
            source: "inventory_consumption",
            confidence: "exact",
            recordedByIdentityId: order.createdByIdentityId,
          })
          .onConflictDoUpdate({
            target: [
              managementReportCostSnapshots.organizationId,
              managementReportCostSnapshots.unitId,
              managementReportCostSnapshots.orderItemId,
            ],
            set: {
              backfillId: null,
              costCents,
              source: "inventory_consumption",
              confidence: "exact",
              recordedByIdentityId: order.createdByIdentityId,
              recordedAt: new Date(),
            },
          });
    }

    for (const balance of balancesById.values()) {
      if (balance.virtualMilli === balance.originalMilli) continue;
      const updated = await tx.execute<{ id: string }>(sql`
          update management_stock_balances
          set quantity = ${milliToQuantity(balance.virtualMilli)}::numeric,
              version = version + 1,
              updated_at = now()
          where id = ${balance.id}::uuid
            and version = ${balance.version}
            and organization_id = ${request.organizationId}::uuid
            and unit_id = ${request.unitId}::uuid
          returning id
        `);
      if (updated.length !== 1) {
        throw new InventoryConsumptionError("INVENTORY_BALANCE_UPDATE_CONFLICT");
      }
    }

    const uniqueWarnings = warnings.filter(
      (issue, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.code === issue.code &&
            candidate.inventoryItemId === issue.inventoryItemId &&
            candidate.componentId === issue.componentId,
        ) === index,
    );
    for (const issue of uniqueWarnings) {
      await recordIssue(tx, event, request, order.createdByIdentityId, issue);
    }
    const returnableMappings =
      productIds.length === 0
        ? []
        : await tx
            .select({
              containerInventoryItemId: managementProductReturnables.containerInventoryItemId,
              depositCents: managementProductReturnables.depositCents,
              id: managementProductReturnables.id,
              productId: managementProductReturnables.productId,
              quantityPerUnit: managementProductReturnables.quantityPerUnit,
            })
            .from(managementProductReturnables)
            .where(
              and(
                eq(managementProductReturnables.organizationId, request.organizationId),
                eq(managementProductReturnables.unitId, request.unitId),
                eq(managementProductReturnables.active, true),
                inArray(managementProductReturnables.productId, productIds),
              ),
            );
    const returnablesByProduct = new Map<string, typeof returnableMappings>();
    for (const mapping of returnableMappings) {
      returnablesByProduct.set(mapping.productId, [
        ...(returnablesByProduct.get(mapping.productId) ?? []),
        mapping,
      ]);
    }
    const [returnablePolicy] =
      returnableMappings.length === 0
        ? []
        : await tx
            .select({ defaultDueDays: managementReturnablePolicies.defaultDueDays })
            .from(managementReturnablePolicies)
            .where(
              and(
                eq(managementReturnablePolicies.organizationId, request.organizationId),
                eq(managementReturnablePolicies.unitId, request.unitId),
              ),
            )
            .limit(1);
    const defaultReturnableDueDays = returnablePolicy?.defaultDueDays ?? 7;
    for (const orderItem of orderItems) {
      const directPlan = plans.find(
        (plan) => plan.task.orderItemId === orderItem.id && plan.task.componentKind === "direct",
      );
      const custodySources = directPlan
        ? directPlan.allocations.map((allocation) => ({
            locationId: allocation.balance.locationId,
            soldQuantityMilli: allocation.quantityMilli,
          }))
        : [{ locationId: null, soldQuantityMilli: BigInt(orderItem.quantity) * 1_000n }];
      for (const mapping of returnablesByProduct.get(orderItem.productId) ?? []) {
        for (const source of custodySources) {
          const sourceId = deterministicUuid(
            `returnable-issue:${request.organizationId}:${request.unitId}:${request.orderId}:${orderItem.id}:${mapping.id}:${source.locationId ?? "unrouted"}`,
          );
          await tx
            .insert(managementReturnableCustodyMovements)
            .values({
              actorIdentityId: order.createdByIdentityId,
              containerInventoryItemId: mapping.containerInventoryItemId,
              context: {
                depositCents: mapping.depositCents,
                outboxEventId: event.id,
                tabId: request.tabId,
              },
              idempotencyKey: `returnable-issue:${sourceId}`,
              locationId: source.locationId,
              orderId: request.orderId,
              orderItemId: orderItem.id,
              responsibleIdentityId: order.responsibleIdentityId,
              counterpartyName: order.counterpartyName,
              dueAt:
                order.promisedAt ??
                new Date(order.sentAt.getTime() + defaultReturnableDueDays * 24 * 60 * 60_000),
              organizationId: request.organizationId,
              quantityDelta: milliToQuantity(
                (quantityToMilli(mapping.quantityPerUnit) * source.soldQuantityMilli) / 1_000n,
              ),
              sourceId,
              sourceType: RETURNABLE_ISSUE_SOURCE_TYPE,
              type: "issue",
              unitId: request.unitId,
            })
            .onConflictDoNothing();
        }
      }
    }
    const movementCount = plans.reduce((total, plan) => total + plan.allocations.length, 0);
    await tx
      .update(managementInventoryReservations)
      .set({
        status: "consumed",
        resolvedByIdentityId: order.createdByIdentityId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(managementInventoryReservations.organizationId, request.organizationId),
          eq(managementInventoryReservations.unitId, request.unitId),
          eq(managementInventoryReservations.sourceType, "order"),
          eq(managementInventoryReservations.sourceId, request.orderId),
          eq(managementInventoryReservations.status, "active"),
        ),
      );
    const [completion] = await tx
      .insert(auditEvents)
      .values({
        action: "management.inventory.order-consumed",
        actorIdentityId: order.createdByIdentityId,
        entityId: request.orderId,
        entityType: "order",
        id: completionAuditId,
        metadata: {
          componentCount: plans.length,
          movementCount,
          outboxEventId: event.id,
          recipePolicy: "version_effective_at_order_sent",
          recipeVersionIds: [
            ...new Set(
              plans
                .map((plan) => plan.task.recipeVersionId)
                .filter((id): id is string => Boolean(id)),
            ),
          ],
          unitConversionPolicy: "stock_unit_with_explicit_purchase_conversion",
          lotPolicy: "fefo_when_lots_are_available_then_legacy_balance",
        },
        organizationId: request.organizationId,
        unitId: request.unitId,
      })
      .onConflictDoNothing()
      .returning({ id: auditEvents.id });
    if (!completion) throw new InventoryConsumptionError("INVENTORY_COMPLETION_CONFLICT");
    return {
      issueCodes: [...new Set(uniqueWarnings.map((issue) => issue.code))],
      movementCount,
      retryRequired: false,
    };
  });
}

export async function reverseCanceledOrderItemInventory(
  database: Database,
  event: OrderSentOutboxEvent,
): Promise<InventoryReversalResult> {
  if (!UUID.test(event.id)) throw new InventoryConsumptionError("INVENTORY_CANCEL_EVENT_INVALID");
  const request = parseItemCanceledPayload(event.payload);
  if (event.aggregate_type !== "tab" || event.aggregate_id !== request.tabId) {
    throw new InventoryConsumptionError("INVENTORY_CANCEL_EVENT_SCOPE_INVALID");
  }

  return database.transaction(async (tx) => {
    const [item] = await tx
      .select({
        id: posOrderItems.id,
        orderId: posOrderItems.orderId,
        productId: posOrderItems.productId,
        status: posOrderItems.status,
      })
      .from(posOrderItems)
      .where(
        and(
          eq(posOrderItems.organizationId, request.organizationId),
          eq(posOrderItems.unitId, request.unitId),
          eq(posOrderItems.id, request.itemId),
        ),
      )
      .limit(1);
    if (item?.status !== "canceled") {
      throw new InventoryConsumptionError("INVENTORY_CANCEL_EVENT_SCOPE_INVALID");
    }
    const [order] = await tx
      .select({ sentAt: posOrders.sentAt, tabId: posOrders.tabId })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, request.organizationId),
          eq(posOrders.unitId, request.unitId),
          eq(posOrders.id, item.orderId),
        ),
      )
      .limit(1);
    if (!order || order.tabId !== request.tabId || !order.sentAt) {
      throw new InventoryConsumptionError("INVENTORY_CANCEL_EVENT_SCOPE_INVALID");
    }

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`inventory-order:${request.organizationId}:${request.unitId}:${item.orderId}`}))`,
    );
    const completionAuditId = deterministicUuid(
      `inventory-item-cancellation:${request.organizationId}:${request.unitId}:${request.itemId}`,
    );
    const [completed] = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.id, completionAuditId))
      .limit(1);
    if (completed) return { movementCount: 0 };

    const [directItems, recipeComponents] = await Promise.all([
      tx
        .select({ id: managementInventoryItems.id })
        .from(managementInventoryItems)
        .where(
          and(
            eq(managementInventoryItems.organizationId, request.organizationId),
            eq(managementInventoryItems.unitId, request.unitId),
            eq(managementInventoryItems.productId, item.productId),
          ),
        ),
      tx
        .select({ id: managementRecipeComponents.id })
        .from(managementRecipeVersions)
        .innerJoin(
          managementRecipeComponents,
          and(
            eq(managementRecipeComponents.organizationId, managementRecipeVersions.organizationId),
            eq(managementRecipeComponents.unitId, managementRecipeVersions.unitId),
            eq(managementRecipeComponents.recipeVersionId, managementRecipeVersions.id),
          ),
        )
        .where(
          and(
            eq(managementRecipeVersions.organizationId, request.organizationId),
            eq(managementRecipeVersions.unitId, request.unitId),
            eq(managementRecipeVersions.productId, item.productId),
            lte(managementRecipeVersions.validFrom, order.sentAt),
            or(
              isNull(managementRecipeVersions.validUntil),
              gt(managementRecipeVersions.validUntil, order.sentAt),
            ),
          ),
        ),
    ]);
    const sourceIds = [
      ...directItems.map(({ id }) =>
        deterministicUuid(
          `inventory-direct:${request.organizationId}:${request.unitId}:${item.orderId}:${item.id}:${id}`,
        ),
      ),
      ...recipeComponents.map(({ id }) =>
        deterministicUuid(
          `inventory-recipe:${request.organizationId}:${request.unitId}:${item.orderId}:${item.id}:${id}`,
        ),
      ),
    ];
    const consumed =
      sourceIds.length === 0
        ? []
        : await tx
            .select()
            .from(managementInventoryMovements)
            .where(
              and(
                eq(managementInventoryMovements.organizationId, request.organizationId),
                eq(managementInventoryMovements.unitId, request.unitId),
                inArray(managementInventoryMovements.sourceType, [
                  DIRECT_SOURCE_TYPE,
                  RECIPE_SOURCE_TYPE,
                ]),
                inArray(managementInventoryMovements.sourceId, sourceIds),
              ),
            );

    let movementCount = 0;
    for (const movement of consumed) {
      const restoredQuantity = milliToQuantity(-quantityToMilli(movement.quantityDelta));
      const reversalSourceId = deterministicUuid(`inventory-cancel:${movement.id}`);
      const [reversal] = await tx
        .insert(managementInventoryMovements)
        .values({
          actorIdentityId: null,
          inventoryItemId: movement.inventoryItemId,
          lotId: movement.lotId,
          locationId: movement.locationId,
          organizationId: request.organizationId,
          quantityDelta: restoredQuantity,
          sourceId: reversalSourceId,
          sourceType: CANCELLATION_SOURCE_TYPE,
          type: "order_cancellation",
          unitCostCents: movement.unitCostCents,
          unitId: request.unitId,
        })
        .onConflictDoNothing()
        .returning({ id: managementInventoryMovements.id });
      if (!reversal) continue;
      const restored = await tx
        .update(managementStockBalances)
        .set({
          quantity: sql`${managementStockBalances.quantity} + ${restoredQuantity}::numeric`,
          version: sql`${managementStockBalances.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(managementStockBalances.organizationId, request.organizationId),
            eq(managementStockBalances.unitId, request.unitId),
            eq(managementStockBalances.locationId, movement.locationId),
            eq(managementStockBalances.inventoryItemId, movement.inventoryItemId),
          ),
        )
        .returning({ id: managementStockBalances.id });
      if (restored.length !== 1) {
        throw new InventoryConsumptionError("INVENTORY_BALANCE_UPDATE_CONFLICT");
      }
      if (movement.lotId) {
        await tx
          .update(managementInventoryLots)
          .set({
            quantity: sql`${managementInventoryLots.quantity} + ${restoredQuantity}::numeric`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(managementInventoryLots.organizationId, request.organizationId),
              eq(managementInventoryLots.unitId, request.unitId),
              eq(managementInventoryLots.id, movement.lotId),
            ),
          );
      }
      movementCount += 1;
    }

    const issuedReturnables = await tx
      .select({ id: managementReturnableCustodyMovements.id })
      .from(managementReturnableCustodyMovements)
      .where(
        and(
          eq(managementReturnableCustodyMovements.organizationId, request.organizationId),
          eq(managementReturnableCustodyMovements.unitId, request.unitId),
          eq(managementReturnableCustodyMovements.orderItemId, request.itemId),
          eq(managementReturnableCustodyMovements.sourceType, RETURNABLE_ISSUE_SOURCE_TYPE),
        ),
      );
    for (const { id: issuedId } of issuedReturnables) {
      await tx.execute(
        sql`select id from management_returnable_custody_movements where organization_id=${request.organizationId}::uuid and unit_id=${request.unitId}::uuid and id=${issuedId}::uuid for update`,
      );
      const [issued] = await tx
        .select()
        .from(managementReturnableCustodyMovements)
        .where(
          and(
            eq(managementReturnableCustodyMovements.organizationId, request.organizationId),
            eq(managementReturnableCustodyMovements.unitId, request.unitId),
            eq(managementReturnableCustodyMovements.id, issuedId),
            eq(managementReturnableCustodyMovements.type, "issue"),
          ),
        )
        .limit(1);
      if (!issued) continue;
      const [children] = await tx
        .select({
          quantityDelta: sql<string>`coalesce(sum(${managementReturnableCustodyMovements.quantityDelta}), 0)`,
        })
        .from(managementReturnableCustodyMovements)
        .where(
          and(
            eq(managementReturnableCustodyMovements.organizationId, request.organizationId),
            eq(managementReturnableCustodyMovements.unitId, request.unitId),
            eq(managementReturnableCustodyMovements.parentMovementId, issued.id),
          ),
        );
      const openMilli =
        quantityToMilli(issued.quantityDelta) + quantityToMilli(children?.quantityDelta ?? "0");
      if (openMilli <= 0n) continue;
      const sourceId = deterministicUuid(`returnable-cancel:${issued.id}`);
      await tx
        .insert(managementReturnableCustodyMovements)
        .values({
          actorIdentityId: issued.actorIdentityId,
          containerInventoryItemId: issued.containerInventoryItemId,
          context: {
            approvalId: request.approvalId,
            canceledCustodyMovementId: issued.id,
            outboxEventId: event.id,
            reason: request.reason,
            tabId: request.tabId,
          },
          idempotencyKey: `returnable-cancel:${sourceId}`,
          locationId: issued.locationId,
          orderId: item.orderId,
          orderItemId: item.id,
          parentMovementId: issued.id,
          responsibleIdentityId: issued.responsibleIdentityId,
          counterpartyName: issued.counterpartyName,
          dueAt: issued.dueAt,
          organizationId: request.organizationId,
          quantityDelta: milliToQuantity(-openMilli),
          sourceId,
          sourceType: RETURNABLE_CANCEL_SOURCE_TYPE,
          type: "correction",
          unitId: request.unitId,
        })
        .onConflictDoNothing();
    }

    await tx.insert(auditEvents).values({
      action: "management.inventory.order-item-restored",
      actorIdentityId: null,
      entityId: request.itemId,
      entityType: "order_item",
      id: completionAuditId,
      metadata: {
        approvalId: request.approvalId,
        movementCount,
        outboxEventId: event.id,
        reason: request.reason,
      },
      organizationId: request.organizationId,
      unitId: request.unitId,
    });
    return { movementCount };
  });
}
