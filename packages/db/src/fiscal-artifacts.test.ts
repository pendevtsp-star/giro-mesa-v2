import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  deleteFiscalArtifact,
  readFiscalArtifact,
  validateFiscalArtifact,
  writeFiscalArtifact,
} from "./fiscal-artifacts.js";

const organizationId = "10000000-0000-4000-8000-000000000001";
const unitId = "20000000-0000-4000-8000-000000000002";
const documentId = "30000000-0000-4000-8000-000000000003";

describe("private fiscal artifacts", () => {
  it("stores scoped XML atomically and rejects active XML content", async () => {
    const root = await mkdtemp(join(tmpdir(), "giromesa-fiscal-"));
    try {
      const content = Buffer.from('<?xml version="1.0"?><nfeProc/>');
      validateFiscalArtifact("authorization_xml", content);
      const stored = await writeFiscalArtifact({
        root,
        organizationId,
        unitId,
        namespace: "documents",
        entityId: documentId,
        name: "authorization_xml",
        extension: "xml",
        content,
      });
      assert.deepEqual(await readFiscalArtifact(root, stored.storageKey), content);
      await deleteFiscalArtifact(root, stored.storageKey);
      await assert.rejects(readFiscalArtifact(root, stored.storageKey));
      assert.throws(
        () =>
          validateFiscalArtifact(
            "authorization_xml",
            Buffer.from("<!DOCTYPE n [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><n/>"),
          ),
        /FISCAL_ARTIFACT_SIGNATURE_INVALID/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
