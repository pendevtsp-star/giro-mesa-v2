import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

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

it("publishes typed DoseClub administration contracts on both aliases", async () => {
  const document = object(
    JSON.parse(await readFile(new URL("../../openapi/openapi.json", import.meta.url), "utf8")),
  );
  for (const prefix of ["/api/v1", "/v1"]) {
    const base = `${prefix}/organizations/{organizationId}/growth/integrations/doseclub`;
    assert.deepEqual(
      property(
        document,
        "paths",
        `${base}/overview`,
        "get",
        "responses",
        "200",
        "content",
        "application/json",
        "schema",
      ),
      { $ref: "#/components/schemas/DoseClubOverviewDto" },
    );
    for (const [path, method, status] of [
      [`${base}/mappings`, "post", "201"],
      [`${base}/mappings/{mappingId}`, "patch", "200"],
      [`${base}/runs`, "post", "202"],
      [`${base}/runs/{runId}/retry`, "post", "202"],
      [`${base}/findings/{findingId}/recheck`, "post", "202"],
    ] as const) {
      const operation = object(property(document, "paths", path, method));
      const body = object(
        property(operation, "requestBody", "content", "application/json", "schema"),
      );
      assert.equal(body.type, "object");
      assert.equal(body.additionalProperties, false);
      assert.ok(object(operation.responses)[status]);
      assert.ok(object(operation.responses)["400"]);
      assert.ok(object(operation.responses)["401"]);
      assert.ok(object(operation.responses)["403"]);
    }
    const createProperties = object(
      property(
        document,
        "paths",
        `${base}/mappings`,
        "post",
        "requestBody",
        "content",
        "application/json",
        "schema",
        "properties",
      ),
    );
    const updateProperties = object(
      property(
        document,
        "paths",
        `${base}/mappings/{mappingId}`,
        "patch",
        "requestBody",
        "content",
        "application/json",
        "schema",
        "properties",
      ),
    );
    assert.ok(createProperties.productId);
    assert.equal(updateProperties.productId, undefined);
  }

  const typescript = await readFile(
    new URL("../../../../packages/contracts/src/generated-api.ts", import.meta.url),
    "utf8",
  );
  const runType = typescript.slice(
    typescript.indexOf("DoseClubReconciliationRunDto:"),
    typescript.indexOf("DoseClubReconciliationSummaryDto:"),
  );
  assert.doesNotMatch(runType, /Record<string, never>/);
  assert.match(runType, /failureCode: string \| null/);
  assert.match(runType, /startedAt: string \| null/);

  const csharp = await readFile(
    new URL(
      "../../../../packages/api-client-csharp/Generated/V1/Organizations/Item/Growth/Integrations/Doseclub/Runs/RunsRequestBuilder.cs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(csharp, /UntypedNode/);
  assert.match(csharp, /DoseClubReconciliationRunDto/);
});
