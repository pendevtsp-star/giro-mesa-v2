import { z } from "zod";
import { POSTGRES_INT4_MAX } from "../common/postgres-integers.js";

export const fiscalIssueSchema = z
  .object({
    saleReference: z.string().trim().min(1).max(160),
    documentType: z.enum(["nfce", "nfe"]),
    totalCents: z.number().int().positive().max(POSTGRES_INT4_MAX),
    document: z.record(z.string(), z.unknown()),
  })
  .strict();

export const fiscalCancelSchema = z.object({ reason: z.string().trim().min(15).max(240) }).strict();

export type FiscalIssueInput = z.infer<typeof fiscalIssueSchema>;
export type FiscalCancelInput = z.infer<typeof fiscalCancelSchema>;
