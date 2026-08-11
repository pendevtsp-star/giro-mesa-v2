import { z } from "zod";

export const paymentIntentSchema = z
  .object({
    sourceType: z.string().trim().min(1).max(48),
    sourceId: z.string().trim().min(1).max(160),
    amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const paymentAttemptSchema = z
  .object({
    amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
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

export type PaymentIntentInput = z.infer<typeof paymentIntentSchema>;
export type PaymentAttemptInput = z.infer<typeof paymentAttemptSchema>;
export type PaymentManualReviewInput = z.infer<typeof paymentManualReviewSchema>;
