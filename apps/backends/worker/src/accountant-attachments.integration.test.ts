import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import {
  accountantRequests,
  auditEvents,
  createDatabase,
  identities,
  organizations,
  readFiscalArtifact,
  units,
  writeFiscalArtifact,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { purgeExpiredAccountantAttachments } from "./accountant-attachments.js";

it("tombstones and deletes expired accountant attachments", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL ?? process.env.FISCAL_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL or FISCAL_DATABASE_URL not configured");
    return;
  }
  const connection = createDatabase(databaseUrl);
  const mediaRoot = await mkdtemp(join(tmpdir(), "giromesa-accountant-retention-"));
  const organizationId = randomUUID();
  const unitId = randomUUID();
  const identityId = randomUUID();
  const requestId = randomUUID();
  try {
    await connection.db.insert(identities).values({
      id: identityId,
      email: `retention-${identityId}@example.test`,
      displayName: "Retention Test",
    });
    await connection.db.insert(organizations).values({
      id: organizationId,
      legalName: "Retention Test Ltda",
      tradeName: "Retention Test",
      document: organizationId.replaceAll("-", "").slice(0, 14),
    });
    await connection.db.insert(units).values({ id: unitId, organizationId, name: "Retention" });
    const content = Buffer.from("campo;valor\ncompetencia;2026-08");
    const stored = await writeFiscalArtifact({
      root: mediaRoot,
      organizationId,
      unitId,
      namespace: "packages",
      entityId: requestId,
      name: "request_attachment",
      extension: "zip",
      content,
    });
    const attachmentId = randomUUID();
    await connection.db.insert(accountantRequests).values({
      id: requestId,
      organizationId,
      unitId,
      createdByIdentityId: identityId,
      idempotencyKey: `retention-${randomUUID()}`,
      competence: "2026-08-01",
      title: "Retention",
      description: "Retention",
      targetAudience: "accountant",
      attachments: [
        {
          id: attachmentId,
          fileName: "documento.csv",
          contentType: "text/csv",
          sizeBytes: stored.bytes,
          sha256: stored.sha256,
          storageKey: stored.storageKey,
          createdAt: "2026-01-01T00:00:00.000Z",
          uploadedByIdentityId: identityId,
          retentionUntil: "2026-02-01T00:00:00.000Z",
          legalHold: false,
        },
      ],
    });

    assert.equal(
      await purgeExpiredAccountantAttachments(connection.db, {
        mediaRoot,
        now: new Date("2026-03-01T00:00:00.000Z"),
      }),
      1,
    );
    const [request] = await connection.db
      .select({ attachments: accountantRequests.attachments })
      .from(accountantRequests)
      .where(eq(accountantRequests.id, requestId));
    assert.ok(request?.attachments[0]?.deletedAt);
    assert.ok(request?.attachments[0]?.purgedAt);
    await assert.rejects(readFiscalArtifact(mediaRoot, stored.storageKey));
    const [audit] = await connection.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.action, "accounting.request.attachment.purged"),
        ),
      );
    assert.ok(audit);
  } finally {
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(identities).where(eq(identities.id, identityId));
    await connection.client.end();
    await rm(mediaRoot, { recursive: true, force: true });
  }
});
