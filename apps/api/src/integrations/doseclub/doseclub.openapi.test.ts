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

it("publishes the negotiated DoseClub receiver contract on both aliases", async () => {
  const openApiUrl = new URL("../../../openapi/openapi.json", import.meta.url);
  const document = object(JSON.parse(await readFile(openApiUrl, "utf8")));
  for (const prefix of ["/api/v1", "/v1"]) {
    const base = `${prefix}/integrations/club-whisky`;
    for (const path of [
      `${base}/sales`,
      `${base}/reservations`,
      `${base}/dose-consumptions`,
      `${base}/dose-consumptions/reversals`,
      `${base}/reconcile`,
    ]) {
      const operation = object(property(document, "paths", path, "post"));
      assert.ok(operation.requestBody, `${path} has no request body`);
      assert.ok(object(operation.responses)["200"], `${path} has no success response`);
      assert.ok(object(operation.responses)["400"], `${path} has no validation response`);
      assert.ok(object(operation.responses)["401"], `${path} has no authorization response`);
      assert.ok(object(operation.responses)["409"], `${path} has no conflict response`);
      const parameters = operation.parameters;
      assert.ok(Array.isArray(parameters));
      assert.ok(parameters.some((entry) => object(entry).name === "x-giromesa-integration-key"));
    }
    for (const suffix of ["sales", "dose-consumptions", "dose-consumptions/reversals"]) {
      assert.deepEqual(
        property(
          document,
          "paths",
          `${base}/${suffix}`,
          "post",
          "responses",
          "200",
          "content",
          "application/json",
          "schema",
        ),
        {
          oneOf: [
            { $ref: "#/components/schemas/DoseClubV1AcknowledgementDto" },
            { $ref: "#/components/schemas/DoseClubV2AcknowledgementDto" },
          ],
          discriminator: {
            propertyName: "contractVersion",
            mapping: {
              v1: "#/components/schemas/DoseClubV1AcknowledgementDto",
              v2: "#/components/schemas/DoseClubV2AcknowledgementDto",
            },
          },
        },
      );
    }
    const requestSchemas = Object.fromEntries(
      [
        "sales",
        "reservations",
        "dose-consumptions",
        "dose-consumptions/reversals",
        "reconcile",
      ].map((suffix) => [
        suffix,
        object(
          property(
            document,
            "paths",
            `${base}/${suffix}`,
            "post",
            "requestBody",
            "content",
            "application/json",
            "schema",
          ),
        ),
      ]),
    );
    for (const [suffix, expected] of Object.entries({
      sales: "sale",
      reservations: "reservation",
      "dose-consumptions": "consumption",
      "dose-consumptions/reversals": "reversal",
      reconcile: "reconcile",
    })) {
      const properties = object(requestSchemas[suffix]?.properties);
      assert.deepEqual(object(properties.operation).enum, [expected]);
      for (const forbidden of ["reservation", "consumption", "reversal", "reconcile", "sale"]) {
        if (forbidden !== expected)
          assert.notDeepEqual(object(properties.operation).enum, [forbidden]);
      }
    }
    assert.deepEqual(
      property(
        document,
        "paths",
        `${base}/branches`,
        "get",
        "responses",
        "200",
        "content",
        "application/json",
        "schema",
      ),
      { $ref: "#/components/schemas/DoseClubBranchListDto" },
    );
  }
  const csharpSalesUrl = new URL(
    "../../../../../packages/api-client-csharp/Generated/Api/V1/Integrations/ClubWhisky/Sales/SalesRequestBuilder.cs",
    import.meta.url,
  );
  const csharpSales = await readFile(csharpSalesUrl, "utf8");
  assert.doesNotMatch(csharpSales, /UntypedNode/);
  assert.match(csharpSales, /SalesPostRequestBody/);
});
