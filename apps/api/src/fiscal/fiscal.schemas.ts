import { z } from "zod";

export const fiscalIssueSchema = z
  .object({
    saleReference: z.string().trim().min(1).max(160),
    documentType: z.enum(["nfce", "nfe"]),
    totalCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    document: z.record(z.string(), z.unknown()),
  })
  .strict();

export const fiscalCancelSchema = z.object({ reason: z.string().trim().min(15).max(240) }).strict();

export type FiscalIssueInput = z.infer<typeof fiscalIssueSchema>;
export type FiscalCancelInput = z.infer<typeof fiscalCancelSchema>;
