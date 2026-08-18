import { ApiClientError, api } from "./api";

export interface TimeClockOfflineScope {
  organizationId: string;
  unitId: string;
  identityId: string;
}

export type TimeClockOfflineAction =
  | {
      id: string;
      kind: "clock-in" | "clock-out";
      body: {
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        capturedAt: string;
        deviceId?: string;
      };
      idempotencyKey: string;
      queuedAt: string;
      status: "pending" | "rejected";
      error?: string;
    }
  | {
      id: string;
      kind: "break-start";
      body: {
        type: "meal" | "temporary";
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        capturedAt: string;
        deviceId?: string;
      };
      idempotencyKey: string;
      queuedAt: string;
      status: "pending" | "rejected";
      error?: string;
    };

export type TimeClockOfflineActionInput =
  | {
      kind: "clock-in" | "clock-out";
      body: {
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        capturedAt: string;
        deviceId?: string;
      };
      idempotencyKey: string;
    }
  | {
      kind: "break-start";
      body: {
        type: "meal" | "temporary";
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        capturedAt: string;
        deviceId?: string;
      };
      idempotencyKey: string;
    };

function storageKey(scope: TimeClockOfflineScope) {
  return `giromesa.time-clock.offline.v1:${scope.organizationId}:${scope.unitId}:${scope.identityId}`;
}

export function timeClockDeviceId(scope: TimeClockOfflineScope) {
  if (typeof localStorage === "undefined") return undefined;
  const key = `giromesa.time-clock.device.v1:${scope.organizationId}:${scope.unitId}:${scope.identityId}`;
  const current = localStorage.getItem(key);
  if (current) return current;
  const created = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}`;
  localStorage.setItem(key, created);
  return created;
}

function read(scope: TimeClockOfflineScope): TimeClockOfflineAction[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(scope)) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is TimeClockOfflineAction => {
      if (typeof item !== "object" || item === null) return false;
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.kind === "string" &&
        typeof candidate.idempotencyKey === "string" &&
        typeof candidate.queuedAt === "string" &&
        (candidate.status === "pending" || candidate.status === "rejected")
      );
    });
  } catch {
    return [];
  }
}

function write(scope: TimeClockOfflineScope, actions: TimeClockOfflineAction[]) {
  if (actions.length === 0) localStorage.removeItem(storageKey(scope));
  else localStorage.setItem(storageKey(scope), JSON.stringify(actions));
}

export function queuedTimeClockActions(scope: TimeClockOfflineScope) {
  return read(scope).filter((action) => action.status === "pending");
}

export function rejectedTimeClockActions(scope: TimeClockOfflineScope) {
  return read(scope).filter((action) => action.status === "rejected");
}

export function enqueueTimeClockAction(
  scope: TimeClockOfflineScope,
  action: TimeClockOfflineActionInput,
) {
  const actions = read(scope);
  actions.push({
    ...action,
    id: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
    status: "pending",
  });
  write(scope, actions);
  return queuedTimeClockActions(scope).length;
}

export async function replayTimeClockQueue(scope: TimeClockOfflineScope) {
  const actions = read(scope);
  for (const action of actions) {
    if (action.status !== "pending") continue;
    try {
      if (action.kind === "clock-in") {
        await api.management.selfClockIn(
          scope.organizationId,
          scope.unitId,
          action.body,
          action.idempotencyKey,
        );
      } else if (action.kind === "clock-out") {
        await api.management.selfClockOut(
          scope.organizationId,
          scope.unitId,
          action.body,
          action.idempotencyKey,
        );
      } else {
        await api.management.selfStartBreak(
          scope.organizationId,
          scope.unitId,
          action.body as {
            type: "meal" | "temporary";
            latitude: number;
            longitude: number;
            accuracyMeters?: number;
            capturedAt: string;
          },
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
          error: error instanceof Error ? error.message : "Registro rejeitado.",
        };
      }
    }
  }
  write(scope, actions);
  return {
    pending: queuedTimeClockActions(scope).length,
    rejected: rejectedTimeClockActions(scope).length,
  };
}

export function clearRejectedTimeClockActions(scope: TimeClockOfflineScope) {
  write(
    scope,
    read(scope).filter((action) => action.status !== "rejected"),
  );
}
