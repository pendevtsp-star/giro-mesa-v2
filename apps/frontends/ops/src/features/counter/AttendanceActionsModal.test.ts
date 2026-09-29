import { describe, expect, it } from "vitest";
import { validTransferQuantity } from "./AttendanceActionsModal";

describe("quantidade na transferência entre comandas", () => {
  it("transfere a linha inteira e rejeita quantidades parciais ou itens enviados", () => {
    const item = { status: "draft", quantity: 3 };
    expect(validTransferQuantity(item, 1)).toBe(false);
    expect(validTransferQuantity(item, 3)).toBe(true);
    for (const quantity of [0, -1, 1.5, 4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validTransferQuantity(item, quantity)).toBe(false);
    }
    expect(validTransferQuantity(undefined, 1)).toBe(false);
    expect(validTransferQuantity({ ...item, status: "sent" }, 1)).toBe(false);
  });
});
