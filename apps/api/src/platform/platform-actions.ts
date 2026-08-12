import { createHash } from "node:crypto";
import { z } from "zod";
import type { PlatformActionName } from "./platform-access.js";

const uuid = z.string().uuid();
const justification = z.string().trim().min(20).max(500);
const suspendableBillingState = z.enum([
  "draft",
  "onboarding",
  "trial_active",
  "active",
  "grace",
  "restricted",
]);

const inputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("tenant.suspend"),
      targetId: uuid,
      justification,
      payload: z.object({ expectedState: suspendableBillingState }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("tenant.restore"),
      targetId: uuid,
      justification,
      payload: z
        .object({ expectedState: z.literal("suspended"), restoreTo: suspendableBillingState })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("membership.disable"),
      targetId: uuid,
      justification,
      payload: z.object({ expectedState: z.literal("active") }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("membership.restore"),
      targetId: uuid,
      justification,
      payload: z.object({ expectedState: z.literal("disabled") }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("incident.review"),
      targetId: uuid,
      justification,
      payload: z.object({ expectedState: z.literal("reported"), unitId: uuid }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("incident.approve"),
      targetId: uuid,
      justification,
      payload: z.object({ expectedState: z.literal("under_review"), unitId: uuid }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("incident.reject"),
      targetId: uuid,
      justification,
      payload: z.object({ expectedState: z.literal("under_review"), unitId: uuid }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("incident.close"),
      targetId: uuid,
      justification,
      payload: z.object({ expectedState: z.enum(["approved", "rejected"]), unitId: uuid }).strict(),
    })
    .strict(),
]);

export type PlatformActionInput = z.infer<typeof inputSchema>;
export type PlatformActionStatus =
  | "pending"
  | "approved"
  | "executed"
  | "rejected"
  | "expired"
  | "failed";

export interface PlatformActionSnapshot {
  id: string;
  organizationId: string;
  action: PlatformActionName;
  targetType: "organization" | "membership" | "incident";
  targetId: string;
  requestedByIdentityId: string;
  justification: string;
  payload: Record<string, string>;
  status: PlatformActionStatus;
  version: number;
  requestedAt: string;
  expiresAt: string;
  decidedByIdentityId?: string;
  decidedAt?: string;
  failureCode?: string;
}

export function parsePlatformActionInput(value: unknown): PlatformActionInput {
  const result = inputSchema.safeParse(value);
  if (!result.success) throw new Error("INVALID_PLATFORM_ACTION");
  return result.data;
}

export function actionRequestFingerprint(organizationId: string, input: PlatformActionInput) {
  const normalized = {
    organizationId,
    action: input.action,
    targetId: input.targetId,
    justification: input.justification.trim(),
    payload: input.payload,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function decisionRequestFingerprint(input: {
  organizationId: string;
  proposalId: string;
  command: "approve" | "reject";
  expectedVersion: number;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function platformActionTargetType(action: PlatformActionName) {
  if (action.startsWith("tenant.")) return "organization" as const;
  if (action.startsWith("incident.")) return "incident" as const;
  return "membership" as const;
}

export function assertPlatformActionTransition(
  snapshot: PlatformActionSnapshot,
  input: {
    command: "approve" | "reject";
    actorIdentityId: string;
    expectedVersion: number;
    now: Date;
  },
) {
  if (snapshot.version !== input.expectedVersion)
    throw new Error("PLATFORM_ACTION_VERSION_CONFLICT");
  if (snapshot.status !== "pending") throw new Error("PLATFORM_ACTION_TERMINAL");
  if (new Date(snapshot.expiresAt).getTime() <= input.now.getTime())
    throw new Error("PLATFORM_ACTION_EXPIRED");
  if (input.command === "approve" && snapshot.requestedByIdentityId === input.actorIdentityId)
    throw new Error("DUAL_CONTROL_REQUIRED");
  return true;
}

interface PlatformAuditActionEvent {
  action: string;
  actorIdentityId: string | null;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error("INVALID_ACTION_LEDGER");
  return value;
}

function requiredVersion(record: Record<string, unknown>) {
  const value = record.version;
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error("INVALID_ACTION_LEDGER");
  return value as number;
}

export function platformActionFromAuditEvents(
  organizationId: string,
  proposalId: string,
  events: PlatformAuditActionEvent[],
): PlatformActionSnapshot {
  const [proposed, ...transitions] = events;
  if (proposed?.action !== "platform.action.proposed" || !proposed.actorIdentityId)
    throw new Error("INVALID_ACTION_LEDGER");
  const metadata = proposed.metadata;
  const action = requiredString(metadata, "action") as PlatformActionName;
  const targetId = requiredString(metadata, "targetId");
  const targetType = requiredString(metadata, "targetType");
  const expiresAt = requiredString(metadata, "expiresAt");
  const request = parsePlatformActionInput({
    action,
    targetId,
    justification: requiredString(metadata, "justification"),
    payload: metadata.payload,
  });
  if (targetType !== platformActionTargetType(action)) throw new Error("INVALID_ACTION_LEDGER");
  if (requiredVersion(metadata) !== 1 || metadata.status !== "pending")
    throw new Error("INVALID_ACTION_LEDGER");
  let snapshot: PlatformActionSnapshot = {
    id: proposalId,
    organizationId,
    action,
    targetType,
    targetId,
    requestedByIdentityId: proposed.actorIdentityId,
    justification: request.justification,
    payload: request.payload,
    status: "pending",
    version: 1,
    requestedAt: proposed.occurredAt.toISOString(),
    expiresAt,
  };
  for (const transition of transitions) {
    const version = requiredVersion(transition.metadata);
    if (version !== snapshot.version + 1) throw new Error("INVALID_ACTION_LEDGER");
    const status = requiredString(transition.metadata, "status") as PlatformActionStatus;
    if (!(["approved", "executed", "rejected", "expired", "failed"] as string[]).includes(status))
      throw new Error("INVALID_ACTION_LEDGER");
    if (transition.action !== `platform.action.${status}`) throw new Error("INVALID_ACTION_LEDGER");
    const actorIdentityId = transition.actorIdentityId ?? undefined;
    if (status === "approved") {
      if (
        snapshot.status !== "pending" ||
        !actorIdentityId ||
        actorIdentityId === snapshot.requestedByIdentityId
      )
        throw new Error("INVALID_ACTION_LEDGER");
    } else if (status === "executed") {
      if (
        snapshot.status !== "approved" ||
        !actorIdentityId ||
        actorIdentityId !== snapshot.decidedByIdentityId
      )
        throw new Error("INVALID_ACTION_LEDGER");
    } else if (snapshot.status !== "pending" || (status !== "expired" && !actorIdentityId)) {
      throw new Error("INVALID_ACTION_LEDGER");
    }
    snapshot = {
      ...snapshot,
      status,
      version,
      decidedByIdentityId: actorIdentityId ?? snapshot.decidedByIdentityId,
      decidedAt: transition.occurredAt.toISOString(),
      failureCode:
        status === "failed" ? requiredString(transition.metadata, "failureCode") : undefined,
    };
  }
  return snapshot;
}
