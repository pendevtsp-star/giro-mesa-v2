import {
  assertNever,
  decidePilotConflict,
  isPilotCommandType,
  type PilotConflictDecision,
  type PilotResourceState,
} from "@giromesa/domain";
import { ConflictException, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { DatabaseService } from "../database/database.module.js";
import { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
import { PilotResourceConflict } from "../pilot-operations/pilot-resource-boundary.js";
import {
  approvalSchema,
  discountSchema,
  kdsStateSchema,
  mergeTabsSchema,
  openTabSchema,
  orderSchema,
  serviceChargeSchema,
  splitTabSchema,
  tipSchema,
  transferTabSchema,
} from "../pilot-operations/pilot-schemas.js";
import { verifyPriceReference } from "./price-reference.js";
import { stableOperationalId } from "./stable-operational-id.js";
import type { NormalizedSyncEventInput, SyncEventInput } from "./sync.schemas.js";

const pilotEnvelopeSchema = z
  .object({
    kind: z.literal("pilot.mutation"),
    action: z.enum([
      "open-tab",
      "create-order",
      "send-order",
      "transfer-tab",
      "merge-tabs",
      "split-tab",
      "service-charge",
      "tip",
      "discount-item",
      "cancel-item",
      "transition-kds",
    ]),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

const openTabDataSchema = z.object({ body: openTabSchema }).strict();
const createOrderDataSchema = z.object({ tabId: z.uuid(), body: orderSchema }).strict();
const sendOrderDataSchema = z.object({ orderId: z.uuid() }).strict();
const transferTabDataSchema = z.object({ tabId: z.uuid(), body: transferTabSchema }).strict();
const mergeTabsDataSchema = z.object({ body: mergeTabsSchema }).strict();
const splitTabDataSchema = z.object({ tabId: z.uuid(), body: splitTabSchema }).strict();
const serviceChargeDataSchema = z
  .object({ tabId: z.uuid(), basisPoints: serviceChargeSchema.shape.basisPoints })
  .strict();
const tipDataSchema = z.object({ tabId: z.uuid(), tipCents: tipSchema.shape.tipCents }).strict();
const discountItemDataSchema = z.object({ itemId: z.uuid(), body: discountSchema }).strict();
const cancelItemDataSchema = z.object({ itemId: z.uuid(), approval: approvalSchema }).strict();
const transitionKdsDataSchema = z
  .object({ ticketId: z.uuid(), state: kdsStateSchema.shape.state })
  .strict();

const eventTypeByAction = {
  "open-tab": "pos.tab.open_requested",
  "create-order": "pos.order.create_requested",
  "send-order": "pos.order.send_requested",
  "transfer-tab": "pos.tab.transfer_requested",
  "merge-tabs": "pos.tabs.merge_requested",
  "split-tab": "pos.tab.split_requested",
  "service-charge": "pos.tab.service_charge_requested",
  tip: "pos.tab.tip_requested",
  "discount-item": "pos.item.discount_requested",
  "cancel-item": "pos.item.cancel_requested",
  "transition-kds": "pos.kds.transition_requested",
} as const;

type PilotAction = keyof typeof eventTypeByAction;
type ResourceLookup = Readonly<{
  kind: "tab" | "order" | "item" | "ticket";
  entityId: string;
  expectedTabId: string;
}>;
type PilotResource = Readonly<{
  id: string;
  occupancyEpoch: string;
  resourceVersion: number;
  status: string;
}>;

export class PilotConflictException extends ConflictException {
  constructor(readonly decision: PilotConflictDecision) {
    super({ code: decision.code, outcome: decision.outcome });
  }
}

@Injectable()
export class SyncPilotService {
  constructor(
    private readonly pilot: PilotPosService,
    private readonly database: DatabaseService,
  ) {}

  async apply(
    event: NormalizedSyncEventInput | SyncEventInput,
    scope: { organizationId: string; unitId: string },
  ): Promise<Record<string, unknown> | null> {
    if (event.payload.kind !== "pilot.mutation") return null;
    if (!isPilotCommandType(event.type)) {
      throw new PilotConflictException({
        outcome: "reject",
        code: "UNSUPPORTED_PILOT_COMMAND",
      });
    }
    const commandType = event.type;
    const envelope = pilotEnvelopeSchema.parse(event.payload);
    if (eventTypeByAction[envelope.action] !== event.type) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["type"],
          message: "Event type does not match pilot action.",
          input: event.type,
        },
      ]);
    }
    const lookup = this.resourceLookup(envelope.action, envelope.data, event.id);
    const ordered = "aggregate" in event && event.aggregate.type !== "legacy.operational_command";
    if (ordered) {
      const primary = event.resourcePreconditions.find(
        (resource) => resource.type === event.aggregate.type && resource.id === event.aggregate.id,
      );
      if (
        event.aggregate.type !== "tab" ||
        !primary ||
        primary.occupancyEpoch !== event.occupancyEpoch ||
        primary.resourceVersion !== event.resourceVersion
      )
        throw new PilotConflictException({
          outcome: "reject",
          code: "AGGREGATE_SCOPE_MISMATCH",
        });
    } else {
      const resource = await this.readResource(lookup, scope);
      const resourceState: PilotResourceState = !resource
        ? "missing"
        : resource.status === "open"
          ? "active"
          : "terminal";
      const conflict = decidePilotConflict({
        commandType,
        delivery: "new",
        protocol: "legacy",
        commandEpoch: null,
        currentEpoch: resource?.occupancyEpoch ?? null,
        commandVersion: null,
        currentVersion: resource?.resourceVersion ?? null,
        resourceState,
      });
      if (conflict.outcome !== "apply") throw new PilotConflictException(conflict);
    }

    switch (envelope.action) {
      case "open-tab": {
        const { body } = openTabDataSchema.parse(envelope.data);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.openTab(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            event.idempotencyKey,
            body,
            { tabId: event.id },
          ),
        );
      }
      case "create-order": {
        const { tabId, body } = createOrderDataSchema.parse(envelope.data);
        const authoritativePrices = this.authoritativePrices(event, body, scope);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.createOrder(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            tabId,
            event.idempotencyKey,
            body,
            {
              orderId: event.id,
              itemIds: body.items.map((_, index) =>
                stableOperationalId(event.id, "order-item", String(index)),
              ),
              modifierIdForOption: (itemId, optionId) =>
                stableOperationalId(event.id, "order-modifier", `${itemId}:${optionId}`),
            },
            authoritativePrices,
          ),
        );
      }
      case "send-order": {
        const { orderId } = sendOrderDataSchema.parse(envelope.data);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.sendOrder(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            orderId,
            event.idempotencyKey,
            {
              ticketIdForStation: (stationId) =>
                stableOperationalId(event.id, "kds-ticket", stationId),
            },
          ),
        );
      }
      case "transfer-tab": {
        const { tabId, body } = transferTabDataSchema.parse(envelope.data);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.transferTab(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            tabId,
            event.idempotencyKey,
            body,
          ),
        );
      }
      case "merge-tabs": {
        const { body } = mergeTabsDataSchema.parse(envelope.data);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.mergeTabs(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            event.idempotencyKey,
            body,
          ),
        );
      }
      case "split-tab": {
        const { tabId, body } = splitTabDataSchema.parse(envelope.data);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.splitTab(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            tabId,
            event.idempotencyKey,
            body,
            {
              targetTabId: event.id,
              targetOrderId: stableOperationalId(event.id, "split-order", ""),
              movedItemIdForSource: (sourceItemId) =>
                stableOperationalId(event.id, "split-item", sourceItemId),
              movedModifierIdForSource: (sourceItemId, modifierId) =>
                stableOperationalId(event.id, "split-modifier", `${sourceItemId}:${modifierId}`),
            },
          ),
        );
      }
      case "service-charge": {
        const { tabId, basisPoints } = serviceChargeDataSchema.parse(envelope.data);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.setServiceCharge(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            tabId,
            event.idempotencyKey,
            { basisPoints },
          ),
        );
      }
      case "tip": {
        const { tabId, tipCents } = tipDataSchema.parse(envelope.data);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.setTip(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            tabId,
            event.idempotencyKey,
            { tipCents },
          ),
        );
      }
      case "discount-item": {
        const { itemId, body } = discountItemDataSchema.parse(envelope.data);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.discountItem(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            itemId,
            event.idempotencyKey,
            body,
            { approvalId: stableOperationalId(event.id, "approval", "") },
          ),
        );
      }
      case "cancel-item": {
        const { itemId, approval } = cancelItemDataSchema.parse(envelope.data);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.cancelItem(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            itemId,
            event.idempotencyKey,
            { approval },
            { approvalId: stableOperationalId(event.id, "approval", "") },
          ),
        );
      }
      case "transition-kds": {
        const { ticketId, state } = transitionKdsDataSchema.parse(envelope.data);
        return this.applyWithBoundary(event, commandType, () =>
          this.pilot.transitionKds(
            event.actorId,
            scope.organizationId,
            scope.unitId,
            ticketId,
            event.idempotencyKey,
            { state },
          ),
        );
      }
    }
  }

  private resourceLookup(
    action: PilotAction,
    data: Record<string, unknown>,
    commandId: string,
  ): ResourceLookup {
    switch (action) {
      case "open-tab":
        return { kind: "tab", entityId: commandId, expectedTabId: commandId };
      case "create-order":
        return this.tabLookup(createOrderDataSchema.parse(data).tabId);
      case "transfer-tab":
        return this.tabLookup(transferTabDataSchema.parse(data).tabId);
      case "merge-tabs":
        return this.tabLookup(mergeTabsDataSchema.parse(data).body.targetTabId);
      case "split-tab":
        return this.tabLookup(splitTabDataSchema.parse(data).tabId);
      case "service-charge":
        return this.tabLookup(serviceChargeDataSchema.parse(data).tabId);
      case "tip":
        return this.tabLookup(tipDataSchema.parse(data).tabId);
      case "send-order": {
        const orderId = sendOrderDataSchema.parse(data).orderId;
        return { kind: "order", entityId: orderId, expectedTabId: orderId };
      }
      case "discount-item": {
        const itemId = discountItemDataSchema.parse(data).itemId;
        return { kind: "item", entityId: itemId, expectedTabId: itemId };
      }
      case "cancel-item": {
        const itemId = cancelItemDataSchema.parse(data).itemId;
        return { kind: "item", entityId: itemId, expectedTabId: itemId };
      }
      case "transition-kds": {
        const ticketId = transitionKdsDataSchema.parse(data).ticketId;
        return { kind: "ticket", entityId: ticketId, expectedTabId: ticketId };
      }
      default:
        return assertNever(action);
    }
  }

  private tabLookup(tabId: string): ResourceLookup {
    return { kind: "tab", entityId: tabId, expectedTabId: tabId };
  }

  private async readResource(
    lookup: ResourceLookup,
    scope: { organizationId: string; unitId: string },
  ): Promise<PilotResource | null> {
    type Row = {
      id: string;
      occupancy_epoch: string;
      resource_version: number;
      status: string;
    };
    let rows: Iterable<Row>;
    switch (lookup.kind) {
      case "tab":
        rows = await this.database.db.execute<Row>(sql`
          select tab.id, tab.occupancy_epoch, tab.resource_version, tab.status
          from pos_tabs tab
          where tab.organization_id = ${scope.organizationId}
            and tab.unit_id = ${scope.unitId}
            and tab.id = ${lookup.entityId}
        `);
        break;
      case "order":
        rows = await this.database.db.execute<Row>(sql`
          select tab.id, tab.occupancy_epoch, tab.resource_version, tab.status
          from pos_orders ord
          join pos_tabs tab on tab.id = ord.tab_id
            and tab.organization_id = ord.organization_id and tab.unit_id = ord.unit_id
          where ord.organization_id = ${scope.organizationId}
            and ord.unit_id = ${scope.unitId}
            and ord.id = ${lookup.entityId}
        `);
        break;
      case "item":
        rows = await this.database.db.execute<Row>(sql`
          select tab.id, tab.occupancy_epoch, tab.resource_version, tab.status
          from pos_order_items item
          join pos_orders ord on ord.id = item.order_id
            and ord.organization_id = item.organization_id and ord.unit_id = item.unit_id
          join pos_tabs tab on tab.id = ord.tab_id
            and tab.organization_id = ord.organization_id and tab.unit_id = ord.unit_id
          where item.organization_id = ${scope.organizationId}
            and item.unit_id = ${scope.unitId}
            and item.id = ${lookup.entityId}
        `);
        break;
      case "ticket":
        rows = await this.database.db.execute<Row>(sql`
          select tab.id, tab.occupancy_epoch, tab.resource_version, tab.status
          from pos_kds_tickets ticket
          join pos_orders ord on ord.id = ticket.order_id
            and ord.organization_id = ticket.organization_id and ord.unit_id = ticket.unit_id
          join pos_tabs tab on tab.id = ord.tab_id
            and tab.organization_id = ord.organization_id and tab.unit_id = ord.unit_id
          where ticket.organization_id = ${scope.organizationId}
            and ticket.unit_id = ${scope.unitId}
            and ticket.id = ${lookup.entityId}
        `);
        break;
      default:
        return assertNever(lookup.kind);
    }
    const [row] = [...rows];
    return row
      ? {
          id: row.id,
          occupancyEpoch: row.occupancy_epoch,
          resourceVersion: row.resource_version,
          status: row.status,
        }
      : null;
  }

  private async applyWithBoundary(
    event: NormalizedSyncEventInput | SyncEventInput,
    commandType: Parameters<PilotPosService["withSyncPreconditions"]>[0],
    effect: () => Promise<Record<string, unknown>>,
  ) {
    const ordered = "aggregate" in event && event.aggregate.type !== "legacy.operational_command";
    try {
      return ordered
        ? await this.pilot.withSyncPreconditions(commandType, event.resourcePreconditions, effect)
        : await effect();
    } catch (error) {
      if (error instanceof PilotResourceConflict) {
        throw new PilotConflictException({ outcome: error.outcome, code: error.code });
      }
      throw error;
    }
  }

  private authoritativePrices(
    event: NormalizedSyncEventInput | SyncEventInput,
    body: z.infer<typeof orderSchema>,
    scope: { organizationId: string; unitId: string },
  ) {
    if (!("aggregate" in event) || event.aggregate.type === "legacy.operational_command") {
      throw new PilotConflictException({ outcome: "reject", code: "PRICE_REFERENCE_REQUIRED" });
    }
    const references = new Map(
      event.priceReferences.map((reference) => [
        `${reference.kind}:${reference.entityId}`,
        reference,
      ]),
    );
    const products = new Map<string, number>();
    const modifierOptions = new Map<string, number>();
    try {
      for (const item of body.items) {
        const productReference = references.get(`product:${item.productId}`);
        if (!productReference) throw new Error("PRICE_REFERENCE_REQUIRED");
        products.set(
          item.productId,
          verifyPriceReference(productReference.token, {
            kind: "product",
            entityId: item.productId,
            ...scope,
          }),
        );
        for (const optionId of item.modifierOptionIds) {
          const optionReference = references.get(`modifier-option:${optionId}`);
          if (!optionReference) throw new Error("PRICE_REFERENCE_REQUIRED");
          modifierOptions.set(
            optionId,
            verifyPriceReference(optionReference.token, {
              kind: "modifier-option",
              entityId: optionId,
              ...scope,
            }),
          );
        }
      }
    } catch {
      throw new PilotConflictException({ outcome: "reject", code: "PRICE_REFERENCE_INVALID" });
    }
    return { products, modifierOptions };
  }
}
