import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
import {
  approvalSchema,
  detachTableGroupSchema,
  discountSchema,
  kdsAttentionAcknowledgeSchema,
  kdsBlockSchema,
  kdsCourseStateSchema,
  kdsItemStateSchema,
  kdsOrderHandoffSchema,
  kdsPrioritySchema,
  kdsProductAvailabilitySchema,
  kdsRecallSchema,
  kdsRefireSchema,
  kdsStateSchema,
  kdsUnblockSchema,
  mergeTabsSchema,
  moveItemsSchema,
  openTabSchema,
  orderSchema,
  paymentSchema,
  serviceChargeSchema,
  splitTabSchema,
  tableGroupSchema,
  tipSchema,
  transferTabSchema,
} from "../pilot-operations/pilot-schemas.js";
import { stableOperationalId } from "./stable-operational-id.js";
import type { SyncEventInput } from "./sync.schemas.js";

const pilotEnvelopeSchema = z
  .object({
    kind: z.literal("pilot.mutation"),
    action: z.enum([
      "open-tab",
      "create-order",
      "move-items",
      "record-payment",
      "notify-ready",
      "acknowledge-call",
      "resolve-call",
      "send-order",
      "transfer-tab",
      "merge-tabs",
      "group-tables",
      "detach-table-group",
      "dissolve-table-group",
      "split-tab",
      "service-charge",
      "tip",
      "discount-item",
      "cancel-item",
      "transition-kds",
      "transition-kds-item",
      "refire-kds-item",
      "recall-kds",
      "set-kds-priority",
      "set-kds-course-state",
      "handoff-kds-order",
      "set-kds-product-availability",
      "block-kds-item",
      "unblock-kds-item",
      "acknowledge-kds-critical-note",
    ]),
    data: z.record(z.string(), z.unknown()),
    delivery: z.enum(["cloud-only", "edge-capable"]).optional(),
  })
  .strict();

const openTabDataSchema = z.object({ body: openTabSchema }).strict();
const createOrderDataSchema = z.object({ tabId: z.uuid(), body: orderSchema }).strict();
const moveItemsDataSchema = z.object({ tabId: z.uuid(), body: moveItemsSchema }).strict();
const recordPaymentDataSchema = z.object({ tabId: z.uuid(), body: paymentSchema }).strict();
const notifyReadyDataSchema = z.object({ tabId: z.uuid() }).strict();
const transitionCallDataSchema = z.object({ callId: z.uuid() }).strict();
const sendOrderDataSchema = z.object({ orderId: z.uuid() }).strict();
const transferTabDataSchema = z.object({ tabId: z.uuid(), body: transferTabSchema }).strict();
function normalizeLegacyReorganizationData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const data = value as Record<string, unknown>;
  if (!data.body || typeof data.body !== "object" || Array.isArray(data.body)) return value;
  const body = data.body as Record<string, unknown>;
  if (body.reasonCode || typeof body.reason !== "string") return value;
  const { reason, ...rest } = body;
  return { ...data, body: { ...rest, reasonCode: "other", reasonNote: reason } };
}
const mergeTabsDataSchema = z.preprocess(
  normalizeLegacyReorganizationData,
  z.object({ body: mergeTabsSchema }).strict(),
);
const groupTablesDataSchema = z.preprocess(
  normalizeLegacyReorganizationData,
  z.object({ body: tableGroupSchema }).strict(),
);
const detachTableGroupDataSchema = z
  .object({ groupId: z.uuid(), body: detachTableGroupSchema })
  .strict();
const dissolveTableGroupDataSchema = z.object({ groupId: z.uuid() }).strict();
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
const transitionKdsItemDataSchema = z.discriminatedUnion("state", [
  z.object({ ticketId: z.uuid(), itemId: z.uuid(), state: z.literal("preparing") }).strict(),
  z
    .object({
      ticketId: z.uuid(),
      itemId: z.uuid(),
      state: z.literal("ready"),
      quantity: kdsItemStateSchema.options[1].shape.quantity,
    })
    .strict(),
]);
const refireKdsItemDataSchema = z
  .object({ ticketId: z.uuid(), itemId: z.uuid(), reason: kdsRefireSchema.shape.reason })
  .strict();
const recallKdsDataSchema = z
  .object({ ticketId: z.uuid(), reason: kdsRecallSchema.shape.reason })
  .strict();
const priorityKdsDataSchema = z
  .object({
    ticketId: z.uuid(),
    priority: kdsPrioritySchema.shape.priority,
    reason: kdsPrioritySchema.shape.reason,
  })
  .strict();
const courseKdsDataSchema = z
  .object({
    ticketId: z.uuid(),
    course: kdsCourseStateSchema.shape.course,
    state: kdsCourseStateSchema.shape.state,
  })
  .strict();
const handoffKdsDataSchema = z
  .object({
    orderId: z.uuid(),
    target: kdsOrderHandoffSchema.shape.target,
    reason: kdsOrderHandoffSchema.shape.reason,
  })
  .strict();
