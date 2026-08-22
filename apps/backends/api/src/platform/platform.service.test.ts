import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fiscalIntegrationStatus } from "./platform.service.js";

describe("platform fiscal integration status", () => {
  it("reports encrypted credentials without exposing their contents", () => {
    const status = fiscalIntegrationStatus({
      focus: {
        tokenHomologation: {
          encryptedSecret: "ciphertext",
          iv: "initialization-vector",
          authTag: "authentication-tag",
        },
        tokenProduction: { encryptedSecret: "incomplete" },
      },
    });

    assert.equal(status.hasHomologationCredential, true);
    assert.equal(status.hasProductionCredential, false);
    assert.equal(JSON.stringify(status).includes("ciphertext"), false);
  });
});
