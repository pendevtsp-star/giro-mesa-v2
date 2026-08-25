import { accountantRequests, auditEvents, type Database, deleteFiscalArtifact } from "@giromesa/db";
import { eq, sql } from "drizzle-orm";

type Attachment = (typeof accountantRequests.$inferSelect.attachments)[number];

export function accountantAttachmentDueForPurge(attachment: Attachment, now: Date) {
  if (attachment.legalHold || attachment.purgedAt) return false;
  if (attachment.deletedAt) return true;
  if (!attachment.retentionUntil) return false;
  const retentionUntil = new Date(attachment.retentionUntil);
  return !Number.isNaN(retentionUntil.valueOf()) && retentionUntil <= now;
}

export async function purgeExpiredAccountantAttachments(
  database: Database,
  options: { mediaRoot?: string; now?: Date; limit?: number } = {},
) {
  const now = options.now ?? new Date();
  const rows = await database.execute<{
    id: string;
    organization_id: string;
    unit_id: string;
  }>(sql`
    select requests.id, requests.organization_id, requests.unit_id
    from accountant_requests as requests
    where exists (
      select 1
      from jsonb_array_elements(requests.attachments) as attachment
      where coalesce((attachment->>'legalHold')::boolean, false) = false
        and attachment->>'purgedAt' is null
        and (
          attachment->>'deletedAt' is not null
          or (
            attachment->>'retentionUntil' is not null
            and (attachment->>'retentionUntil')::timestamptz <= ${now.toISOString()}::timestamptz
          )
        )
    )
    order by requests.updated_at
    limit ${options.limit ?? 100}
  `);

  let purged = 0;
  for (const row of rows) {
    const candidates = await database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`accountant-request:${row.organization_id}:${row.unit_id}:${row.id}`}, 0))`,
      );
      const [request] = await tx
        .select({ attachments: accountantRequests.attachments })
        .from(accountantRequests)
        .where(eq(accountantRequests.id, row.id))
        .for("update")
        .limit(1);
      if (!request) return [];
      const candidates = request.attachments.filter((attachment) =>
        accountantAttachmentDueForPurge(attachment, now),
      );
      if (candidates.length === 0) return [];
      const candidateIds = new Set(candidates.map((attachment) => attachment.id));
      const deletedAt = now.toISOString();
      await tx
        .update(accountantRequests)
        .set({
          attachments: request.attachments.map((attachment) =>
            candidateIds.has(attachment.id)
              ? { ...attachment, deletedAt: attachment.deletedAt ?? deletedAt }
              : attachment,
          ),
          updatedAt: now,
        })
        .where(eq(accountantRequests.id, row.id));
      return candidates;
    });

    for (const attachment of candidates) {
      await deleteFiscalArtifact(options.mediaRoot, attachment.storageKey);
      await database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`accountant-request:${row.organization_id}:${row.unit_id}:${row.id}`}, 0))`,
        );
        const [request] = await tx
          .select({ attachments: accountantRequests.attachments })
          .from(accountantRequests)
          .where(eq(accountantRequests.id, row.id))
          .for("update")
          .limit(1);
        if (!request) return;
        const current = request.attachments.find((candidate) => candidate.id === attachment.id);
        if (!current || current.purgedAt) return;
        const purgedAt = now.toISOString();
        await tx
          .update(accountantRequests)
          .set({
            attachments: request.attachments.map((candidate) =>
              candidate.id === attachment.id ? { ...candidate, purgedAt } : candidate,
            ),
            updatedAt: now,
          })
          .where(eq(accountantRequests.id, row.id));
        await tx.insert(auditEvents).values({
          organizationId: row.organization_id,
          unitId: row.unit_id,
          action: "accounting.request.attachment.purged",
          entityType: "accountant_request",
          entityId: row.id,
          metadata: { attachmentId: attachment.id, sha256: attachment.sha256 },
        });
        purged += 1;
      });
    }
  }
  return purged;
}