const availabilityKdsDataSchema = z
  .object({
    productId: z.uuid(),
    available: kdsProductAvailabilitySchema.shape.available,
    reason: kdsProductAvailabilitySchema.shape.reason,
    resetAt: kdsProductAvailabilitySchema.shape.resetAt,
    dailyStock: kdsProductAvailabilitySchema.shape.dailyStock,
  })
  .strict();
const blockKdsItemDataSchema = z
  .object({
    ticketId: z.uuid(),
    itemId: z.uuid(),
    code: kdsBlockSchema.shape.code,
    reason: kdsBlockSchema.shape.reason,
  })
  .strict();
const unblockKdsItemDataSchema = z
  .object({
    ticketId: z.uuid(),
    itemId: z.uuid(),
    reason: kdsUnblockSchema.shape.reason,
  })
  .strict();
const acknowledgeKdsAttentionDataSchema = z
  .object({
    ticketId: z.uuid(),
    itemId: z.uuid(),
    noteId: kdsAttentionAcknowledgeSchema.shape.noteId,
    revision: kdsAttentionAcknowledgeSchema.shape.revision,
  })
  .strict();

const eventTypeByAction = {
  "open-tab": "pos.tab.open_requested",
  "create-order": "pos.order.create_requested",
  "move-items": "pos.items.move_requested",
  "record-payment": "pos.payment.record_requested",
  "notify-ready": "pos.tab.ready_notification_requested",
  "acknowledge-call": "pos.service_call.acknowledged_requested",
  "resolve-call": "pos.service_call.resolved_requested",
  "send-order": "pos.order.send_requested",
  "transfer-tab": "pos.tab.transfer_requested",
  "merge-tabs": "pos.tabs.merge_requested",
  "group-tables": "pos.table_group.create_requested",
  "detach-table-group": "pos.table_group.detach_requested",
  "dissolve-table-group": "pos.table_group.dissolve_requested",
  "split-tab": "pos.tab.split_requested",
  "service-charge": "pos.tab.service_charge_requested",
  tip: "pos.tab.tip_requested",
  "discount-item": "pos.item.discount_requested",
  "cancel-item": "pos.item.cancel_requested",
  "transition-kds": "pos.kds.transition_requested",
  "transition-kds-item": "pos.kds.item_transition_requested",
  "refire-kds-item": "pos.kds.item_refire_requested",
  "recall-kds": "pos.kds.recall_requested",
  "set-kds-priority": "pos.kds.priority_requested",
  "set-kds-course-state": "pos.kds.course_state_requested",
  "handoff-kds-order": "pos.kds.handoff_requested",
  "set-kds-product-availability": "pos.kds.product_availability_requested",
  "block-kds-item": "pos.kds.item_block_requested",
  "unblock-kds-item": "pos.kds.item_unblock_requested",
  "acknowledge-kds-critical-note": "pos.kds.critical_note_acknowledged_requested",
} as const;

@Injectable()
export class SyncPilotService {
  constructor(private readonly pilot: PilotPosService) {}

