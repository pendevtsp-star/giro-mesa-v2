import assert from "node:assert/strict";
import { it } from "node:test";
import type { ArgumentsHost } from "@nestjs/common";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { InventoryProductConflictFilter } from "./management.controller.js";

it("traduz o conflito de produto de revenda para o contrato HTTP", () => {
  let statusCode = 0;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return { send: (value: unknown) => (body = value) };
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  const cause = Object.assign(new Error("duplicate"), {
    code: "23505",
    constraint_name: "management_inventory_items_resale_product_unique",
  });

  new InventoryProductConflictFilter().catch(
    new DrizzleQueryError("insert inventory item", [], cause),
    host,
  );

  assert.equal(statusCode, 409);
  assert.deepEqual(body, {
    code: "INVENTORY_PRODUCT_ALREADY_LINKED",
    message: "Este produto já está ligado a outro item de revenda ativo.",
  });
});
