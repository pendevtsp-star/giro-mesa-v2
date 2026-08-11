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
  targetType: "organization" | "membership";
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

export function platformActionTargetType(action: PlatformActionName) {
  return action.startsWith("tenant.") ? ("organization" as const) : ("membership" as const);
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
    version: requiredVersion(metadata),
    requestedAt: proposed.occurredAt.toISOString(),
    expiresAt,
  };
  for (const transition of transitions) {
    const version = requiredVersion(transition.metadata);
    if (version !== snapshot.version + 1) throw new Error("INVALID_ACTION_LEDGER");
    const status = requiredString(transition.metadata, "status") as PlatformActionStatus;
    if (!(["approved", "executed", "rejected", "expired", "failed"] as string[]).includes(status))
      throw new Error("INVALID_ACTION_LEDGER");
    if (snapshot.status !== "pending" && !(snapshot.status === "approved" && status === "executed"))
      throw new Error("INVALID_ACTION_LEDGER");
    snapshot = {
      ...snapshot,
      status,
      version,
      decidedByIdentityId: transition.actorIdentityId ?? undefined,
      decidedAt: transition.occurredAt.toISOString(),
      failureCode:
        status === "failed" ? requiredString(transition.metadata, "failureCode") : undefined,
    };
  }
  return snapshot;
}
