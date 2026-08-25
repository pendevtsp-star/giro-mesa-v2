import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { commercialPublishSchema } from "../platform/platform.schemas.js";
import { matchesOperationId, toOpenApiSchema } from "./openapi-zod.js";

describe("Zod OpenAPI bridge", () => {
  it("preserves required request fields and validation bounds", () => {
    const schema = toOpenApiSchema(
      z.object({ name: z.string().min(2), amountCents: z.number().int().nonnegative() }),
    );

    assert.deepEqual(schema.required, ["name", "amountCents"]);
    assert.deepEqual(schema.properties, {
      name: { type: "string", minLength: 2 },
      amountCents: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    });
  });

  it("emits OpenAPI 3.0 compatible literals and exclusive bounds", () => {
    const schema = toOpenApiSchema(
      z.object({
        version: z.literal(1),
        quantity: z.number().positive(),
        metadata: z.record(z.string().max(64), z.unknown()),
      }),
    );

    assert.deepEqual(schema.properties, {
      version: { type: "number", enum: [1] },
      quantity: {
        type: "number",
        minimum: 0,
        exclusiveMinimum: true,
      },
      metadata: { type: "object", additionalProperties: {} },
    });
  });

  it("does not confuse methods whose names share a prefix", () => {
    assert.equal(
      matchesOperationId(
        "PilotPosController_updateTableTurnover[0]",
        "PilotPosController_updateTab",
      ),
      false,
    );
    assert.equal(
      matchesOperationId(
        "PilotPosController_updateTableTurnover[0]",
        "PilotPosController_updateTableTurnover",
      ),
      true,
    );
  });

  it("documents transformed commercial dates as ISO request strings", () => {
    const schema = toOpenApiSchema(commercialPublishSchema);
    const publishAt = (schema.properties as Record<string, Record<string, unknown>>).publishAt;

    assert.equal(publishAt?.type, "string");
    assert.equal(publishAt?.format, "date-time");
  });
});
