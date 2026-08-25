import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fiscalIntegrationStatus } from "./platform.service.js";
import {
  failureCode,
  maskDocument,
  maskEmail,
  maskName,
  maskPhone,
  maskReference,
  safeAuditMetadata,
} from "./platform-control.service.js";

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

describe("platform sensitive projections", () => {
  it("masks PII/provider references and reduces worker errors to codes", () => {
    assert.equal(maskDocument("12.345.678/0001-90"), "**********0190");
    assert.equal(maskEmail("owner@example.com"), "o***@example.com");
    assert.equal(maskName("Maria da Silva"), "M*** d*** S***");
    assert.equal(maskPhone("(11) 99999-1234"), "*******1234");
    assert.equal(maskReference("cus_123456789"), "cus***789");
    assert.equal(failureCode("FOCUS_TIMEOUT: upstream unavailable"), "FOCUS_TIMEOUT");
    assert.deepEqual(
      safeAuditMetadata({ reason: "Suporte solicitado", customerDocument: "12345678900" }),
      { reason: "Suporte solicitado" },
    );
  });
});
