import { z } from "zod";
import { POSTGRES_INT4_MAX } from "../common/postgres-integers.js";

const evidence = z.object({
  kind: z.enum(["document", "photo", "note", "reference"]),
  reference: z.string().trim().min(1).max(500),
  checksum: z.string().trim().min(1).max(160).optional(),
});

export const incidentReportSchema = z.object({
  incidentType: z.string().trim().min(3).max(48),
  neutralSummary: z.string().trim().min(15).max(1_000),
  evidence: z.array(evidence).max(50).default([]),
  amountCents: z.number().int().nonnegative().max(POSTGRES_INT4_MAX).optional(),
  occurredAt: z.string().datetime({ offset: true }),
});

export const incidentReviewSchema = z.object({
  neutralNote: z.string().trim().min(15).max(1_000),
});

export const incidentDecisionSchema = incidentReviewSchema.extend({
  decision: z.enum(["approved", "rejected"]),
});

export type IncidentReportInput = z.infer<typeof incidentReportSchema>;
export type IncidentReviewInput = z.infer<typeof incidentReviewSchema>;
export type IncidentDecisionInput = z.infer<typeof incidentDecisionSchema>;
