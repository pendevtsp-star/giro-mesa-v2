import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  managementInventoryItems,
  managementInventoryMovements,
  managementRecipeComponents,
  managementRecipeVersions,
  outboxEvents,
  posOrderItems,
  posOrders,
} from "@giromesa/db";
import {
  applyYield,
  convertQuantity,
  formatQuantity,
  parseQuantity,
  type QuantityUnit,
} from "@giromesa/domain";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_SENT_KEYS = new Set(["orderId", "organizationId", "tabId", "ticketIds", "unitId"]);
const RECIPE_SOURCE_TYPE = "pos_order_recipe_component";
const DIRECT_SOURCE_TYPE = "pos_order_direct_item";

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

interface InventoryItem {
  active: boolean;
  allowNegative: boolean;
  id: string;
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
  version: number;
}

interface BalanceState extends LockedBalance {
  originalMilli: bigint;
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
    | "INVENTORY_STOCK_NEGATIVE_ALLOWED";
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

function deterministicUuid(value: string) {
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

function quantityToMicros(quantity: string) {
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(quantity)) {
    throw new InventoryConsumptionError("INVENTORY_QUANTITY_INVALID");
  }
  const negative = quantity.startsWith("-");
  const unsigned = negative ? quantity.slice(1) : quantity;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return negative ? -micros : micros;
}

function microsToQuantity(micros: bigint) {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  return `${negative ? "-" : ""}${absolute / 1_000_000n}.${String(absolute % 1_000_000n).padStart(6, "0")}`;
}

function divideUp(numerator: bigint, denominator: bigint) {
  if (numerator <= 0n || denominator <= 0n) {
    throw new InventoryConsumptionError("INVENTORY_RECIPE_QUANTITY_INVALID");
  }
  return (numerator + denominator - 1n) / denominator;
}

export function recipeBatchConsumptionQuantity(input: {
  componentQuantity: string;
  componentUnit: QuantityUnit;
  inventoryUnit: QuantityUnit;
  orderQuantity: number;
  yieldQuantity: string;
  yieldUnit: QuantityUnit;
  lossBasisPoints: number;
}) {
  if (input.yieldUnit !== "unit" && input.yieldUnit !== "dozen") {
    throw new InventoryConsumptionError("INVENTORY_RECIPE_YIELD_UNIT_INVALID");
  }
  if (
    !Number.isSafeInteger(input.orderQuantity) ||
    input.orderQuantity <= 0 ||
    !Number.isSafeInteger(input.lossBasisPoints) ||
    input.lossBasisPoints < 0 ||
    input.lossBasisPoints >= 10_000
  ) {
    throw new InventoryConsumptionError("INVENTORY_RECIPE_QUANTITY_INVALID");
  }
  try {
    const component = parseQuantity(input.componentQuantity, input.componentUnit);
    const declaredYield = parseQuantity(input.yieldQuantity, input.yieldUnit);
    const yieldInUnits = convertQuantity(declaredYield, "unit", "exact");
    if (component.atoms <= 0n || yieldInUnits.atoms <= 0n) {
      throw new InventoryConsumptionError("INVENTORY_RECIPE_QUANTITY_INVALID");
    }
    const batchScaled = divideUp(
      component.atoms * BigInt(input.orderQuantity) * 1_000_000n,
      yieldInUnits.atoms,
    );
    const withLoss = divideUp(batchScaled * 10_000n, BigInt(10_000 - input.lossBasisPoints));
    const converted = convertQuantity({ ...component, atoms: withLoss }, input.inventoryUnit, "up");
    return {
      quantity: formatQuantity(converted),
      unit: converted.unit,
      dimension: converted.dimension,
    };
  } catch (error) {
    if (error instanceof InventoryConsumptionError) throw error;
    throw new InventoryConsumptionError("INVENTORY_RECIPE_QUANTITY_INVALID");
  }
}

export function recipeConsumptionQuantity(
  quantity: string,
  unit: QuantityUnit,
  orderQuantity: number,
  yieldBasisPoints: number,
) {
  if (!Number.isSafeInteger(orderQuantity) || orderQuantity <= 0) {
    throw new InventoryConsumptionError("INVENTORY_RECIPE_QUANTITY_INVALID");
  }
  const component = parseQuantity(quantity, unit);
  if (component.atoms <= 0n) {
    throw new InventoryConsumptionError("INVENTORY_RECIPE_QUANTITY_INVALID");
  }
  const required = applyYield(
    { ...component, atoms: component.atoms * BigInt(orderQuantity) },
    yieldBasisPoints,
  );
  return { quantity: formatQuantity(required), unit: required.unit, dimension: required.dimension };
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
  await tx
    .insert(outboxEvents)
    .values({
      id: issueId,
      organizationId: request.organizationId,
      unitId: request.unitId,
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
    .onConflictDoNothing();
  await tx
    .insert(auditEvents)
    .values({
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
    })
    .onConflictDoNothing();
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
      })
      .from(posOrders)
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
    const orderItems = await tx
      .select({
        id: posOrderItems.id,
        productId: posOrderItems.productId,
        quantity: posOrderItems.quantity,
      })
      .from(posOrderItems)
      .where(
        and(
          eq(posOrderItems.organizationId, request.organizationId),
          eq(posOrderItems.unitId, request.unitId),
          eq(posOrderItems.orderId, request.orderId),
        ),
      );
    if (orderItems.length === 0) {
      throw new InventoryConsumptionError("INVENTORY_ORDER_ITEMS_MISSING");
    }

    const productIds = [...new Set(orderItems.map((item) => item.productId))];
    const [components, inventoryRows] = await Promise.all([
      tx
        .select({
          id: managementRecipeComponents.id,
          inventoryItemId: managementRecipeComponents.inventoryItemId,
          locationId: managementRecipeComponents.locationId,
          lossBasisPoints: managementRecipeComponents.lossBasisPoints,
          productId: managementRecipeVersions.productId,
          quantityMicros: managementRecipeComponents.quantityMicros,
          componentUnit: managementRecipeComponents.unit,
          recipeVersionId: managementRecipeVersions.id,
          recipeVersion: managementRecipeVersions.version,
          yieldQuantity: managementRecipeVersions.yieldQuantity,
          yieldUnit: managementRecipeVersions.yieldUnit,
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
      if (item.active && item.productId) {
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
        const sourceId = deterministicUuid(
          `inventory-direct:${request.organizationId}:${request.unitId}:${request.orderId}:${orderItem.id}:${inventoryItem.id}`,
        );
        tasks.push({
          componentId: inventoryItem.id,
          componentKind: "direct",
          inventoryItem,
          locationId: null,
          orderItemId: orderItem.id,
          productId: orderItem.productId,
          requiredMilli: BigInt(orderItem.quantity) * 1_000_000n,
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
          const consumption = recipeBatchConsumptionQuantity({
            componentQuantity: microsToQuantity(component.quantityMicros),
            componentUnit: component.componentUnit as QuantityUnit,
            inventoryUnit: inventoryItem.unit as QuantityUnit,
            orderQuantity: orderItem.quantity,
            yieldQuantity: component.yieldQuantity,
            yieldUnit: component.yieldUnit as QuantityUnit,
            lossBasisPoints: component.lossBasisPoints,
          });
          requiredMilli = quantityToMicros(consumption.quantity);
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
            originalMilli: quantityToMicros(row.quantity),
            virtualMilli: quantityToMicros(row.quantity),
          };
          balancesById.set(row.id, state);
          return state;
        });
        balanceStates.set(taskBalanceKey, balances);
      }
      if (balances.length === 0) {
        blockingIssues.push({
          code: "INVENTORY_STOCK_BALANCE_MISSING",
          componentId: task.componentId,
          inventoryItemId: task.inventoryItem.id,
          orderItemId: task.orderItemId,
          policy: "block_and_retry",
          requiredQuantity: microsToQuantity(task.requiredMilli),
          unit: task.inventoryItem.unit,
        });
        continue;
      }

      const availableMilli = balances.reduce(
        (total, balance) => total + (balance.virtualMilli > 0n ? balance.virtualMilli : 0n),
        0n,
      );
      if (!task.inventoryItem.allowNegative && availableMilli < task.requiredMilli) {
        blockingIssues.push({
          code: "INVENTORY_STOCK_INSUFFICIENT",
          componentId: task.componentId,
          currentQuantity: microsToQuantity(availableMilli),
          inventoryItemId: task.inventoryItem.id,
          orderItemId: task.orderItemId,
          policy: "block_and_retry",
          requiredQuantity: microsToQuantity(task.requiredMilli),
          unit: task.inventoryItem.unit,
        });
        continue;
      }

      let remainingMilli = task.requiredMilli;
      const allocations: Allocation[] = [];
      for (const balance of balances) {
        const available = balance.virtualMilli > 0n ? balance.virtualMilli : 0n;
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
          currentQuantity: microsToQuantity(availableMilli),
          inventoryItemId: task.inventoryItem.id,
          orderItemId: task.orderItemId,
          policy: "deduct_and_alert",
          requiredQuantity: microsToQuantity(task.requiredMilli),
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
        const [movement] = await tx
          .insert(managementInventoryMovements)
          .values({
            actorIdentityId: order.createdByIdentityId,
            inventoryItemId: plan.task.inventoryItem.id,
            locationId: allocation.balance.locationId,
            organizationId: request.organizationId,
            quantityDelta: microsToQuantity(-allocation.quantityMilli),
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
      if (resultingMilli < quantityToMicros(plan.task.inventoryItem.minimumQuantity)) {
        warnings.push({
          code: "INVENTORY_STOCK_LOW",
          componentId: plan.task.componentId,
          currentQuantity: microsToQuantity(resultingMilli),
          inventoryItemId: plan.task.inventoryItem.id,
          orderItemId: plan.task.orderItemId,
          policy: "notify_only",
          unit: plan.task.inventoryItem.unit,
        });
      }
    }

    for (const balance of balancesById.values()) {
      if (balance.virtualMilli === balance.originalMilli) continue;
      const updated = await tx.execute<{ id: string }>(sql`
          update management_stock_balances
          set quantity = ${microsToQuantity(balance.virtualMilli)}::numeric,
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
    const movementCount = plans.reduce((total, plan) => total + plan.allocations.length, 0);
    await tx
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
          unitConversionPolicy: "dimension_safe_fixed_precision_explicit_conversion",
        },
        organizationId: request.organizationId,
        unitId: request.unitId,
      })
      .onConflictDoNothing();
    return {
      issueCodes: [...new Set(uniqueWarnings.map((issue) => issue.code))],
      movementCount,
      retryRequired: false,
    };
  });
}
