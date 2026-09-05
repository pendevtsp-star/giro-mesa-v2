import type { OperationalCommandInput } from "@giromesa/contracts";
import { ApiClientError, api } from "./api";
import { type DeviceContext, loadShellOperationalState, sendShellCommand } from "./bridge";
import {
  createCommand,
  enqueueCommand,
  quarantineQueuedCommand,
  queuedCommands,
  removeQueuedCommand,
} from "./commands";

export interface OperationalScope {
  organizationId: string;
  unitId: string;
  actorId: string;
}

export type PilotAction =
  | "open-tab"
  | "table-turnover"
  | "create-order"
  | "move-items"
  | "record-payment"
  | "notify-ready"
  | "acknowledge-call"
  | "resolve-call"
  | "send-order"
  | "transfer-tab"
  | "merge-tabs"
  | "group-tables"
  | "detach-table-group"
  | "dissolve-table-group"
  | "split-tab"
  | "service-charge"
  | "tip"
  | "discount-item"
  | "cancel-item"
  | "transition-kds"
  | "transition-kds-item"
  | "refire-kds-item"
  | "recall-kds"
  | "set-kds-priority"
  | "set-kds-order-priority"
  | "set-kds-course-state"
  | "set-kds-product-availability"
  | "handoff-kds-order"
  | "cancel-kds-ticket"
  | "block-kds-item"
  | "unblock-kds-item"
  | "acknowledge-kds-critical-note"
  | "reroute-kds-item"
  | "create-kds-batch"
  | "complete-kds-batch"
  | "cancel-kds-batch";

const SENSITIVE_CLOUD_ONLY_ACTIONS = new Set<PilotAction>([
  "discount-item",
  "cancel-item",
  "cancel-kds-ticket",
  "reroute-kds-item",
  "create-kds-batch",
  "complete-kds-batch",
  "cancel-kds-batch",
]);

export interface PilotMutationPayload extends Record<string, unknown> {
  kind: "pilot.mutation";
  action: PilotAction;
  data: Record<string, unknown>;
  delivery?: "cloud-only" | "edge-capable";
}

export type PilotDispatcher = <T>(
  type: string,
  payload: PilotMutationPayload,
  execute: (idempotencyKey: string) => Promise<T>,
) => Promise<T>;

export type OperationalResource = "catalog" | "floor" | "tabs" | "tab" | "kds" | "reconciliation";

export type PilotLoader = <T>(
  resource: OperationalResource,
  resourceId: string | undefined,
  cloudLoader: () => Promise<T>,
) => Promise<T>;

export class QueuedOperationalMutationError extends Error {
  constructor() {
    super("A ação não foi confirmada e ficou salva neste dispositivo para nova tentativa.");
    this.name = "QueuedOperationalMutationError";
  }
}

export class RejectedOperationalMutationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`A conexão local recusou a ação operacional (${code}).`);
    this.name = "RejectedOperationalMutationError";
    this.code = code;
  }
}

export function pilotMutation(
  action: PilotAction,
  data: Record<string, unknown>,
  delivery?: PilotMutationPayload["delivery"],
): PilotMutationPayload {
  return { kind: "pilot.mutation", action, data, ...(delivery ? { delivery } : {}) };
}

function isCloudOnlyMutation(payload: PilotMutationPayload): boolean {
  return payload.delivery === "cloud-only" || SENSITIVE_CLOUD_ONLY_ACTIONS.has(payload.action);
}

export async function dispatchOperationalMutation<T>(input: {
  scope: OperationalScope;
  runtime: DeviceContext;
  type: string;
  payload: PilotMutationPayload;
  execute: (idempotencyKey: string) => Promise<T>;
}): Promise<T> {
  const command = createCommand(input.runtime.deviceId, input.type, input.payload);
  if (isCloudOnlyMutation(input.payload)) {
    return input.execute(command.idempotencyKey);
  }
  if (input.runtime.embedded) {
    const acknowledgement = await sendShellCommand(
      input.scope.organizationId,
      input.scope.unitId,
      input.scope.actorId,
      command,
    );
    if (!acknowledgement?.success) {
      const errorCode = acknowledgement?.errorCode ?? "SHELL_BRIDGE_UNAVAILABLE";
      if (isRetryableHubError(errorCode)) {
        enqueueCommand(command, input.scope);
        throw new QueuedOperationalMutationError();
      }
      throw new RejectedOperationalMutationError(errorCode);
    }
    if (acknowledgement.result === undefined) {
      throw new RejectedOperationalMutationError("HUB_RESULT_MISSING");
    }
    return acknowledgement.result as T;
  }
  try {
    return await input.execute(command.idempotencyKey);
  } catch (error) {
    if (error instanceof ApiClientError && error.retryable) {
      enqueueCommand(command, input.scope);
      throw new QueuedOperationalMutationError();
    }
    throw error;
  }
}

