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

const commandResultErrorCodeSchema = z.string().trim().min(1).max(120).nullable().optional();

export const cloudCommandResultSchema = z.discriminatedUnion("type", [
  z
    .object({
      commandId: z.uuid(),
      type: z.literal("print_job.execute"),
      cloudPrintJobId: z.uuid().nullable().optional(),
      localPrintJobId: z.uuid().nullable().optional(),
      printerId: z.uuid().nullable().optional(),
      status: z.enum(["printed", "failed", "confirmation_required"]),
      errorCode: commandResultErrorCodeSchema,
      duplicate: z.boolean().optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (input.status !== "failed" && !input.cloudPrintJobId) {
        context.addIssue({
          code: "custom",
          path: ["cloudPrintJobId"],
          message: "cloudPrintJobId é obrigatório para resultado concluído ou indeterminado.",
        });
      }
      if (
        input.status === "confirmation_required" &&
        input.errorCode !== "PRINTER_RESULT_UNKNOWN"
      ) {
        context.addIssue({
          code: "custom",
          path: ["errorCode"],
          message: "PRINTER_RESULT_UNKNOWN é obrigatório para resultado indeterminado.",
        });
      }
    }),
  z
    .object({
      commandId: z.uuid(),
      type: z.enum(["printer.configuration.upsert", "printer.configuration.archive"]),
      printerId: z.uuid().nullable().optional(),
      revision: z.number().int().min(0).nullable().optional(),
      status: z.enum(["applied", "failed"]),
      errorCode: commandResultErrorCodeSchema,
      duplicate: z.boolean().optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (input.status === "applied" && (!input.printerId || !input.revision)) {
        context.addIssue({
          code: "custom",
          path: [!input.printerId ? "printerId" : "revision"],
          message: "printerId e revision positiva são obrigatórios para configuração aplicada.",
        });
      }
    }),
  z
    .object({
      commandId: z.uuid(),
      type: z.literal("printer.test"),
      printerId: z.uuid().nullable().optional(),
      revision: z.number().int().min(0).nullable().optional(),
      status: z.enum(["printed", "failed", "confirmation_required"]),
      errorCode: commandResultErrorCodeSchema,
      duplicate: z.boolean().optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (input.status !== "failed" && (!input.printerId || !input.revision)) {
        context.addIssue({
          code: "custom",
          path: [!input.printerId ? "printerId" : "revision"],
          message: "printerId e revision positiva são obrigatórios para teste concluído.",
        });
      }
      if (
        input.status === "confirmation_required" &&
        input.errorCode !== "PRINTER_RESULT_UNKNOWN"
      ) {
        context.addIssue({
          code: "custom",
          path: ["errorCode"],
          message: "PRINTER_RESULT_UNKNOWN é obrigatório para resultado indeterminado.",
        });
      }
    }),
]);

export const syncBatchSchema = z
  .object({
    protocolVersion: z.literal(1),
    hubVersion: z.string().trim().min(1).max(40),
    metadata: z
      .record(z.string().max(64), z.unknown())
      .refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 4_096)
      .default({}),
    acknowledgedCommandIds: z.array(z.uuid()).max(100).default([]),
    commandResults: z.array(cloudCommandResultSchema).max(100).default([]),
    events: z.array(syncEventSchema).max(100).default([]),
  })
  .strict();

type ParsedSyncBatchInput = z.infer<typeof syncBatchSchema>;
export type SyncBatchInput = Omit<ParsedSyncBatchInput, "commandResults"> & {
  commandResults?: ParsedSyncBatchInput["commandResults"];
};
export type SyncEventInput = z.infer<typeof syncEventSchema>;
export type CloudCommandResultInput = z.infer<typeof cloudCommandResultSchema>;
