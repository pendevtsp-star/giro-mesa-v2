import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  deleteWhatsAppArtifact,
  readWhatsAppArtifact,
  validateWhatsAppArtifact,
  writeWhatsAppArtifact,
} from "./whatsapp-artifacts.js";

describe("WhatsApp artifacts", () => {
  it("validates, stores and reads only scoped allowlisted media", async () => {
    const root = await mkdtemp(join(tmpdir(), "giromesa-whatsapp-"));
    const content = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("documento")]);
    const scope = {
      root,
      organizationId: "11111111-1111-4111-8111-111111111111",
      unitId: "22222222-2222-4222-8222-222222222222",
      messageId: "33333333-3333-4333-8333-333333333333",
      mimeType: "application/pdf",
      content,
    };
    try {
      assert.equal(validateWhatsAppArtifact(content, scope.mimeType), "pdf");
      const stored = await writeWhatsAppArtifact(scope);
      assert.deepEqual(await readWhatsAppArtifact(root, stored.storageKey), content);
      await deleteWhatsAppArtifact(root, stored.storageKey);
      await assert.rejects(readWhatsAppArtifact(root, stored.storageKey));
      assert.throws(() => validateWhatsAppArtifact(Buffer.from("fake"), "application/pdf"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