export async function replayOperationalQueue(
  scope: OperationalScope,
  runtime: DeviceContext,
): Promise<number> {
  for (const command of queuedCommands(scope)) {
    const payload = readPilotPayload(command);
    if (!payload) {
      if (!runtime.embedded) {
        quarantineQueuedCommand(command.id, "UNSUPPORTED_QUEUED_COMMAND", scope);
        continue;
      }
      const acknowledgement = await sendShellCommand(
        scope.organizationId,
        scope.unitId,
        scope.actorId,
        command,
      );
      if (acknowledgement?.success) removeQueuedCommand(command.id, scope);
      else {
        const code = acknowledgement?.errorCode ?? "SHELL_BRIDGE_UNAVAILABLE";
        if (!isRetryableHubError(code)) quarantineQueuedCommand(command.id, code, scope);
      }
      continue;
    }
    if (isCloudOnlyMutation(payload)) {
      removeQueuedCommand(command.id, scope);
      continue;
    }
    if (runtime.embedded) {
      const acknowledgement = await sendShellCommand(
        scope.organizationId,
        scope.unitId,
        scope.actorId,
        command,
      );
      if (!acknowledgement?.success) {
        const code = acknowledgement?.errorCode ?? "SHELL_BRIDGE_UNAVAILABLE";
        if (!isRetryableHubError(code)) quarantineQueuedCommand(command.id, code, scope);
        continue;
      }
      removeQueuedCommand(command.id, scope);
      continue;
    }
    try {
      await performPilotMutation(scope, command, payload);
      removeQueuedCommand(command.id, scope);
    } catch (error) {
      if (error instanceof ApiClientError && !error.retryable) {
        quarantineQueuedCommand(command.id, error.code, scope);
      }
      // Falhas transitórias permanecem pendentes; rejeições determinísticas ficam em quarentena.
    }
  }
  return queuedCommands(scope).length;
}

export async function loadOperationalResource<T>(
  runtime: DeviceContext,
  resource: OperationalResource,
  resourceId: string | undefined,
  cloudLoader: () => Promise<T>,
): Promise<T> {
  if (runtime.embedded) {
    const state = await loadShellOperationalState(resource, resourceId);
    if (state?.success && state.payload !== undefined) return state.payload as T;
  }
  return cloudLoader();
}

function readPilotPayload(command: OperationalCommandInput): PilotMutationPayload | null {
  const payload = command.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.kind !== "pilot.mutation" ||
    typeof payload.action !== "string" ||
    typeof payload.data !== "object" ||
    payload.data === null ||
    Array.isArray(payload.data)
  ) {
    return null;
  }
  return payload as PilotMutationPayload;
}

