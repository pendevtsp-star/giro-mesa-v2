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
});
