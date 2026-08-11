import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { OpenAPIObject } from "@nestjs/swagger";

const document = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../openapi/openapi.json", import.meta.url)), "utf8"),
) as OpenAPIObject;

const expectedSuccessFields = [
  "acceptedEventIds",
  "rejectedEvents",
  "eventResults",
  "commands",
  "snapshot",
  "serverTime",
];

function responseSchema(path: string, status: string) {
  const response = document.paths[path]?.post?.responses?.[status];
  assert.ok(response && "content" in response, `${path} must document HTTP ${status}`);
  const schema = response.content?.["application/json"]?.schema;
  assert.ok(schema, `${path} HTTP ${status} must provide an application/json schema`);
  if ("$ref" in schema) {
    const name = schema.$ref.replace("#/components/schemas/", "");
    const resolved = document.components?.schemas?.[name];
    assert.ok(resolved && !("$ref" in resolved));
    return resolved;
  }
  return schema;
}

function propertySchema(schema: ReturnType<typeof responseSchema>, propertyName: string) {
  const property = schema.properties?.[propertyName];
  assert.ok(property && !("$ref" in property), `missing inline ${propertyName} schema`);
  return property;
}

describe("generated sync OpenAPI contract", () => {
  for (const path of ["/api/v1/sync/batches", "/v1/sync/batches"]) {
    it(`${path} exposes the exact success shape and both validation statuses`, () => {
      const operation = document.paths[path]?.post;
      assert.ok(operation);
      assert.deepEqual(Object.keys(operation.responses).sort(), ["200", "400", "422"]);

      const success = responseSchema(path, "200");
      assert.equal(success.type, "object");
      assert.deepEqual(success.required, expectedSuccessFields);
      assert.deepEqual(Object.keys(success.properties ?? {}), expectedSuccessFields);
      assert.equal(propertySchema(success, "acceptedEventIds").type, "array");
      assert.equal(propertySchema(success, "rejectedEvents").type, "array");
      assert.equal(propertySchema(success, "eventResults").type, "array");
      assert.equal(propertySchema(success, "commands").type, "array");
      assert.equal(propertySchema(success, "snapshot").type, "object");
      assert.equal(propertySchema(success, "serverTime").format, "date-time");

      responseSchema(path, "400");
      responseSchema(path, "422");
    });
  }
});
