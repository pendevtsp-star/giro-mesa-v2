import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { PilotPosService } from "../pilot-operations/pilot-pos.service.js";
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
import { stableOperationalId } from "./stable-operational-id.js";
import type { SyncEventInput } from "./sync.schemas.js";

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
    }
  }
}
