import { z } from "zod";
import { POSTGRES_INT4_MAX } from "../common/postgres-integers.js";

export const paymentIntentSchema = z
  .object({
    sourceType: z.string().trim().min(1).max(48),
    sourceId: z.string().trim().min(1).max(160),
    amountCents: z.number().int().positive().max(POSTGRES_INT4_MAX),
  })
  .strict();

export const paymentAttemptSchema = z
  .object({
    amountCents: z.number().int().positive().max(POSTGRES_INT4_MAX),
    method: z.enum(["credit", "debit", "pix"]),
    terminalId: z.uuid().optional(),
  })
  .strict();

export const paymentManualReviewSchema = z
  .object({
    status: z.enum(["authorized", "declined"]),
    reason: z.string().trim().min(10).max(240),
  })
  .strict();

export const paymentProviderCallbackSchema = z
  .object({
    organizationId: z.uuid(),
    unitId: z.uuid(),
    attemptId: z.uuid(),
    providerEventId: z.string().trim().min(1).max(160),
    status: z.enum(["authorized", "declined", "unknown"]),
    providerReference: z.string().trim().min(1).max(160).optional(),
    amountCents: z.number().int().positive().max(POSTGRES_INT4_MAX).optional(),
    safePayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type PaymentIntentInput = z.infer<typeof paymentIntentSchema>;
export type PaymentAttemptInput = z.infer<typeof paymentAttemptSchema>;
export type PaymentManualReviewInput = z.infer<typeof paymentManualReviewSchema>;
export type PaymentProviderCallbackInput = z.infer<typeof paymentProviderCallbackSchema>;
