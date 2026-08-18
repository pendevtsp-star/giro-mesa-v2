import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpenAPIObject } from "@nestjs/swagger";
import {
  addManagementReportsOpenApi,
  managementReportsResponseSchema,
} from "./openapi-management-reports.js";

function document(): OpenAPIObject {
  return {
    openapi: "3.0.0",
    info: { title: "test", version: "1" },
    paths: Object.fromEntries(
      ["/api/v1", "/v1"].map((prefix) => [
        `${prefix}/organizations/{organizationId}/units/{unitId}/management/reports`,
        { get: { responses: { "200": { description: "" } } } },
      ]),
    ),
  };
}

describe("management reports OpenAPI contract", () => {
  it("types the required period and the complete response on both route aliases", () => {
    const openApi = document();
    addManagementReportsOpenApi(openApi);

    assert.deepEqual(
      openApi.components?.schemas?.ManagementReportsResponse,
      managementReportsResponseSchema,
    );
    for (const prefix of ["/api/v1", "/v1"]) {
      const operation =
        openApi.paths[`${prefix}/organizations/{organizationId}/units/{unitId}/management/reports`]
          ?.get;
      assert.deepEqual(operation?.parameters, [
        { name: "from", in: "query", required: true, schema: { type: "string", format: "date" } },
        { name: "to", in: "query", required: true, schema: { type: "string", format: "date" } },
        {
          name: "comparisonMode",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: ["previous_period", "previous_year", "none"],
            default: "previous_period",
          },
        },
      ]);
      assert.deepEqual(operation?.responses["200"], {
        description: "Relatório gerencial do período e comparação anterior equivalente.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ManagementReportsResponse" },
          },
        },
      });
    }

    const serialized = JSON.stringify(openApi.components?.schemas?.ManagementReportsResponse);
    for (const field of [
      "timezone",
      "previousPeriod",
      "comparison",
      "dailySeries",
      "products",
      "categories",
      "channels",
      "paymentMethods",
      "meta",
      "budget",
      "capabilities",
    ]) {
      assert.match(serialized, new RegExp(`\\"${field}\\"`));
    }
  });
});
