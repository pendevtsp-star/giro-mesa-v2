import { z } from "zod";

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

export const syncEventSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    deviceId: z.uuid(),
    idempotencyKey: z.string().trim().min(8).max(160),
    type: z.string().trim().min(3).max(100),
    payload: boundedJson,
    version: z.number().int().positive().max(100),
    occurredAt: edgeTimestamp,
  })
  .strict();

export const syncBatchSchema = z
  .object({
    protocolVersion: z.literal(1),
    hubVersion: z.string().trim().min(1).max(40),
    metadata: z
      .record(z.string().max(64), z.unknown())
      .refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 4_096)
      .default({}),
    acknowledgedCommandIds: z.array(z.uuid()).max(100).default([]),
    events: z.array(syncEventSchema).max(100).default([]),
  })
  .strict();

export type SyncBatchInput = z.infer<typeof syncBatchSchema>;
export type SyncEventInput = z.infer<typeof syncEventSchema>;
