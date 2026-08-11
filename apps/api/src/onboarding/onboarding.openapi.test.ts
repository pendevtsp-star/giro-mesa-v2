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
      assert.ok(property(document, "paths", `${base}/activate`, "post", "responses", "503"));
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
    }
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
  });
});
