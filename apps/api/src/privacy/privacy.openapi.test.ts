import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}

function property(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const segment of path) current = object(current)[segment];
  return current;
}

const openApiUrl = new URL("../../openapi/openapi.json", import.meta.url);

describe("privacy generated contract", () => {
  it("types status lists, transitions and the one-time export on both aliases", async () => {
    const document = object(JSON.parse(await readFile(openApiUrl, "utf8")));
    for (const prefix of ["/api/v1", "/v1"]) {
      const base = `${prefix}/organizations/{organizationId}/privacy/requests`;
      assert.deepEqual(
        property(
          document,
          "paths",
          base,
          "post",
          "responses",
          "201",
          "content",
          "application/json",
          "schema",
        ),
        { $ref: "#/components/schemas/PrivacyRequestStatusResponse" },
      );
      assert.deepEqual(
        property(
          document,
          "paths",
          base,
          "get",
          "responses",
          "200",
          "content",
          "application/json",
          "schema",
          "items",
        ),
        { $ref: "#/components/schemas/PrivacyRequestStatusResponse" },
      );
      assert.deepEqual(
        property(
          document,
          "paths",
          `${base}/{requestId}/export-download`,
          "post",
          "responses",
          "200",
          "content",
          "application/json",
          "schema",
        ),
        { $ref: "#/components/schemas/PrivacyExportResponse" },
      );
      for (const action of ["verify-subject", "approve", "retry", "reject"]) {
        assert.deepEqual(
          property(
            document,
            "paths",
            `${base}/{requestId}/${action}`,
            "post",
            "responses",
            "200",
            "content",
            "application/json",
            "schema",
          ),
          { $ref: "#/components/schemas/PrivacyRequestStatusResponse" },
        );
      }
    }
  });
});
