import type { OperationalCommandInput } from "../../../packages/contracts/src/index";

const queueKey = "giromesa.ops.command-queue.v1";

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

export function enqueueCommand(command: OperationalCommandInput): number {
  const queue = readQueue();
  queue.push(command);
  localStorage.setItem(queueKey, JSON.stringify(queue));
  return queue.length;
}

export function queuedCommandCount(): number {
  return readQueue().length;
}

export function queuedCommands(): OperationalCommandInput[] {
  return readQueue();
}

export function removeQueuedCommand(commandId: string): number {
  const queue = readQueue().filter((command) => command.id !== commandId);
  if (queue.length === 0) localStorage.removeItem(queueKey);
  else localStorage.setItem(queueKey, JSON.stringify(queue));
  return queue.length;
}

export function clearCommandQueue(): void {
  localStorage.removeItem(queueKey);
}

function readQueue(): OperationalCommandInput[] {
  try {
    const value = localStorage.getItem(queueKey);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as OperationalCommandInput[]) : [];
  } catch {
    localStorage.removeItem(queueKey);
    return [];
  }
}