  async apply(
    event: SyncEventInput,
    scope: { organizationId: string; unitId: string },
  ): Promise<Record<string, unknown> | null> {
    if (!event.type.startsWith("pos.")) return null;
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
    switch (envelope.action) {
      case "open-tab": {
        const { body } = openTabDataSchema.parse(envelope.data);
        return this.pilot.openTab(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          event.idempotencyKey,
          body,
          { tabId: event.id },
        );
      }
      case "create-order": {
        const { tabId, body } = createOrderDataSchema.parse(envelope.data);
        return this.pilot.createOrder(
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
        );
      }
      case "move-items": {
        const { tabId, body } = moveItemsDataSchema.parse(envelope.data);
        return this.pilot.moveItems(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          tabId,
          event.idempotencyKey,
          body,
        );
      }
      case "record-payment": {
        const { tabId, body } = recordPaymentDataSchema.parse(envelope.data);
        return this.pilot.recordPayment(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          tabId,
          event.idempotencyKey,
          body,
        );
      }
      case "notify-ready": {
        const { tabId } = notifyReadyDataSchema.parse(envelope.data);
        return this.pilot.notifyReady(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          tabId,
          event.idempotencyKey,
        );
      }
      case "acknowledge-call":
      case "resolve-call": {
        const { callId } = transitionCallDataSchema.parse(envelope.data);
        return this.pilot.transitionServiceCall(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          callId,
          envelope.action === "acknowledge-call" ? "acknowledged" : "resolved",
          event.idempotencyKey,
        );
      }
      case "send-order": {
        const { orderId } = sendOrderDataSchema.parse(envelope.data);
        return this.pilot.sendOrder(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          orderId,
          event.idempotencyKey,
          {
            ticketIdForStation: (stationId) =>
              stableOperationalId(event.id, "kds-ticket", stationId),
          },
        );
      }
      case "transfer-tab": {
        const { tabId, body } = transferTabDataSchema.parse(envelope.data);
        return this.pilot.transferTab(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          tabId,
          event.idempotencyKey,
          body,
        );
      }
      case "merge-tabs": {
        const { body } = mergeTabsDataSchema.parse(envelope.data);
        return this.pilot.mergeTabs(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          event.idempotencyKey,
          body,
        );
      }
      case "group-tables": {
        const { body } = groupTablesDataSchema.parse(envelope.data);
        return this.pilot.groupTables(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          event.idempotencyKey,
          body,
        );
      }
      case "detach-table-group": {
        const { groupId, body } = detachTableGroupDataSchema.parse(envelope.data);
        return this.pilot.detachTableGroup(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          groupId,
          event.idempotencyKey,
          body,
        );
      }
      case "dissolve-table-group": {
        const { groupId } = dissolveTableGroupDataSchema.parse(envelope.data);
        return this.pilot.dissolveTableGroup(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          groupId,
          event.idempotencyKey,
        );
      }
      case "split-tab": {
        const { tabId, body } = splitTabDataSchema.parse(envelope.data);
        return this.pilot.splitTab(
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
        );
      }
      case "service-charge": {
        const { tabId, basisPoints } = serviceChargeDataSchema.parse(envelope.data);
        return this.pilot.setServiceCharge(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          tabId,
          event.idempotencyKey,
          { basisPoints },
        );
      }
      case "tip": {
        const { tabId, tipCents } = tipDataSchema.parse(envelope.data);
        return this.pilot.setTip(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          tabId,
          event.idempotencyKey,
          { tipCents },
        );
      }
      case "discount-item": {
        const { itemId, body } = discountItemDataSchema.parse(envelope.data);
        return this.pilot.discountItem(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          itemId,
          event.idempotencyKey,
          body,
          { approvalId: stableOperationalId(event.id, "approval", "") },
        );
      }
      case "cancel-item": {
        const { itemId, approval } = cancelItemDataSchema.parse(envelope.data);
        return this.pilot.cancelItem(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          itemId,
          event.idempotencyKey,
          { approval },
          { approvalId: stableOperationalId(event.id, "approval", "") },
        );
      }
      case "transition-kds": {
        const { ticketId, state } = transitionKdsDataSchema.parse(envelope.data);
        return this.pilot.transitionKds(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          ticketId,
          event.idempotencyKey,
          { state },
        );
      }
      case "transition-kds-item": {
        const parsed = transitionKdsItemDataSchema.parse(envelope.data);
        const { ticketId, itemId, ...input } = parsed;
        return this.pilot.transitionKdsItem(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          ticketId,
          itemId,
          event.idempotencyKey,
          input,
        );
      }
      case "refire-kds-item": {
        const { ticketId, itemId, reason } = refireKdsItemDataSchema.parse(envelope.data);
        return this.pilot.refireKdsItem(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          ticketId,
          itemId,
          event.idempotencyKey,
          { reason },
        );
      }
      case "recall-kds": {
        const { ticketId, reason } = recallKdsDataSchema.parse(envelope.data);
        return this.pilot.recallKdsTicket(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          ticketId,
          event.idempotencyKey,
          { reason },
        );
      }
      case "set-kds-priority": {
        const { ticketId, priority, reason } = priorityKdsDataSchema.parse(envelope.data);
        return this.pilot.setKdsPriority(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          ticketId,
          event.idempotencyKey,
          { priority, reason },
        );
      }
      case "set-kds-course-state": {
        const { ticketId, course, state } = courseKdsDataSchema.parse(envelope.data);
        return this.pilot.setKdsCourseState(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          ticketId,
          event.idempotencyKey,
          { course, state },
        );
      }
      case "handoff-kds-order": {
        const { orderId, target, reason } = handoffKdsDataSchema.parse(envelope.data);
        return this.pilot.handoffKdsOrder(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          orderId,
          event.idempotencyKey,
          { target, reason },
        );
      }
      case "set-kds-product-availability": {
        const { productId, available, reason, resetAt, dailyStock } =
          availabilityKdsDataSchema.parse(envelope.data);
        return this.pilot.setKdsProductAvailability(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          productId,
          event.idempotencyKey,
          { available, reason, resetAt, dailyStock },
        );
      }
      case "block-kds-item": {
        const { ticketId, itemId, code, reason } = blockKdsItemDataSchema.parse(envelope.data);
        return this.pilot.blockKdsItem(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          ticketId,
          itemId,
          event.idempotencyKey,
          { code, reason },
        );
      }
      case "unblock-kds-item": {
        const { ticketId, itemId, reason } = unblockKdsItemDataSchema.parse(envelope.data);
        return this.pilot.unblockKdsItem(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          ticketId,
          itemId,
          event.idempotencyKey,
          { reason },
        );
      }
      case "acknowledge-kds-critical-note": {
        const { ticketId, itemId, noteId, revision } = acknowledgeKdsAttentionDataSchema.parse(
          envelope.data,
        );
        return this.pilot.acknowledgeKdsAttention(
          event.actorId,
          scope.organizationId,
          scope.unitId,
          ticketId,
          itemId,
          event.idempotencyKey,
          { noteId, revision },
        );
      }
    }
  }
}
