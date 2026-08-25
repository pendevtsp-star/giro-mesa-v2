import { ApiClientError, api } from "../../api";

export interface InventoryOfflineScope {
  organizationId: string;
  unitId: string;
}

type InventoryEventBody = Parameters<typeof api.management.createInventoryEvent>[2];
type TransferBody = Parameters<typeof api.management.transferInventoryBatch>[2];
type CountBody = Parameters<typeof api.management.submitBlindInventoryCount>[3];
type TemperatureBody = Parameters<typeof api.management.recordInventoryTemperature>[2];

export type InventoryOfflineInput =
  | { kind: "event"; body: InventoryEventBody; idempotencyKey: string }
  | { kind: "transfer"; body: TransferBody; idempotencyKey: string }
  | { kind: "count"; sessionId: string; body: CountBody; idempotencyKey: string }
  | { kind: "temperature"; body: TemperatureBody; idempotencyKey: string };

export type InventoryOfflineAction = InventoryOfflineInput & {
  id: string;
  queuedAt: string;
  status: "pending" | "rejected";
  error?: string;
};

const storageKey = (scope: InventoryOfflineScope) =>
  `giromesa.inventory.offline.v1:${scope.organizationId}:${scope.unitId}`;

function read(scope: InventoryOfflineScope): InventoryOfflineAction[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(scope)) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is InventoryOfflineAction => {
      if (!item || typeof item !== "object") return false;
      const action = item as Record<string, unknown>;
      return (
        typeof action.id === "string" &&
        typeof action.idempotencyKey === "string" &&
        typeof action.queuedAt === "string" &&
        !!action.body &&
        ["event", "transfer", "count", "temperature"].includes(String(action.kind)) &&
        ["pending", "rejected"].includes(String(action.status)) &&
        (action.kind !== "count" || typeof action.sessionId === "string")
      );
    });
  } catch {
    return [];
  }
}

function write(scope: InventoryOfflineScope, actions: InventoryOfflineAction[]) {
  if (actions.length) localStorage.setItem(storageKey(scope), JSON.stringify(actions));
  else localStorage.removeItem(storageKey(scope));
}

export function inventoryOfflineStatus(scope: InventoryOfflineScope) {
  const actions = read(scope);
  return {
    pending: actions.filter((action) => action.status === "pending").length,
    rejected: actions.filter((action) => action.status === "rejected").length,
  };
}

export function enqueueInventoryAction(
  scope: InventoryOfflineScope,
  action: InventoryOfflineInput,
) {
  const actions = read(scope);
  actions.push({
    ...action,
    id: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
    status: "pending",
  });
  write(scope, actions);
  return inventoryOfflineStatus(scope);
}

export async function replayInventoryQueue(scope: InventoryOfflineScope) {
  const actions = read(scope);
  for (const action of actions) {
    if (action.status !== "pending") continue;
    try {
      if (action.kind === "event") {
        await api.management.createInventoryEvent(
          scope.organizationId,
          scope.unitId,
          action.body,
          action.idempotencyKey,
        );
      } else if (action.kind === "transfer") {
        await api.management.transferInventoryBatch(
          scope.organizationId,
          scope.unitId,
          action.body,
          action.idempotencyKey,
        );
      } else if (action.kind === "count") {
        await api.management.submitBlindInventoryCount(
          scope.organizationId,
          scope.unitId,
          action.sessionId,
          action.body,
          action.idempotencyKey,
        );
      } else {
        await api.management.recordInventoryTemperature(
          scope.organizationId,
          scope.unitId,
          action.body,
          action.idempotencyKey,
        );
      }
      const index = actions.findIndex((candidate) => candidate.id === action.id);
      if (index >= 0) actions.splice(index, 1);
    } catch (error) {
      if (error instanceof ApiClientError && error.retryable) continue;
      const index = actions.findIndex((candidate) => candidate.id === action.id);
      if (index >= 0) {
        actions[index] = {
          ...action,
          status: "rejected",
          error: error instanceof Error ? error.message : "Operação rejeitada.",
        };
      }
    }
  }
  write(scope, actions);
  return inventoryOfflineStatus(scope);
}

export function clearRejectedInventoryActions(scope: InventoryOfflineScope) {
  write(
    scope,
    read(scope).filter((action) => action.status !== "rejected"),
  );
  return inventoryOfflineStatus(scope);
}
