import type { OperationalCommandInput } from "@giromesa/contracts";

const queueKey = "giromesa.ops.command-queue.v2";
const legacyQueueKey = "giromesa.ops.command-queue.v1";

export interface CommandQueueScope {
  organizationId: string;
  unitId: string;
  actorId?: string;
}

interface StoredCommand {
  command: OperationalCommandInput;
  scope?: CommandQueueScope;
  status: "pending" | "quarantined";
  queuedAt: string;
  dedupeKey?: string;
  errorCode?: string;
}

export interface QuarantinedCommand {
  command: OperationalCommandInput;
  errorCode: string;
  queuedAt: string;
}

export function createCommand(
  deviceId: string,
  type: string,
  payload: Record<string, unknown> = {},
  now = new Date(),
): OperationalCommandInput {
  const id = crypto.randomUUID();
  return {
    id,
    deviceId,
    type,
    version: 1,
    occurredAt: now.toISOString(),
    idempotencyKey: `${deviceId}:${id}`,
    payload,
  };
}

export function enqueueCommand(
  command: OperationalCommandInput,
  scope?: CommandQueueScope,
): number {
  const queue = readQueue(scope);
  const dedupeKey = commandDedupeKey(command);
  if (
    dedupeKey &&
    queue.some(
      (entry) =>
        entry.status === "pending" &&
        sameScope(entry.scope, scope) &&
        entry.dedupeKey === dedupeKey,
    )
  ) {
    return countPending(queue, scope);
  }
  queue.push({
    command,
    scope,
    status: "pending",
    queuedAt: new Date().toISOString(),
    dedupeKey,
  });
  writeQueue(queue);
  return countPending(queue, scope);
}

export function queuedCommandCount(scope?: CommandQueueScope): number {
  return countPending(readQueue(scope), scope);
}

export function queuedCommands(scope?: CommandQueueScope): OperationalCommandInput[] {
  return readQueue(scope)
    .filter((entry) => entry.status === "pending" && sameScope(entry.scope, scope))
    .map((entry) => entry.command);
}

export function quarantinedCommands(scope?: CommandQueueScope): QuarantinedCommand[] {
  return readQueue(scope)
    .filter((entry) => entry.status === "quarantined" && sameScope(entry.scope, scope))
    .map((entry) => ({
      command: entry.command,
      errorCode: entry.errorCode ?? "OPERATION_REJECTED",
      queuedAt: entry.queuedAt,
    }));
}

export function quarantineQueuedCommand(
  commandId: string,
  errorCode: string,
  scope?: CommandQueueScope,
): number {
  const queue = readQueue(scope).map((entry) =>
    entry.command.id === commandId && sameScope(entry.scope, scope)
      ? { ...entry, status: "quarantined" as const, errorCode }
      : entry,
  );
  writeQueue(queue);
  return countPending(queue, scope);
}

export function removeQueuedCommand(commandId: string, scope?: CommandQueueScope): number {
  const queue = readQueue(scope).filter(
    (entry) => entry.command.id !== commandId || !sameScope(entry.scope, scope),
  );
  writeQueue(queue);
  return countPending(queue, scope);
}

export function clearCommandQueue(scope?: CommandQueueScope): void {
  if (!scope) {
    localStorage.removeItem(queueKey);
    localStorage.removeItem(legacyQueueKey);
    return;
  }
  writeQueue(readQueue(scope).filter((entry) => !sameScope(entry.scope, scope)));
}

function readQueue(adoptLegacyScope?: CommandQueueScope): StoredCommand[] {
  try {
    const current = localStorage.getItem(queueKey);
    const legacy = current ? null : localStorage.getItem(legacyQueueKey);
    if (!current && !legacy) return [];
    const parsed = JSON.parse(current ?? legacy ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    let migrated = legacy !== null;
    const queue = parsed.flatMap((value): StoredCommand[] => {
      if (!isRecord(value)) return [];
      if (isRecord(value.command)) {
        const entry = value as unknown as StoredCommand;
        if (!entry.scope && adoptLegacyScope) {
          migrated = true;
          return [
            {
              ...entry,
              status: "quarantined",
              errorCode: "LEGACY_SCOPE_UNKNOWN",
            },
          ];
        }
        return [entry];
      }
      migrated = true;
      return [
        {
          command: value as unknown as OperationalCommandInput,
          status: "quarantined",
          queuedAt: new Date().toISOString(),
          dedupeKey: commandDedupeKey(value as unknown as OperationalCommandInput),
          errorCode: "LEGACY_SCOPE_UNKNOWN",
        },
      ];
    });
    if (migrated) writeQueue(queue);
    return queue;
  } catch {
    localStorage.removeItem(queueKey);
    localStorage.removeItem(legacyQueueKey);
    return [];
  }
}

function writeQueue(queue: StoredCommand[]): void {
  localStorage.removeItem(legacyQueueKey);
  if (queue.length === 0) localStorage.removeItem(queueKey);
  else localStorage.setItem(queueKey, JSON.stringify(queue));
}

function countPending(queue: StoredCommand[], scope?: CommandQueueScope): number {
  return queue.filter((entry) => entry.status === "pending" && sameScope(entry.scope, scope))
    .length;
}

function sameScope(left: CommandQueueScope | undefined, right: CommandQueueScope | undefined) {
  if (!right) return true;
  return (
    left?.organizationId === right.organizationId &&
    left.unitId === right.unitId &&
    (!left.actorId || !right.actorId || left.actorId === right.actorId)
  );
}

function commandDedupeKey(command: OperationalCommandInput): string | undefined {
  const payload = command.payload;
  if (!isRecord(payload) || payload.kind !== "pilot.mutation" || !isRecord(payload.data))
    return undefined;
  if (payload.action === "transition-kds" && typeof payload.data.ticketId === "string") {
    const state = typeof payload.data.state === "string" ? payload.data.state : "unknown";
    return `kds:${payload.data.ticketId}:transition:${state}`;
  }
  if (payload.action === "transition-kds-item" && typeof payload.data.ticketId === "string") {
    return `kds:${payload.data.ticketId}:item:${String(payload.data.itemId)}:transition:${String(payload.data.state)}:${String(payload.data.quantity ?? "all")}`;
  }
  if (payload.action === "refire-kds-item" && typeof payload.data.ticketId === "string") {
    return `kds:${payload.data.ticketId}:item:${String(payload.data.itemId)}:refire`;
  }
  if (payload.action === "recall-kds" && typeof payload.data.ticketId === "string") {
    return `kds:${payload.data.ticketId}:recall`;
  }
  if (payload.action === "set-kds-priority" && typeof payload.data.ticketId === "string") {
    return `kds:${payload.data.ticketId}:priority:${String(payload.data.priority)}`;
  }
  if (payload.action === "set-kds-course-state" && typeof payload.data.ticketId === "string") {
    return `kds:${payload.data.ticketId}:course:${String(payload.data.course)}:${String(payload.data.state)}`;
  }
  if (
    payload.action === "set-kds-product-availability" &&
    typeof payload.data.productId === "string"
  ) {
    return `kds-product:${payload.data.productId}:available:${String(payload.data.available)}`;
  }
  if (payload.action === "handoff-kds-order" && typeof payload.data.orderId === "string") {
    return `kds-order:${payload.data.orderId}:handoff:${String(payload.data.target)}`;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
