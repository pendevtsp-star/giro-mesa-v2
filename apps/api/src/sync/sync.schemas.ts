import { z } from "zod";

const maximumInteger = 2_147_483_647;

const boundedJson = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 65_536,
    "Payload exceeds 64 KiB.",
  );

const edgeTimestamp = z.iso.datetime({ offset: true }).refine((value) => {
  const timestamp = new Date(value).getTime();
  const now = Date.now();
  return timestamp >= now - 30 * 24 * 60 * 60 * 1000 && timestamp <= now + 5 * 60 * 1000;
}, "Timestamp is outside the accepted clock window.");

const eventBase = {
  actorId: z.uuid(),
  deviceId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(160),
  type: z.string().trim().min(3).max(100),
  payload: boundedJson,
  occurredAt: edgeTimestamp,
};

export const legacySyncEventSchema = z
  .object({
    id: z.uuid(),
    ...eventBase,
    version: z.number().int().positive().max(100),
  })
  .strict();

export const syncEventSchema = z
  .object({
    commandId: z.uuid(),
    ...eventBase,
    aggregate: z.object({ type: z.string().trim().min(1).max(80), id: z.uuid() }).strict(),
    occupancyEpoch: z.uuid(),
    resourceVersion: z.number().int().nonnegative().max(maximumInteger),
    aggregateSequence: z.number().int().positive().max(maximumInteger),
  })
  .strict();

const syncBatchBase = {
  hubVersion: z.string().trim().min(1).max(40),
  metadata: z
    .record(z.string().max(64), z.unknown())
    .refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 4_096)
    .default({}),
  acknowledgedCommandIds: z.array(z.uuid()).max(100).default([]),
};

const legacySyncBatchSchema = z
  .object({
    protocolVersion: z.literal(1),
    ...syncBatchBase,
    events: z.array(legacySyncEventSchema).max(100).default([]),
  })
  .strict();

const orderedSyncBatchSchema = z
  .object({
    protocolVersion: z.literal(2),
    ...syncBatchBase,
    events: z.array(syncEventSchema).max(100).default([]),
  })
  .strict();

export const syncBatchSchema = z.discriminatedUnion("protocolVersion", [
  legacySyncBatchSchema,
  orderedSyncBatchSchema,
]);

export type SyncEventInput = z.infer<typeof legacySyncEventSchema>;
export type OrderedSyncEventInput = z.infer<typeof syncEventSchema>;
export type NormalizedSyncEventInput = OrderedSyncEventInput & { id: string; version: number };
export type SyncBatchInput = z.input<typeof syncBatchSchema>;
export type NormalizedSyncBatchInput = Omit<z.output<typeof syncBatchSchema>, "events"> & {
  events: NormalizedSyncEventInput[];
};

export function normalizeSyncBatch(input: SyncBatchInput): NormalizedSyncBatchInput {
  const batch = syncBatchSchema.parse(input);
  if (batch.protocolVersion === 1) {
    return {
      ...batch,
      events: batch.events.map((event) => ({
        ...event,
        id: event.id,
        commandId: event.id,
        aggregate: { type: "legacy.operational_command", id: event.id },
        occupancyEpoch: event.id,
        resourceVersion: event.version,
        aggregateSequence: 1,
      })),
    } as NormalizedSyncBatchInput;
  }
  return {
    ...batch,
    events: batch.events.map((event) => ({
      ...event,
      id: event.commandId,
      version: event.resourceVersion,
    })),
  } as NormalizedSyncBatchInput;
}
