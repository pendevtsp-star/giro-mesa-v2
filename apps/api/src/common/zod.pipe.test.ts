import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ZodPipe } from "./zod.pipe.js";

describe("ZodPipe", () => {
  it("returns parsed values and rejects invalid boundary input", () => {
    const pipe = new ZodPipe(z.object({ count: z.coerce.number().int().positive() }));
    assert.deepEqual(pipe.transform({ count: "2" }), { count: 2 });
    assert.throws(() => pipe.transform({ count: 0 }), BadRequestException);
  });

  it("emits safe full paths for the closest nested union issue without echoing input", () => {
    const pipe = new ZodPipe(
      z.object({
        items: z.object({
          fiscalChoice: z.union([
            z.object({ status: z.literal("pending") }).strict(),
            z
              .object({
                status: z.literal("verified"),
                evidence: z.object({ choice: z.enum(["disabled", "focus", "external"]) }).strict(),
              })
              .strict(),
          ]),
        }),
      }),
    );

    assert.throws(
      () =>
        pipe.transform({
          items: {
            fiscalChoice: {
              status: "verified",
              evidence: { choice: "must-not-cross-secret" },
            },
          },
        }),
      (caught) => {
        assert.ok(caught instanceof BadRequestException);
        const response = caught.getResponse();
        assert.deepEqual(response, {
          code: "VALIDATION_ERROR",
          message: "Dados inválidos.",
          details: {
            fieldErrors: {
              "items.fiscalChoice.evidence.choice": ["Valor inválido."],
            },
          },
        });
        assert.doesNotMatch(JSON.stringify(response), /must-not-cross-secret/);
        return true;
      },
    );
  });
});
