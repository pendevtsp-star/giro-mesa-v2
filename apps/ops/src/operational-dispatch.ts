import type { OperationalCommandInput } from "@giromesa/contracts";
import { ApiClientError, api } from "./api";
import {
  acknowledgeShellKdsDispatch,
  type DeviceContext,
  loadShellOperationalState,
  sendShellCommand,
} from "./bridge";
import { createCommand, enqueueCommand, queuedCommands, removeQueuedCommand } from "./commands";

export interface OperationalScope {
  organizationId: string;
  unitId: string;
  actorId: string;
}

export type PilotAction =
  | "open-tab"
  | "create-order"
  | "send-order"
  | "transfer-tab"
  | "merge-tabs"
  | "split-tab"
  | "service-charge"
  | "tip"
  | "discount-item"
  | "cancel-item"
  | "transition-kds";

export interface PilotMutationPayload extends Record<string, unknown> {
  kind: "pilot.mutation";
  action: PilotAction;
  data: Record<string, unknown>;
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
    super(
      "A API não confirmou a ação. O comando idempotente ficou preservado neste dispositivo e será reenviado após a reconexão.",
    );
    this.name = "QueuedOperationalMutationError";
  }
}

export class RejectedOperationalMutationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`O Hub recusou a ação operacional (${code}).`);
    this.name = "RejectedOperationalMutationError";
    this.code = code;
  }
}

export class QueuedKdsAcknowledgementError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`O ACK do KDS ficou preservado para replay (${code}).`);
    this.name = "QueuedKdsAcknowledgementError";
    this.code = code;
  }
}

interface PendingKdsAcknowledgement {
  effectId: string;
  deliveryKey: string;
}

const kdsAcknowledgementQueueKey = "giromesa.ops.kds-acknowledgements";

function pendingKdsAcknowledgements(): PendingKdsAcknowledgement[] {
  try {
    const value = JSON.parse(localStorage.getItem(kdsAcknowledgementQueueKey) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PendingKdsAcknowledgement =>
        typeof item === "object" &&
        item !== null &&
        typeof item.effectId === "string" &&
        item.effectId.length > 0 &&
        typeof item.deliveryKey === "string" &&
        item.deliveryKey.length > 0,
    );
  } catch {
    return [];
  }
}

function saveKdsAcknowledgements(entries: PendingKdsAcknowledgement[]) {
  localStorage.setItem(kdsAcknowledgementQueueKey, JSON.stringify(entries));
}

function queueKdsAcknowledgement(entry: PendingKdsAcknowledgement) {
  const entries = pendingKdsAcknowledgements();
  if (
    !entries.some(
      (item) => item.effectId === entry.effectId && item.deliveryKey === entry.deliveryKey,
    )
  ) {
    entries.push(entry);
    saveKdsAcknowledgements(entries);
  }
}

function removeKdsAcknowledgement(entry: PendingKdsAcknowledgement) {
  saveKdsAcknowledgements(
    pendingKdsAcknowledgements().filter(
      (item) => item.effectId !== entry.effectId || item.deliveryKey !== entry.deliveryKey,
    ),
  );
}

export function pendingKdsAcknowledgementCount(): number {
  return pendingKdsAcknowledgements().length;
}

export async function acknowledgeKdsDelivery(
  runtime: DeviceContext,
  effectId: string,
  deliveryKey: string,
): Promise<void> {
  const entry = { effectId, deliveryKey };
  if (!runtime.embedded) {
    queueKdsAcknowledgement(entry);
    throw new QueuedKdsAcknowledgementError("KDS_EDGE_REQUIRED");
  }
  const acknowledgement = await acknowledgeShellKdsDispatch(effectId, deliveryKey);
  if (!acknowledgement?.success) {
    const code = acknowledgement?.errorCode ?? "SHELL_BRIDGE_UNAVAILABLE";
    queueKdsAcknowledgement(entry);
    throw new QueuedKdsAcknowledgementError(code);
  }
  removeKdsAcknowledgement(entry);
}

export function pilotMutation(
  action: PilotAction,
  data: Record<string, unknown>,
): PilotMutationPayload {
  return { kind: "pilot.mutation", action, data };
}

export async function dispatchOperationalMutation<T>(input: {
  scope: OperationalScope;
  runtime: DeviceContext;
  type: string;
  payload: PilotMutationPayload;
  execute: (idempotencyKey: string) => Promise<T>;
}): Promise<T> {
  const command = createCommand(input.runtime.deviceId, input.type, input.payload);
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
        enqueueCommand(command);
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
      enqueueCommand(command);
      throw new QueuedOperationalMutationError();
    }
    throw error;
  }
}

export async function replayOperationalQueue(
  scope: OperationalScope,
  runtime: DeviceContext,
): Promise<number> {
  for (const command of queuedCommands()) {
    const payload = readPilotPayload(command);
    if (!payload) {
      if (!runtime.embedded) continue;
      const acknowledgement = await sendShellCommand(
        scope.organizationId,
        scope.unitId,
        scope.actorId,
        command,
      );
      if (acknowledgement?.success) removeQueuedCommand(command.id);
      continue;
    }
    if (runtime.embedded) {
      const acknowledgement = await sendShellCommand(
        scope.organizationId,
        scope.unitId,
        scope.actorId,
        command,
      );
      if (!acknowledgement?.success) continue;
      removeQueuedCommand(command.id);
      continue;
    }
    try {
      await performPilotMutation(scope, command, payload);
      removeQueuedCommand(command.id);
    } catch {
      // Mantém o comando durável até que a API confirme a mesma chave idempotente.
    }
  }
  if (runtime.embedded) {
    for (const acknowledgement of pendingKdsAcknowledgements()) {
      try {
        await acknowledgeKdsDelivery(
          runtime,
          acknowledgement.effectId,
          acknowledgement.deliveryKey,
        );
      } catch {
        // MantÃ©m o ACK durÃ¡vel atÃ© o mesmo efeito ser confirmado pelo Hub.
      }
    }
  }
  return queuedCommands().length + pendingKdsAcknowledgementCount();
}

export async function loadOperationalResource<T>(
  runtime: DeviceContext,
  resource: OperationalResource,
  resourceId: string | undefined,
  cloudLoader: () => Promise<T>,
): Promise<T> {
  if (resource === "kds" && !runtime.embedded) {
    throw new RejectedOperationalMutationError("KDS_EDGE_REQUIRED");
  }
  if (runtime.embedded) {
    const state = await loadShellOperationalState(resource, resourceId);
    if (state?.success && state.payload !== undefined) return state.payload as T;
    if (resource === "kds") {
      throw new RejectedOperationalMutationError(state?.errorCode ?? "KDS_EDGE_UNAVAILABLE");
    }
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
    case "open-tab":
      return api.pilot.openTab(
        scope.organizationId,
        scope.unitId,
        data.body as { tableId?: string; label?: string; guestCount: number },
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
          }>;
        },
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
    case "merge-tabs":
      return api.pilot.mergeTabs(
        scope.organizationId,
        scope.unitId,
        data.body as { targetTabId: string; sourceTabIds: string[] },
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
        data.state as "preparing" | "ready" | "done" | "canceled",
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
