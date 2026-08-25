import type { Database } from "@giromesa/db";
import { hasPermission, SYSTEM_ROLES, type SystemRole } from "@giromesa/domain";
import { sql } from "drizzle-orm";
import {
  deliverEmail,
  EmailDeliveryError,
  type EmailMessage,
  type EmailProviderConfiguration,
  emailHtml,
  emailProviderConfiguration,
} from "./email.js";
import type { ClaimedOutboxEvent } from "./outbox.js";

type AccountingNotificationTopic = "accounting.request.created" | "accounting.request.resolved";
type Recipient = { identityId: string; displayName: string; email: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function eventContext(event: ClaimedOutboxEvent) {
  const topic = event.topic as AccountingNotificationTopic;
  const organizationId = event.payload.organizationId;
  const unitId = event.payload.unitId;
  const requestId = event.payload.requestId;
  const targetAudience = event.payload.targetAudience;
  if (
    !["accounting.request.created", "accounting.request.resolved"].includes(topic) ||
    event.aggregate_type !== "accountant_request" ||
    typeof organizationId !== "string" ||
    typeof unitId !== "string" ||
    typeof requestId !== "string" ||
    (targetAudience !== "accountant" && targetAudience !== "establishment") ||
    !UUID.test(organizationId) ||
    !UUID.test(unitId) ||
    !UUID.test(requestId) ||
    event.aggregate_id !== requestId
  ) {
    throw new EmailDeliveryError("ACCOUNTING_NOTIFICATION_EVENT_INVALID", false);
  }
  return { topic, organizationId, unitId, requestId, targetAudience };
}

export function accountingNotificationMessage(
  topic: AccountingNotificationTopic,
  eventId: string,
  recipient: Recipient,
  organizationName: string,
  appUrl: string,
): EmailMessage {
  const created = topic === "accounting.request.created";
  const actionUrl = `${appUrl}/#/accountant`;
  const body = created
    ? `Há uma nova solicitação contábil de ${organizationName}. Consulte a competência, o prazo e os detalhes no Portal do contador.`
    : `Uma solicitação contábil de ${organizationName} recebeu uma resposta. Consulte o histórico no Portal do contador.`;
  return {
    to: recipient.email,
    subject: created
      ? `Nova solicitação contábil — ${organizationName}`
      : `Solicitação contábil respondida — ${organizationName}`,
    html: emailHtml({
      title: created ? "Nova solicitação contábil" : "Solicitação contábil respondida",
      greeting: `Olá, ${recipient.displayName}.`,
      body,
      actionLabel: "Abrir Portal do contador",
      actionUrl,
      footer: "Os detalhes ficam disponíveis somente após autenticação no GiroMesa.",
    }),
    text: `Olá, ${recipient.displayName}.\n\n${body}\n\n${actionUrl}\n\nOs detalhes ficam disponíveis somente após autenticação no GiroMesa.`,
    idempotencyKey: `accounting-request/${created ? "created" : "resolved"}/${eventId}/${recipient.identityId}`,
    tags: [
      {
        name: "message_type",
        value: created ? "accounting_request_created" : "accounting_request_resolved",
      },
    ],
  };
}

export async function deliverAccountingRequestNotification(
  db: Database,
  event: ClaimedOutboxEvent,
  options: {
    send?: typeof deliverEmail;
    configuration?: EmailProviderConfiguration;
  } = {},
) {
  const context = eventContext(event);
  const [request] = await db.execute<{
    status: "open" | "resolved";
    organization_name: string;
    created_by_identity_id: string;
    resolved_by_identity_id: string | null;
    target_audience: "accountant" | "establishment";
  }>(sql`
    select requests.status,
           organizations.trade_name as organization_name,
           requests.created_by_identity_id,
           requests.resolved_by_identity_id,
           requests.target_audience
    from accountant_requests requests
    inner join organizations on organizations.id = requests.organization_id
    where requests.organization_id = ${context.organizationId}
      and requests.unit_id = ${context.unitId}
      and requests.id = ${context.requestId}
    limit 1
  `);
  if (!request) throw new EmailDeliveryError("ACCOUNTING_REQUEST_NOT_FOUND", false);
  if (context.targetAudience !== request.target_audience) {
    throw new EmailDeliveryError("ACCOUNTING_NOTIFICATION_AUDIENCE_MISMATCH", false);
  }
  if (
    (context.topic === "accounting.request.created" && request.status !== "open") ||
    (context.topic === "accounting.request.resolved" && request.status !== "resolved")
  ) {
    return { delivered: 0, stale: true };
  }
  const actorIdentityId =
    context.topic === "accounting.request.created"
      ? request.created_by_identity_id
      : request.resolved_by_identity_id;
  if (!actorIdentityId) {
    throw new EmailDeliveryError("ACCOUNTING_NOTIFICATION_ACTOR_NOT_FOUND", false);
  }
  const audience =
    context.topic === "accounting.request.created"
      ? request.target_audience
      : request.target_audience === "accountant"
        ? "establishment"
        : "accountant";

  const rows = await db.execute<Recipient & { role: string }>(sql`
    select distinct identities.id as "identityId",
           identities.display_name as "displayName",
           identities.email,
           bindings.role::text as role
    from memberships
    inner join identities on identities.id = memberships.identity_id
    inner join role_bindings bindings on bindings.membership_id = memberships.id
    where memberships.organization_id = ${context.organizationId}
      and memberships.status = 'active'
      and identities.disabled_at is null
      and (bindings.unit_id is null or bindings.unit_id = ${context.unitId})
      and identities.id <> ${actorIdentityId}
    order by identities.id, bindings.role::text
  `);
  const recipients = new Map<string, Recipient>();
  for (const row of rows) {
    const authorized =
      SYSTEM_ROLES.includes(row.role as SystemRole) &&
      hasPermission(row.role as SystemRole, "accounting:requests:read");
    const inAudience =
      audience === "accountant"
        ? row.role === "accountant"
        : row.role !== "accountant" && authorized;
    const intendedRecipient =
      context.topic === "accounting.request.created" ||
      row.identityId === request.created_by_identity_id;
    if (authorized && inAudience && intendedRecipient) {
      recipients.set(row.identityId, row);
    }
  }
  if (recipients.size === 0) return { delivered: 0, stale: false };

  const configuration = options.configuration ?? emailProviderConfiguration();
  const send = options.send ?? deliverEmail;
  for (const recipient of recipients.values()) {
    await send(
      accountingNotificationMessage(
        context.topic,
        event.id,
        recipient,
        request.organization_name,
        configuration.appUrl,
      ),
      { configuration },
    );
  }
  return { delivered: recipients.size, stale: false };
}
