import { z } from "zod";

export const billingIdempotencyKeySchema = z.string().trim().min(8).max(160);

export const asaasWebhookSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    event: z.string().trim().min(1).max(100),
  })
  .loose();

export type AsaasWebhookInput = z.infer<typeof asaasWebhookSchema>;
