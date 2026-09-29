import { describe, expect, it } from "vitest";
import { parsePendingApprovals } from "./ManagerApprovalInbox";

describe("parsePendingApprovals", () => {
  it("mantém somente solicitações gerenciais válidas", () => {
    expect(
      parsePendingApprovals([
        {
          requestId: "request-1",
          tabLabel: "Mesa 04",
          itemId: "item-1",
          productName: "Executivo",
          action: "discount",
          discountCents: 500,
          reason: "Cortesia autorizada",
          requestedByName: "Lia",
          requestedAt: "2026-08-16T12:00:00.000Z",
          expiresAt: "2026-08-16T12:10:00.000Z",
        },
        {
          requestId: "request-2",
          tabLabel: "Mesa 05",
          action: "tab_discount",
          discountCents: 1000,
          reason: "Desconto adicional na conta",
          requestedByName: "Rui",
          requestedAt: "2026-08-16T12:01:00.000Z",
          expiresAt: null,
        },
        { requestId: "incompleta" },
      ]),
    ).toEqual([
      expect.objectContaining({
        requestId: "request-1",
        action: "discount",
        discountCents: 500,
      }),
      expect.objectContaining({
        requestId: "request-2",
        action: "tab_discount",
        itemId: null,
        productName: null,
      }),
    ]);
  });

  it("rejeita desconto de item sem itemId e aceita desconto adicional na conta sem item", () => {
    expect(
      parsePendingApprovals([
        {
          requestId: "item-without-id",
          tabLabel: "Mesa 01",
          productName: "Produto",
          action: "discount",
          discountCents: 100,
          reason: "Motivo válido",
          requestedByName: "Lia",
          requestedAt: "2026-08-16T12:00:00.000Z",
        },
        {
          requestId: "tab-discount",
          tabLabel: "Mesa 01",
          action: "tab_discount",
          discountCents: 100,
          reason: "Motivo válido",
          requestedByName: "Lia",
          requestedAt: "2026-08-16T12:00:00.000Z",
        },
      ]),
    ).toEqual([expect.objectContaining({ requestId: "tab-discount", action: "tab_discount" })]);
  });
});
