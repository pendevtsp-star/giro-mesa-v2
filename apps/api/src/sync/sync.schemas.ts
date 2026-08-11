import {
  MAX_FUTURE_CLOCK_SKEW_MS,
  MAX_OFFLINE_COMMAND_AGE_MS,
  MAX_SYNC_ACKNOWLEDGEMENTS,
  MAX_SYNC_BATCH_BYTES,
  MAX_SYNC_BATCH_EVENTS,
  MAX_SYNC_EVENT_BYTES,
  MAX_SYNC_PAYLOAD_BYTES,
  MAX_SYNC_PRICE_REFERENCES,
  MAX_SYNC_RESOURCE_PRECONDITIONS,
  SYNC_ENVELOPE_CONTRACT,
} from "@giromesa/domain";
import { z } from "zod";

const contract = SYNC_ENVELOPE_CONTRACT;
const canonicalUuid = z.string().regex(new RegExp(contract.uuidPattern));

const boundedJson = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_SYNC_PAYLOAD_BYTES,
    "Payload exceeds 64 KiB.",
  );

const edgeTimestamp = z.iso.datetime({ offset: true }).refine((value) => {
  const timestamp = new Date(value).getTime();
  const now = Date.now();
  return (
    timestamp >= now - MAX_OFFLINE_COMMAND_AGE_MS && timestamp <= now + MAX_FUTURE_CLOCK_SKEW_MS
  );
}, "Timestamp is outside the accepted clock window.");

const eventBase = {
  actorId: canonicalUuid,
  deviceId: canonicalUuid,
  idempotencyKey: z.string().trim().min(contract.idempotencyKeyMin).max(contract.idempotencyKeyMax),
  type: z.string().trim().min(contract.eventTypeMin).max(contract.eventTypeMax),
  payload: boundedJson,
  occurredAt: edgeTimestamp,
};

const resourcePreconditionSchema = z
  .object({
    type: z.string().trim().min(contract.aggregateTypeMin).max(contract.aggregateTypeMax),
    id: canonicalUuid,
    occupancyEpoch: canonicalUuid,
    resourceVersion: z
      .number()
      .int()
      .min(contract.resourceVersionMin)
      .max(contract.resourceVersionMax),
  })
  .strict();

const priceReferenceSchema = z
  .object({
    kind: z
      .string()
      .refine((value): value is "product" | "modifier-option" =>
        contract.priceReferenceKinds.includes(value),
      ),
    entityId: canonicalUuid,
    priceRevision: z.string().trim().min(contract.priceRevisionMin).max(contract.priceRevisionMax),
    token: z.string().trim().min(contract.priceTokenMin).max(contract.priceTokenMax),
  })
  .strict();

export const legacySyncEventSchema = z
  .object({
    id: canonicalUuid,
    ...eventBase,
    version: z.number().int().min(contract.commandVersionMin).max(contract.commandVersionMax),
  })
  .strict()
  .refine(
    (event) => Buffer.byteLength(JSON.stringify(event), "utf8") <= MAX_SYNC_EVENT_BYTES,
    `Serialized event exceeds ${MAX_SYNC_EVENT_BYTES} bytes.`,
  );

export const syncEventSchema = z
  .object({
    commandId: canonicalUuid,
    ...eventBase,
    aggregate: z
      .object({
        type: z.string().trim().min(contract.aggregateTypeMin).max(contract.aggregateTypeMax),
        id: canonicalUuid,
      })
      .strict(),
    occupancyEpoch: canonicalUuid,
    resourceVersion: z
      .number()
      .int()
      .min(contract.resourceVersionMin)
      .max(contract.resourceVersionMax),
    aggregateSequence: z
      .number()
      .int()
      .min(contract.aggregateSequenceMin)
      .max(contract.aggregateSequenceMax),
    resourcePreconditions: z
      .array(resourcePreconditionSchema)
      .max(MAX_SYNC_RESOURCE_PRECONDITIONS)
      .default([]),
    priceReferences: z.array(priceReferenceSchema).max(MAX_SYNC_PRICE_REFERENCES).default([]),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.resourcePreconditions.length === 0) return;
    const keys = event.resourcePreconditions.map((resource) => `${resource.type}:${resource.id}`);
    const sorted = [...keys].sort();
    if (keys.some((key, index) => key !== sorted[index])) {
      context.addIssue({
        code: "custom",
        path: ["resourcePreconditions"],
        message: "Resource preconditions must be sorted.",
      });
    }
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["resourcePreconditions"],
        message: "Resource preconditions must be unique.",
      });
    }
    const referenceKeys = event.priceReferences.map(
      (reference) => `${reference.kind}:${reference.entityId}:${reference.priceRevision}`,
    );
    if (new Set(referenceKeys).size !== referenceKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["priceReferences"],
        message: "Price references must be unique by kind, entity and revision.",
      });
    }
    const primary = event.resourcePreconditions.find(
      (resource) => resource.type === event.aggregate.type && resource.id === event.aggregate.id,
    );
    if (
      !primary ||
      primary.occupancyEpoch !== event.occupancyEpoch ||
      primary.resourceVersion !== event.resourceVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["resourcePreconditions"],
        message: "Singular aggregate must match its vector entry.",
      });
    }
    if (Buffer.byteLength(JSON.stringify(event), "utf8") > MAX_SYNC_EVENT_BYTES) {
      context.addIssue({
        code: "custom",
        message: `Serialized event exceeds ${MAX_SYNC_EVENT_BYTES} bytes.`,
      });
    }
  });

const syncBatchBase = {
  hubVersion: z.string().trim().min(1).max(40),
  metadata: z
    .record(z.string().max(64), z.unknown())
    .refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 4_096)
    .default({}),
  acknowledgedCommandIds: z.array(canonicalUuid).max(MAX_SYNC_ACKNOWLEDGEMENTS).default([]),
};

const legacySyncBatchSchema = z
  .object({
    protocolVersion: z.literal(1),
    ...syncBatchBase,
    events: z.array(legacySyncEventSchema).max(MAX_SYNC_BATCH_EVENTS).default([]),
  })
  .strict();

const orderedSyncBatchSchema = z
  .object({
    protocolVersion: z.literal(2),
    ...syncBatchBase,
    events: z.array(syncEventSchema).max(MAX_SYNC_BATCH_EVENTS).default([]),
  })
  .strict();

export const syncBatchSchema = z
  .discriminatedUnion("protocolVersion", [legacySyncBatchSchema, orderedSyncBatchSchema])
  .refine(
    (batch) => Buffer.byteLength(JSON.stringify(batch), "utf8") <= MAX_SYNC_BATCH_BYTES,
    `Serialized sync batch exceeds ${MAX_SYNC_BATCH_BYTES} bytes.`,
  );

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
        resourcePreconditions: [],
        priceReferences: [],
      })),
    } as NormalizedSyncBatchInput;
  }
  return {
    ...batch,
    events: batch.events.map((event) => {
      const primary = {
        type: event.aggregate.type,
        id: event.aggregate.id,
        occupancyEpoch: event.occupancyEpoch,
        resourceVersion: event.resourceVersion,
      };
      return {
        ...event,
        resourcePreconditions:
          event.resourcePreconditions.length === 0 ? [primary] : event.resourcePreconditions,
        id: event.commandId,
        version: event.resourceVersion,
      };
    }),
  } as NormalizedSyncBatchInput;
}
