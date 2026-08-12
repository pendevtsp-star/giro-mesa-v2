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

const resources = [
  "tenant",
  "plan",
  "entitlements",
  "users",
  "onboarding",
  "billing",
  "integrations",
  "audit",
  "leads",
  "support",
  "incidents",
] as const;

const schemaNames = {
  tenant: "PlatformTenantProjectionResponse",
  plan: "PlatformPlanProjectionResponse",
  entitlements: "PlatformEntitlementsProjectionResponse",
  users: "PlatformUsersProjectionResponse",
  onboarding: "PlatformOnboardingProjectionResponse",
  billing: "PlatformBillingProjectionResponse",
  integrations: "PlatformIntegrationsProjectionResponse",
  audit: "PlatformAuditProjectionResponse",
  leads: "PlatformLeadsProjectionResponse",
  support: "PlatformSupportProjectionResponse",
  incidents: "PlatformIncidentsProjectionResponse",
} as const;

const openApiUrl = new URL("../../openapi/openapi.json", import.meta.url);
const tsClientUrl = new URL("../../../../packages/contracts/src/generated-api.ts", import.meta.url);
const csharpModelsRoot = new URL(
  "../../../../packages/api-client-csharp/Generated/Models/",
  import.meta.url,
);

describe("platform generated projection contract", () => {
  it("publishes a closed discriminated DTO for every resource on both aliases", async () => {
    const document = object(JSON.parse(await readFile(openApiUrl, "utf8")));
    const expectedRefs = resources.map((resource) => ({
      $ref: `#/components/schemas/${schemaNames[resource]}`,
    }));
    const expectedMapping = Object.fromEntries(
      resources.map((resource) => [resource, `#/components/schemas/${schemaNames[resource]}`]),
    );
    for (const prefix of ["/api/v1", "/v1"]) {
      const schema = object(
        property(
          document,
          "paths",
          `${prefix}/platform/tenants/{organizationId}/resources/{resource}`,
          "get",
          "responses",
          "200",
          "content",
          "application/json",
          "schema",
        ),
      );
      assert.deepEqual(schema.oneOf, expectedRefs);
      assert.deepEqual(schema.discriminator, {
        propertyName: "resource",
        mapping: expectedMapping,
      });
    }
    for (const resource of resources) {
      const schema = object(property(document, "components", "schemas", schemaNames[resource]));
      assert.equal(schema.additionalProperties, false, schemaNames[resource]);
      const required = schema.required;
      assert.ok(Array.isArray(required));
      for (const field of ["resource", "availability", "items", "nextCursor"])
        assert.ok(required.includes(field), `${schemaNames[resource]} misses ${field}`);
      assert.deepEqual(property(schema, "properties", "resource", "enum"), [resource]);
      assert.equal(property(schema, "properties", "items", "type"), "array");
    }
  });

  it("generates concrete TypeScript and C# item models instead of empty records", async () => {
    const typescript = await readFile(tsClientUrl, "utf8");
    assert.match(typescript, /PlatformTenantProjectionItemResponse/);
    assert.doesNotMatch(
      typescript,
      /PlatformProjectionResponse[\s\S]{0,1200}Record<string, never>\[\]/,
    );

    const tenant = await readFile(
      new URL("PlatformTenantProjectionItemResponse.cs", csharpModelsRoot),
      "utf8",
    );
    assert.match(tenant, /public Guid\? OrganizationId/);
    assert.match(tenant, /public string\? BillingState/);
    assert.doesNotMatch(tenant, /class PlatformProjectionResponse_items/);
  });

  it("publishes global lead/support queues and concrete incident actions on both aliases", async () => {
    const document = object(JSON.parse(await readFile(openApiUrl, "utf8")));
    for (const prefix of ["/api/v1", "/v1"]) {
      const globalSchema = object(
        property(
          document,
          "paths",
          `${prefix}/platform/resources/{resource}`,
          "get",
          "responses",
          "200",
          "content",
          "application/json",
          "schema",
        ),
      );
      assert.deepEqual(globalSchema.oneOf, [
        { $ref: "#/components/schemas/PlatformLeadsProjectionResponse" },
        { $ref: "#/components/schemas/PlatformSupportProjectionResponse" },
      ]);
    }

    for (const [responseName, itemName] of [
      ["PlatformLeadsProjectionResponse", "PlatformLeadProjectionItemResponse"],
      ["PlatformSupportProjectionResponse", "PlatformSupportProjectionItemResponse"],
      ["PlatformIncidentsProjectionResponse", "PlatformIncidentProjectionItemResponse"],
    ] as const) {
      assert.equal(
        property(
          document,
          "components",
          "schemas",
          responseName,
          "properties",
          "items",
          "items",
          "$ref",
        ),
        `#/components/schemas/${itemName}`,
      );
    }

    const incidentItem = object(
      property(document, "components", "schemas", "PlatformIncidentProjectionItemResponse"),
    );
    assert.equal(incidentItem.additionalProperties, false);
    assert.equal("evidence" in object(incidentItem.properties), false);
    assert.equal("requestHash" in object(incidentItem.properties), false);

    const typescript = await readFile(tsClientUrl, "utf8");
    assert.match(typescript, /PlatformLeadProjectionItemResponse/);
    assert.match(typescript, /PlatformSupportProjectionItemResponse/);
    assert.match(typescript, /PlatformIncidentProjectionItemResponse/);
    for (const model of [
      "PlatformLeadProjectionItemResponse.cs",
      "PlatformSupportProjectionItemResponse.cs",
      "PlatformIncidentProjectionItemResponse.cs",
    ]) {
      assert.match(
        await readFile(new URL(model, csharpModelsRoot), "utf8"),
        /public (?:partial )?class/,
      );
    }
  });
});