async function performPilotMutation(
  scope: OperationalScope,
  command: OperationalCommandInput,
  payload: PilotMutationPayload,
) {
  const data = payload.data;
  const id = command.idempotencyKey;
  switch (payload.action) {
    case "table-turnover":
      return api.pilot.updateTableTurnover(
        scope.organizationId,
        scope.unitId,
        data.tableId as string,
        data.status as "cleaning" | "available",
      );
    case "open-tab":
      return api.pilot.openTab(
        scope.organizationId,
        scope.unitId,
        data.body as {
          tableId?: string;
          label?: string;
          guestCount: number;
          fulfillmentType?: "dine_in" | "pickup" | "delivery";
          customerName?: string;
          customerPhone?: string;
          deliveryAddress?: string;
          promisedAt?: string;
          responsibleIdentityId?: string;
        },
        id,
      );
    case "create-order":
      return api.pilot.createOrder(
        scope.organizationId,
        scope.unitId,
        String(data.tabId),
        data.body as {
          items: Array<{
            productId: string;
            quantity: number;
            modifierOptionIds: string[];
            notes?: string;
            seatNumber?: number;
            course?: "anytime" | "starter" | "main" | "dessert";
            allergyNote?: string;
          }>;
        },
        id,
      );
    case "move-items":
      return api.pilot.moveItems(
        scope.organizationId,
        scope.unitId,
        String(data.tabId),
        data.body as {
          targetTabId: string;
          items: Array<{ orderItemId: string; quantity: number }>;
        },
        id,
      );
    case "record-payment":
      return api.pilot.recordPayment(
        scope.organizationId,
        scope.unitId,
        String(data.tabId),
        data.body as {
          method: "cash" | "credit_card" | "debit_card" | "pix" | "other";
          amountCents: number;
          reference?: string;
          cashRegisterId?: string;
          installationId?: string;
        },
        id,
      );
    case "notify-ready":
      return api.pilot.notifyReady(scope.organizationId, scope.unitId, String(data.tabId), id);
    case "acknowledge-call":
      return api.pilot.acknowledgeServiceCall(
        scope.organizationId,
        scope.unitId,
        String(data.callId),
        id,
      );
    case "resolve-call":
      return api.pilot.resolveServiceCall(
        scope.organizationId,
        scope.unitId,
        String(data.callId),
        id,
      );
    case "send-order":
      return api.pilot.sendOrder(scope.organizationId, scope.unitId, String(data.orderId), id);
    case "transfer-tab":
      return api.pilot.transferTab(
        scope.organizationId,
        scope.unitId,
        String(data.tabId),
        data.body as { tableId: string; reason: string },
        id,
      );
    case "merge-tabs": {
      const body = data.body as {
        targetTabId: string;
        sourceTabIds: string[];
        reasonCode?:
          | "large_party"
          | "sit_together"
          | "accessibility"
          | "operational_reorganization"
          | "other";
        reasonNote?: string;
      };
      return api.pilot.mergeTabs(
        scope.organizationId,
        scope.unitId,
        { ...body, reasonCode: body.reasonCode ?? "operational_reorganization" },
        id,
      );
    }
    case "group-tables": {
      const body = data.body as {
        tableIds: string[];
        anchorTableId: string;
        mode: "physical_only" | "single_tab";
        targetTabId?: string;
        responsibleIdentityId?: string;
        reasonCode?:
          | "large_party"
          | "sit_together"
          | "accessibility"
          | "operational_reorganization"
          | "other";
        reasonNote?: string;
      };
      return api.pilot.groupTables(
        scope.organizationId,
        scope.unitId,
        { ...body, reasonCode: body.reasonCode ?? "operational_reorganization" },
        id,
      );
    }
    case "detach-table-group":
      return api.pilot.detachTableGroup(
        scope.organizationId,
        scope.unitId,
        String(data.groupId),
        String(data.tableId),
        id,
      );
    case "dissolve-table-group":
      return api.pilot.dissolveTableGroup(
        scope.organizationId,
        scope.unitId,
        String(data.groupId),
        id,
      );
    case "split-tab":
      return api.pilot.splitTab(
        scope.organizationId,
        scope.unitId,
        String(data.tabId),
        data.body as {
          tableId?: string;
          label?: string;
          items: Array<{ orderItemId: string; quantity: number }>;
        },
        id,
      );
    case "service-charge":
      return api.pilot.serviceCharge(
        scope.organizationId,
        scope.unitId,
        String(data.tabId),
        Number(data.basisPoints),
        id,
      );
    case "tip":
      return api.pilot.tip(
        scope.organizationId,
        scope.unitId,
        String(data.tabId),
        Number(data.tipCents),
        id,
      );
    case "discount-item":
      return api.pilot.discountItem(
        scope.organizationId,
        scope.unitId,
        String(data.itemId),
        data.body as {
          discountCents: number;
          approval: { approverMembershipId: string; pin: string; reason: string };
        },
        id,
      );
    case "cancel-item":
      return api.pilot.cancelItem(
        scope.organizationId,
        scope.unitId,
        String(data.itemId),
        data.approval as { approverMembershipId: string; pin: string; reason: string },
        id,
      );
    case "transition-kds":
      return api.pilot.transitionKds(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        data.state as "preparing" | "ready",
        id,
      );
    case "transition-kds-item":
      return api.pilot.transitionKdsItem(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        String(data.itemId),
        data.state as "preparing" | "ready",
        data.quantity === undefined ? undefined : Number(data.quantity),
        id,
      );
    case "refire-kds-item":
      return api.pilot.refireKdsItem(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        String(data.itemId),
        String(data.reason),
        id,
      );
    case "recall-kds":
      return api.pilot.recallKds(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        String(data.reason),
        id,
      );
    case "set-kds-priority":
      return api.pilot.setKdsPriority(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        Number(data.priority),
        String(data.reason),
        id,
      );
    case "set-kds-order-priority":
      return api.pilot.setKdsOrderPriority(
        scope.organizationId,
        scope.unitId,
        String(data.orderId),
        Number(data.priority),
        String(data.reason),
        id,
        typeof data.installationId === "string" ? data.installationId : undefined,
      );
    case "set-kds-course-state":
      return api.pilot.setKdsCourseState(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        data.course as "anytime" | "starter" | "main" | "dessert",
        data.state as "held" | "fired",
        id,
      );
    case "set-kds-product-availability":
      return api.pilot.setKdsProductAvailability(
        scope.organizationId,
        scope.unitId,
        String(data.productId),
        Boolean(data.available),
        String(data.reason),
        id,
        {
          ...(Object.hasOwn(data, "resetAt")
            ? { resetAt: data.resetAt === null ? null : String(data.resetAt) }
            : {}),
          ...(Object.hasOwn(data, "dailyStock")
            ? { dailyStock: data.dailyStock === null ? null : Number(data.dailyStock) }
            : {}),
        },
      );
    case "handoff-kds-order":
      return api.pilot.handoffKds(
        scope.organizationId,
        scope.unitId,
        String(data.orderId),
        data.target as "expedition" | "served",
        typeof data.reason === "string" ? data.reason : undefined,
        id,
      );
    case "cancel-kds-ticket":
      return api.pilot.cancelKdsTicket(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        data.approval as {
          approverMembershipId: string;
          pin: string;
          reason: string;
        },
        id,
      );
    case "block-kds-item":
      return api.pilot.blockKdsItem(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        String(data.itemId),
        {
          code: data.code as
            | "missing_ingredient"
            | "equipment_issue"
            | "quality_check"
            | "dependency"
            | "other",
          reason: String(data.reason),
        },
        id,
      );
    case "unblock-kds-item":
      return api.pilot.unblockKdsItem(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        String(data.itemId),
        String(data.reason),
        id,
      );
    case "acknowledge-kds-critical-note":
      return api.pilot.acknowledgeKdsAttention(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        String(data.itemId),
        data.noteId as "allergy" | "notes",
        String(data.revision),
        id,
      );
    case "reroute-kds-item":
      return api.pilot.rerouteKdsItem(
        scope.organizationId,
        scope.unitId,
        String(data.ticketId),
        String(data.itemId),
        String(data.stationId),
        String(data.reason),
        id,
      );
    case "create-kds-batch":
      return api.pilot.createKdsBatch(
        scope.organizationId,
        scope.unitId,
        {
          stationId: String(data.stationId),
          ...(typeof data.productId === "string" ? { productId: data.productId } : {}),
          maxAssignments: Number(data.maxAssignments),
        },
        id,
      );
    case "complete-kds-batch":
      return api.pilot.completeKdsBatch(
        scope.organizationId,
        scope.unitId,
        String(data.batchId),
        id,
      );
    case "cancel-kds-batch":
      return api.pilot.cancelKdsBatch(
        scope.organizationId,
        scope.unitId,
        String(data.batchId),
        String(data.reason),
        id,
      );
  }
}

function isRetryableHubError(code: string): boolean {
  return (
    code === "SHELL_BRIDGE_UNAVAILABLE" ||
    code === "HUB_NOT_PAIRED" ||
    code === "HUB_COMMAND_UNREACHABLE" ||
    code === "HUB_TIMEOUT" ||
    code === "HUB_UNREACHABLE" ||
    /^HUB_HTTP_5\d\d$/.test(code)
  );
}
