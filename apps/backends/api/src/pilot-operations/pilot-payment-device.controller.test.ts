import assert from "node:assert/strict";
import { it } from "node:test";
import { smartPosCanonicalRequest, stableJson } from "./pilot-rules.js";

it("canonicalizes signed SmartPOS requests independently of object key order", () => {
  const left = smartPosCanonicalRequest("post", "/api/v1/device/payment-diagnostics", "1", "n", {
    model: "A",
    app: { version: "1", package: "br.com.giromesa" },
  });
  const right = smartPosCanonicalRequest("POST", "/api/v1/device/payment-diagnostics", "1", "n", {
    app: { package: "br.com.giromesa", version: "1" },
    model: "A",
  });
  assert.equal(left, right);
  assert.match(left, /\n[0-9a-f]{64}$/);
});

it("uses ordinal UTF-16 keys and the v1 JSON escaping vector", () => {
  const body = {
    "😀": { β: "Pix", A: "Rede" },
    é: "ação",
    z: "<>&\u2028",
    Z: "maquininha",
  };
  assert.equal(
    stableJson(body),
    '{"Z":"maquininha","z":"<>&\u2028","é":"ação","😀":{"A":"Rede","β":"Pix"}}',
  );
  assert.equal(
    smartPosCanonicalRequest(
      "post",
      "/api/v1/device/payment-diagnostics?source=native",
      "1776762000",
      "Nonce_0123456789abcdef",
      body,
    ),
    "POST\n/api/v1/device/payment-diagnostics?source=native\n1776762000\nNonce_0123456789abcdef\n38d681a24aa72ab626acc5b52418f64da03aa7485e4823e8cbbef9523cd41c86",
  );
});
