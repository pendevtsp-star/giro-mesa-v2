import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evolutionCredentialReference,
  evolutionInstanceToken,
  normalizeWhatsAppPhone,
  safeSecretEqual,
} from "./whatsapp.js";

describe("WhatsApp domain rules", () => {
  it("normalizes Brazilian numbers and derives stable non-reversible credentials", () => {
    assert.equal(normalizeWhatsAppPhone("(11) 99999-0000"), "5511999990000");
    assert.equal(normalizeWhatsAppPhone("+55 11 99999-0000"), "5511999990000");
    assert.throws(() => normalizeWhatsAppPhone("123"), /WHATSAPP_PHONE_INVALID/);
    const token = evolutionInstanceToken("integration-id", "x".repeat(32));
    assert.equal(token, evolutionInstanceToken("integration-id", "x".repeat(32)));
    assert.ok(
      safeSecretEqual(evolutionCredentialReference(token), evolutionCredentialReference(token)),
    );
  });
});
