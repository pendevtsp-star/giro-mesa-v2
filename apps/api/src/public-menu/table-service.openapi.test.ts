import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { OpenAPIObject } from "@nestjs/swagger";

type HeaderParameter = {
  required?: boolean;
  schema?: {
    type?: string;
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };
};

const document = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../openapi/openapi.json", import.meta.url)), "utf8"),
) as OpenAPIObject;

function header(path: string, method: "get" | "post", name: string) {
  const operation = document.paths[path]?.[method];
  assert.ok(operation, `${method.toUpperCase()} ${path} is missing`);
  const parameter = operation.parameters?.find(
    (candidate) =>
      "in" in candidate &&
      candidate.in === "header" &&
      candidate.name.toLowerCase() === name.toLowerCase(),
  ) as HeaderParameter | undefined;
  assert.ok(parameter, `${method.toUpperCase()} ${path} must type ${name}`);
  return parameter;
}

describe("generated public table-service OpenAPI contract", () => {
  for (const prefix of ["/api/v1/public/menus", "/public/v1/menus"]) {
    it(`${prefix} types the signed session and mutation headers`, () => {
      const callPath = `${prefix}/{slug}/table-calls`;
      const authorization = header(callPath, "post", "Authorization");
      assert.equal(authorization.required, true);
      assert.equal(authorization.schema?.type, "string");
      assert.equal(authorization.schema?.pattern, "^Bearer ");

      const nonce = header(callPath, "post", "X-Request-Nonce");
      assert.equal(nonce.required, true);
      assert.equal(nonce.schema?.minLength, 24);
      assert.equal(nonce.schema?.maxLength, 128);

      const idempotency = header(callPath, "post", "Idempotency-Key");
      assert.equal(idempotency.required, true);
      assert.equal(idempotency.schema?.minLength, 8);
      assert.equal(idempotency.schema?.maxLength, 160);

      const partialAuthorization = header(`${prefix}/{slug}/table-partial`, "get", "Authorization");
      assert.equal(partialAuthorization.required, true);
      assert.equal(partialAuthorization.schema?.pattern, "^Bearer ");
    });
  }
});
