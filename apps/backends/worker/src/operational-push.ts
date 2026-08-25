import {
  authSessions,
  type Database,
  identities,
  memberships,
  posDiningTables,
  posOperationalPushSubscriptions,
  posServiceCalls,
  roleBindings,
} from "@giromesa/db";
import { decryptSecret, encryptionKey } from "@giromesa/domain";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import webPush, { type PushSubscription } from "web-push";
import type { ClaimedOutboxEvent } from "./outbox.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATIONAL_ROLES = [
  "owner",
  "manager",
  "waiter",
  "cashier",
  "receptionist",
  "busser",
] as const;

export class OperationalPushDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

function requiredUuid(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new OperationalPushDeliveryError("WEB_PUSH_EVENT_INVALID", false);
  }
  return value;
}

function vapidConfiguration() {
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim() ?? "";
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "";
  if (
    !/^mailto:.+@.+|^https:\/\/.+/.test(subject) ||
    !/^[A-Za-z0-9_-]{87}$/.test(publicKey) ||
    !/^[A-Za-z0-9_-]{43}$/.test(privateKey)
  ) {
    throw new OperationalPushDeliveryError("WEB_PUSH_VAPID_NOT_CONFIGURED", false);
  }
  return { subject, publicKey, privateKey };
}

function parseSubscription(value: string): PushSubscription {
  try {
    const parsed = JSON.parse(value) as PushSubscription;
    if (
      typeof parsed.endpoint !== "string" ||
      typeof parsed.keys?.p256dh !== "string" ||
      typeof parsed.keys.auth !== "string"
    ) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new OperationalPushDeliveryError("WEB_PUSH_SUBSCRIPTION_INVALID", false);
  }
}

function statusCode(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : null;
}

export function operationalPushFailureDisposition(status: number | null) {
  if (status === 404 || status === 410) return "expired" as const;
  if (status === null || status === 429 || status >= 500) return "retry" as const;
  if (status === 401 || status === 403) return "configuration" as const;
  return "disable" as const;
}

export function operationalPushMessage(
  callId: string,
  tableLabel: string,
  kind: "assistance" | "bill" | "water" | "other",
) {
  const label = tableLabel.slice(0, 40);
  return {
    title:
      kind === "bill"
        ? `${label} pediu a conta`
        : kind === "water"
          ? `${label} pediu água`
          : `${label} chamou o atendimento`,
    body: "Abra a Central Operacional para assumir o chamado.",
    tag: `call:${callId}`,
    route: kind === "bill" ? "#/counter" : "#/salon",
  };
}

export interface OperationalPushResult {
  kind: "operational-push";
  organizationId: string;
  unitId: string;
  callId: string;
  delivered: number;
  expired: number;
}

