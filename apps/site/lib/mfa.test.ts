import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMfaProof,
  readMfaChallenge,
  readMfaSetup,
  readMfaStatus,
  readRecoveryCodes,
} from "./mfa.ts";

test("aceita apenas desafio MFA completo dentro do contrato", () => {
  const token = "a".repeat(32);
  assert.equal(readMfaChallenge({ mfaRequired: true, challengeToken: token }), token);
  assert.equal(readMfaChallenge({ mfaRequired: true, challengeToken: "curto" }), null);
  assert.equal(readMfaChallenge({ challengeToken: token }), null);
});

test("valida status e configuração TOTP sem aceitar URI arbitrária", () => {
  assert.equal(readMfaStatus({ enabled: true }), true);
  assert.equal(readMfaStatus({ enabled: "true" }), null);
  assert.deepEqual(
    readMfaSetup({ secret: "A".repeat(20), otpauthUri: "otpauth://totp/GiroMesa:user" }),
    { secret: "A".repeat(20), otpauthUri: "otpauth://totp/GiroMesa:user" },
  );
  assert.equal(readMfaSetup({ secret: "A".repeat(20), otpauthUri: "javascript:alert(1)" }), null);
});

test("recovery codes são efêmeros e enviados pelo campo correto", () => {
  const codes = ["recovery-code-01", "recovery-code-02"];
  assert.deepEqual(readRecoveryCodes({ recoveryCodes: codes }), codes);
  assert.equal(readRecoveryCodes({ recoveryCodes: ["curto"] }), null);
  assert.deepEqual(buildMfaProof(" 123456 ", false), { code: "123456" });
  assert.deepEqual(buildMfaProof(" recovery-code-01 ", true), {
    recoveryCode: "recovery-code-01",
  });
});
