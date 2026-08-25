import assert from "node:assert/strict";
import { it } from "node:test";
import { accountantAttachmentDueForPurge } from "./accountant-attachments.js";

const attachment = {
  id: "00000000-0000-4000-8000-000000000001",
  fileName: "documento.pdf",
  contentType: "application/pdf" as const,
  sizeBytes: 10,
  sha256: "a".repeat(64),
  storageKey:
    "fiscal/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/packages/00000000-0000-4000-8000-000000000003/request_attachment-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf",
  createdAt: "2026-01-01T00:00:00.000Z",
  uploadedByIdentityId: "00000000-0000-4000-8000-000000000004",
  retentionUntil: "2026-02-01T00:00:00.000Z",
};

it("purges only expired accountant attachments without a legal hold", () => {
  const now = new Date("2026-03-01T00:00:00.000Z");
  assert.equal(accountantAttachmentDueForPurge(attachment, now), true);
  assert.equal(accountantAttachmentDueForPurge({ ...attachment, legalHold: true }, now), false);
  assert.equal(
    accountantAttachmentDueForPurge({ ...attachment, purgedAt: now.toISOString() }, now),
    false,
  );
});
