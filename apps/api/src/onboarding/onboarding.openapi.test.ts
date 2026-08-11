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
const csharpRoot = new URL(
  "../../../../packages/api-client-csharp/Generated/Api/V1/Organizations/Item/Onboarding/",
  import.meta.url,
);
const csharpAliasRoot = new URL(
  "../../../../packages/api-client-csharp/Generated/V1/Organizations/Item/Onboarding/",
  import.meta.url,
);
const csharpModelsRoot = new URL(
  "../../../../packages/api-client-csharp/Generated/Models/",
  import.meta.url,
);

describe("onboarding generated contract", () => {
  it("keeps aliases, success/error responses and Idempotency-Key explicit", async () => {
    const document = object(JSON.parse(await readFile(openApiUrl, "utf8")));
    for (const prefix of ["/api/v1", "/v1"]) {
      const base = `${prefix}/organizations/{organizationId}/onboarding`;
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
        ),
        { $ref: "#/components/schemas/OnboardingResponse" },
      );
      assert.deepEqual(
        property(
          document,
          "paths",
          `${base}/selection`,
          "put",
          "responses",
          "200",
          "content",
          "application/json",
          "schema",
        ),
        { $ref: "#/components/schemas/OnboardingSelectionResponse" },
      );
      assert.deepEqual(
        property(
          document,
          "paths",
          `${base}/activate`,
          "post",
          "responses",
          "201",
          "content",
          "application/json",
          "schema",
        ),
        { $ref: "#/components/schemas/TrialActivationResponse" },
      );
      assert.ok(property(document, "paths", `${base}/activate`, "post", "responses", "400"));
      assert.ok(property(document, "paths", `${base}/activate`, "post", "responses", "409"));
      assert.equal(
        object(property(document, "paths", `${base}/activate`, "post", "responses"))["503"],
        undefined,
      );
      const parameters = property(document, "paths", `${base}/activate`, "post", "parameters");
      assert.ok(
        Array.isArray(parameters) &&
          parameters.some(
            (parameter) =>
              object(parameter).name === "Idempotency-Key" && object(parameter).required === true,
          ),
      );
      assert.deepEqual(
        property(
          document,
          "paths",
          `${base}/provisioning/{runId}`,
          "get",
          "responses",
          "200",
          "content",
          "application/json",
          "schema",
        ),
        { $ref: "#/components/schemas/ProvisioningStatusResponse" },
      );
      const errorResponses = [
        [base, "get", ["400", "401", "403", "404", "429", "500"]],
        [base, "patch", ["400", "401", "403", "404", "409", "429", "500"]],
        [`${base}/selection`, "put", ["400", "401", "403", "404", "409", "429", "500"]],
        [`${base}/activate`, "post", ["400", "401", "403", "404", "409", "429", "500"]],
        [`${base}/provisioning/{runId}`, "get", ["400", "401", "403", "404", "429", "500"]],
      ] as const;
      for (const [path, method, statuses] of errorResponses) {
        for (const status of statuses) {
          assert.deepEqual(
            property(
              document,
              "paths",
              path,
              method,
              "responses",
              status,
              "content",
              "application/json",
              "schema",
            ),
            { $ref: "#/components/schemas/OnboardingApiErrorResponse" },
          );
        }
      }
    }
    assert.deepEqual(
      property(document, "components", "schemas", "OnboardingApiErrorResponse", "required"),
      ["statusCode", "code", "message"],
    );
    assert.deepEqual(
      property(
        document,
        "components",
        "schemas",
        "OnboardingApiErrorResponse",
        "properties",
        "details",
      ),
      { $ref: "#/components/schemas/OnboardingApiErrorDetails" },
    );
  });

  it("generates DTO-returning C# clients instead of void or streams", async () => {
    const files = [
      ["OnboardingRequestBuilder.cs", /Task<[^>]*OnboardingResponse\??> (?:Get|Patch)Async/],
      [
        "Selection/SelectionRequestBuilder.cs",
        /Task<[^>]*OnboardingSelectionResponse\??> PutAsync/,
      ],
      ["Activate/ActivateRequestBuilder.cs", /Task<[^>]*TrialActivationResponse\??> PostAsync/],
      [
        "Provisioning/Item/WithRunItemRequestBuilder.cs",
        /Task<[^>]*ProvisioningStatusResponse\??> GetAsync/,
      ],
    ] as const;
    for (const [path, expected] of files) {
      const source = await readFile(new URL(path, csharpRoot), "utf8");
      assert.match(source, expected);
      assert.doesNotMatch(source, /Task<(?:Stream|void)\??>/i);
    }
    const activate = await readFile(
      new URL("Activate/ActivateRequestBuilder.cs", csharpRoot),
      "utf8",
    );
    for (const status of ["400", "401", "403", "404", "409", "429", "500"]) {
      assert.match(
        activate,
        new RegExp(
          `\\{ "${status}", global::GiroMesa\\.ApiClient\\.Models\\.OnboardingApiErrorResponse\\.CreateFromDiscriminatorValue \\}`,
        ),
      );
    }
    assert.doesNotMatch(activate, /\{ "503",/);
    for (const root of [csharpRoot, csharpAliasRoot]) {
      for (const path of [
        "OnboardingRequestBuilder.cs",
        "Selection/SelectionRequestBuilder.cs",
        "Activate/ActivateRequestBuilder.cs",
        "Provisioning/Item/WithRunItemRequestBuilder.cs",
      ]) {
        const source = await readFile(new URL(path, root), "utf8");
        assert.match(
          source,
          /\{ "401", global::GiroMesa\.ApiClient\.Models\.OnboardingApiErrorResponse\.CreateFromDiscriminatorValue \}/,
        );
        assert.match(
          source,
          /\{ "403", global::GiroMesa\.ApiClient\.Models\.OnboardingApiErrorResponse\.CreateFromDiscriminatorValue \}/,
        );
        assert.match(
          source,
          /\{ "500", global::GiroMesa\.ApiClient\.Models\.OnboardingApiErrorResponse\.CreateFromDiscriminatorValue \}/,
        );
      }
    }
    for (const model of ["ProvisioningSummaryResponse.cs", "ProvisioningStepResponse.cs"]) {
      const source = await readFile(new URL(model, csharpModelsRoot), "utf8");
      assert.match(source, /public int\? Attempts \{ get; set; \}/);
      assert.doesNotMatch(source, /public double\? Attempts/);
    }
  });

  it("describes checklist evidence and provisioning with closed enums and date-times", async () => {
    const document = object(JSON.parse(await readFile(openApiUrl, "utf8")));
    const schemas = object(property(document, "components", "schemas"));
    assert.deepEqual(property(schemas.OnboardingResponse, "properties", "items"), {
      $ref: "#/components/schemas/OnboardingChecklistItemsResponse",
    });
    assert.deepEqual(property(schemas.OnboardingChecklistItemsResponse, "required"), [
      "business",
      "unit",
      "plan",
      "fiscalChoice",
      "catalog",
      "tables",
      "team",
      "qr",
      "production",
      "cashier",
      "training",
      "rehearsal",
    ]);
    for (const item of [
      "business",
      "unit",
      "plan",
      "fiscalChoice",
      "catalog",
      "tables",
      "team",
      "qr",
      "production",
      "cashier",
      "training",
      "rehearsal",
    ]) {
      assert.deepEqual(property(schemas.OnboardingChecklistItemsResponse, "properties", item), {
        $ref: "#/components/schemas/OnboardingChecklistEvidenceResponse",
      });
    }
    assert.deepEqual(
      property(schemas.OnboardingChecklistEvidenceResponse, "properties", "evidence"),
      { $ref: "#/components/schemas/OnboardingEvidenceResponse" },
    );
    assert.deepEqual(
      [...(property(schemas.OnboardingResponse, "required") as string[])].sort(),
      [
        "activatedAt",
        "items",
        "missingItems",
        "organizationId",
        "provisioning",
        "ready",
        "selection",
      ].sort(),
    );
    assert.deepEqual(
      [...(property(schemas.ProvisioningSummaryResponse, "required") as string[])].sort(),
      [
        "attempts",
        "checkpoint",
        "completedAt",
        "createdAt",
        "failedAt",
        "id",
        "lastErrorCode",
        "nextRetryAt",
        "state",
        "updatedAt",
      ].sort(),
    );
    assert.deepEqual(
      [...(property(schemas.ProvisioningStepResponse, "required") as string[])].sort(),
      [
        "attempts",
        "compensatedAt",
        "completedAt",
        "createdAt",
        "startedAt",
        "status",
        "step",
        "updatedAt",
      ].sort(),
    );
    for (const schema of [schemas.ProvisioningSummaryResponse, schemas.ProvisioningStepResponse]) {
      assert.equal(property(schema, "properties", "attempts", "type"), "integer");
      assert.equal(property(schema, "properties", "attempts", "format"), "int32");
      assert.equal(property(schema, "properties", "attempts", "minimum"), 0);
    }
    assert.deepEqual(property(schemas.ProvisioningSummaryResponse, "properties", "state", "enum"), [
      "requested",
      "validating",
      "provisioning",
      "activating",
      "publishing",
      "retryable_failed",
      "compensating",
      "compensated",
      "terminal_failed",
      "completed",
    ]);
    assert.deepEqual(
      property(schemas.ProvisioningSummaryResponse, "properties", "checkpoint", "enum"),
      [
        "requested",
        "validated",
        "internal_provisioned",
        "activation_committed",
        "published",
        "compensated",
      ],
    );
    assert.deepEqual(property(schemas.ProvisioningStepResponse, "properties", "status", "enum"), [
      "pending",
      "in_progress",
      "completed",
      "failed",
      "compensated",
    ]);
    for (const dateProperty of [
      "nextRetryAt",
      "completedAt",
      "failedAt",
      "createdAt",
      "updatedAt",
    ]) {
      assert.equal(
        property(schemas.ProvisioningSummaryResponse, "properties", dateProperty, "format"),
        "date-time",
      );
      assert.equal(
        property(schemas.ProvisioningSummaryResponse, "properties", dateProperty, "type"),
        "string",
      );
    }
  });
});
