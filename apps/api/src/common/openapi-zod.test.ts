import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { promoteOpenApiDefinitions, toOpenApiSchema } from "./openapi-zod.js";

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

  it("promotes recursive definitions to resolvable OpenAPI components", () => {
    type Expression =
      | { type: "constant"; value: number }
      | { type: "add" | "max"; operands: Expression[] };
    const expression: z.ZodType<Expression> = z.lazy(() =>
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("constant"), value: z.number().int() }).strict(),
        z.object({ type: z.enum(["add", "max"]), operands: z.array(expression) }).strict(),
      ]),
    );
    const converted = promoteOpenApiDefinitions(
      toOpenApiSchema(z.object({ expression })),
      "RulesController_create",
    );

    assert.equal("definitions" in converted.schema, false);
    assert.equal("$defs" in converted.schema, false);
    assert.deepEqual(converted.schema.properties, {
      expression: { $ref: "#/components/schemas/RulesController_create_recursive" },
    });
    assert.deepEqual(
      (
        converted.components.RulesController_create_recursive as {
          oneOf: Array<unknown>;
        }
      ).oneOf[1],
      { $ref: "#/components/schemas/RulesController_create_recursive_add_max" },
    );
    assert.deepEqual(
      (
        converted.components.RulesController_create_recursive_add_max as {
          properties?: { operands?: { items?: unknown } };
        }
      ).properties?.operands?.items,
      { $ref: "#/components/schemas/RulesController_create_recursive" },
    );
    assert.deepEqual(
      (converted.components.RulesController_create_recursive as { discriminator?: unknown })
        .discriminator,
      {
        propertyName: "type",
        mapping: {
          constant: "#/components/schemas/RulesController_create_recursive_constant",
          add: "#/components/schemas/RulesController_create_recursive_add_max",
          max: "#/components/schemas/RulesController_create_recursive_add_max",
        },
      },
    );
  });
});
