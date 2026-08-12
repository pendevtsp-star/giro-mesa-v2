import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const openApiUrl = new URL("../../openapi/openapi.json", import.meta.url);
const typescriptClientUrl = new URL(
  "../../../../packages/contracts/src/generated-api.ts",
  import.meta.url,
);
const csharpIntentBuilderUrl = new URL(
  "../../../../packages/api-client-csharp/Generated/Api/V1/Organizations/Item/Units/Item/Payments/Intents/IntentsRequestBuilder.cs",
  import.meta.url,
);
const csharpInventoryEventBuilderUrl = new URL(
  "../../../../packages/api-client-csharp/Generated/Api/V1/Organizations/Item/Units/Item/Management/Inventory/Events/EventsRequestBuilder.cs",
  import.meta.url,
);
const financeTags = new Set([
  "Fiscal",
  "Incidents",
  "Management",
  "PaymentCallbacks",
  "Payments",
  "Remuneration",
  "Returnables",
]);

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

describe("finance generated OpenAPI contract", () => {
  it("publishes explicit JSON responses for all 56 handlers and both aliases", async () => {
    const document = record(JSON.parse(await readFile(openApiUrl, "utf8")));
    const paths = record(document.paths);
    const handlerNames = new Set<string>();
    let aliasOperations = 0;

    for (const path of Object.values(paths)) {
      for (const operationValue of Object.values(record(path))) {
        const operation = record(operationValue);
        const tags = Array.isArray(operation.tags) ? operation.tags : [];
        if (!tags.some((tag) => typeof tag === "string" && financeTags.has(tag))) continue;
        aliasOperations += 1;
        const operationId = String(operation.operationId);
        handlerNames.add(operationId.replace(/\[\d+\]$/, ""));
        const responses = record(operation.responses);
        const success = record(responses["200"] ?? responses["201"]);
        const media = record(record(success.content)["application/json"]);
        const schema = record(media.schema);
        assert.match(String(schema.$ref), /^#\/components\/schemas\/[A-Za-z0-9_]+Response$/);
      }
    }

    assert.equal(handlerNames.size, 56);
    assert.equal(aliasOperations, 112);
  });

  it("keeps payment and batch result fields in generated response DTOs", async () => {
    const document = record(JSON.parse(await readFile(openApiUrl, "utf8")));
    const schemas = record(record(document.components).schemas);
    const intent = record(schemas.PaymentIntentResponse);
    assert.deepEqual(intent.required, ["intentId", "amountCents", "capturedCents", "status", "idempotentReplay"]);
    assert.equal(record(record(intent.properties).amountCents).maximum, 2_147_483_647);
    assert.equal(record(record(intent.properties).intentId).format, "uuid");
    const inventoryEvent = record(schemas.ManagementInventoryEventResponse);
    assert.deepEqual(inventoryEvent.required, ["eventId", "lines"]);
    assert.equal(record(record(inventoryEvent.properties).lines).type, "array");
  });

  it("generates typed TypeScript and C# response clients instead of discarding bodies", async () => {
    const [typescriptClient, csharpIntentBuilder, csharpInventoryEventBuilder] = await Promise.all([
      readFile(typescriptClientUrl, "utf8"),
      readFile(csharpIntentBuilderUrl, "utf8"),
      readFile(csharpInventoryEventBuilderUrl, "utf8"),
    ]);
    assert.match(typescriptClient, /"application\/json": components\["schemas"\]\["PaymentIntentResponse"\]/);
    assert.match(typescriptClient, /intentId: string;[\s\S]{0,300}status: string;/);
    assert.match(csharpIntentBuilder, /Task<global::GiroMesa\.ApiClient\.Models\.PaymentIntentResponse\?> PostAsync/);
    assert.doesNotMatch(csharpIntentBuilder, /SendNoContentAsync/);
    assert.match(
      csharpInventoryEventBuilder,
      /Task<global::GiroMesa\.ApiClient\.Models\.ManagementInventoryEventResponse\?> PostAsync/,
    );
    assert.doesNotMatch(csharpInventoryEventBuilder, /SendNoContentAsync/);
  });
});