export async function deliverOperationalPush(
  db: Database,
  event: ClaimedOutboxEvent,
  send = webPush.sendNotification.bind(webPush),
): Promise<OperationalPushResult | undefined> {
  const organizationId = requiredUuid(event.payload, "organizationId");
  const unitId = requiredUuid(event.payload, "unitId");
  const callId = requiredUuid(event.payload, "callId");
  const tableId = requiredUuid(event.payload, "tableId");
  const responsibleValue = event.payload.responsibleIdentityId;
  const responsibleIdentityId =
    responsibleValue === null || responsibleValue === undefined
      ? null
      : typeof responsibleValue === "string" && UUID.test(responsibleValue)
        ? responsibleValue
        : (() => {
            throw new OperationalPushDeliveryError("WEB_PUSH_EVENT_INVALID", false);
          })();
  const [call] = await db
    .select({
      status: posServiceCalls.status,
      kind: posServiceCalls.kind,
      tableLabel: posDiningTables.label,
    })
    .from(posServiceCalls)
    .innerJoin(
      posDiningTables,
      and(
        eq(posDiningTables.organizationId, posServiceCalls.organizationId),
        eq(posDiningTables.unitId, posServiceCalls.unitId),
        eq(posDiningTables.id, posServiceCalls.tableId),
      ),
    )
    .where(
      and(
        eq(posServiceCalls.organizationId, organizationId),
        eq(posServiceCalls.unitId, unitId),
        eq(posServiceCalls.id, callId),
        eq(posServiceCalls.tableId, tableId),
      ),
    )
    .limit(1);
  if (call?.status !== "open") return undefined;

  const expiredRows = await db
    .delete(posOperationalPushSubscriptions)
    .where(
      and(
        eq(posOperationalPushSubscriptions.organizationId, organizationId),
        eq(posOperationalPushSubscriptions.unitId, unitId),
        lte(posOperationalPushSubscriptions.subscriptionExpiresAt, new Date()),
      ),
    )
    .returning({ installationId: posOperationalPushSubscriptions.installationId });

  const subscriptions = await db
    .select({
      installationId: posOperationalPushSubscriptions.installationId,
      encryptedSubscription: posOperationalPushSubscriptions.encryptedSubscription,
      encryptionIv: posOperationalPushSubscriptions.encryptionIv,
      encryptionAuthTag: posOperationalPushSubscriptions.encryptionAuthTag,
    })
    .from(posOperationalPushSubscriptions)
    .innerJoin(authSessions, eq(authSessions.id, posOperationalPushSubscriptions.sessionId))
    .innerJoin(identities, eq(identities.id, posOperationalPushSubscriptions.identityId))
    .innerJoin(
      memberships,
      and(
        eq(memberships.identityId, posOperationalPushSubscriptions.identityId),
        eq(memberships.organizationId, posOperationalPushSubscriptions.organizationId),
      ),
    )
    .where(
      and(
        eq(posOperationalPushSubscriptions.organizationId, organizationId),
        eq(posOperationalPushSubscriptions.unitId, unitId),
        eq(posOperationalPushSubscriptions.enabled, true),
        responsibleIdentityId
          ? eq(posOperationalPushSubscriptions.identityId, responsibleIdentityId)
          : undefined,
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
        isNull(identities.disabledAt),
        eq(memberships.status, "active"),
        or(
          isNull(posOperationalPushSubscriptions.subscriptionExpiresAt),
          gt(posOperationalPushSubscriptions.subscriptionExpiresAt, new Date()),
        ),
        sql`exists (
          select 1 from ${roleBindings} as push_role
          where push_role.membership_id = ${memberships.id}
            and (push_role.unit_id is null or push_role.unit_id = ${unitId})
            and push_role.role in (${sql.join(
              OPERATIONAL_ROLES.map((role) => sql`${role}`),
              sql`, `,
            )})
        )`,
      ),
    );
  if (subscriptions.length === 0) {
    return {
      kind: "operational-push",
      organizationId,
      unitId,
      callId,
      delivered: 0,
      expired: expiredRows.length,
    };
  }

  const vapid = vapidConfiguration();
  try {
    webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  } catch {
    throw new OperationalPushDeliveryError("WEB_PUSH_VAPID_INVALID", false);
  }
  let key: Buffer;
  try {
    key = encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY");
  } catch {
    throw new OperationalPushDeliveryError("WEB_PUSH_ENCRYPTION_KEY_INVALID", false);
  }
  const payload = JSON.stringify(operationalPushMessage(callId, call.tableLabel, call.kind));
  let delivered = 0;
  let expired = expiredRows.length;
  let retryableFailure = false;
  for (const subscription of subscriptions) {
    let parsed: PushSubscription;
    try {
      parsed = parseSubscription(
        decryptSecret(
          {
            encryptedSecret: subscription.encryptedSubscription,
            iv: subscription.encryptionIv,
            authTag: subscription.encryptionAuthTag,
          },
          key,
          `web-push:${subscription.installationId}`,
        ),
      );
    } catch {
      await db
        .update(posOperationalPushSubscriptions)
        .set({
          enabled: false,
          lastFailedAt: new Date(),
          lastFailureCode: "WEB_PUSH_SUBSCRIPTION_INVALID",
          updatedAt: new Date(),
        })
        .where(eq(posOperationalPushSubscriptions.installationId, subscription.installationId));
      continue;
    }
    try {
      await send(parsed, payload, {
        TTL: 120,
        urgency: "high",
        topic: callId.replaceAll("-", ""),
      });
      delivered += 1;
      await db
        .update(posOperationalPushSubscriptions)
        .set({
          lastDeliveredAt: new Date(),
          lastFailedAt: null,
          lastFailureCode: null,
          updatedAt: new Date(),
        })
        .where(eq(posOperationalPushSubscriptions.installationId, subscription.installationId));
    } catch (error) {
      const status = statusCode(error);
      const disposition = operationalPushFailureDisposition(status);
      if (disposition === "expired") {
        expired += 1;
        await db
          .delete(posOperationalPushSubscriptions)
          .where(eq(posOperationalPushSubscriptions.installationId, subscription.installationId));
        continue;
      }
      await db
        .update(posOperationalPushSubscriptions)
        .set({
          lastFailedAt: new Date(),
          lastFailureCode: status ? `WEB_PUSH_HTTP_${status}` : "WEB_PUSH_NETWORK_ERROR",
          updatedAt: new Date(),
        })
        .where(eq(posOperationalPushSubscriptions.installationId, subscription.installationId));
      if (disposition === "retry") retryableFailure = true;
      else if (disposition === "configuration") {
        throw new OperationalPushDeliveryError(`WEB_PUSH_HTTP_${status}`, false);
      } else {
        await db
          .update(posOperationalPushSubscriptions)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(posOperationalPushSubscriptions.installationId, subscription.installationId));
      }
    }
  }
  if (retryableFailure) {
    throw new OperationalPushDeliveryError("WEB_PUSH_DELIVERY_RETRY_REQUIRED", true);
  }
  return { kind: "operational-push", organizationId, unitId, callId, delivered, expired };
}
