import { describe, expect, it } from "vitest";
import { parsePendingApprovals } from "./ManagerApprovalInbox";

describe("parsePendingApprovals", () => {
  it("mantém somente solicitações gerenciais válidas", () => {
    expect(
      parsePendingApprovals([
        {
          requestId: "request-1",
          tabLabel: "Mesa 04",
          productName: "Executivo",
          action: "discount",
          discountCents: 500,
          reason: "Cortesia autorizada",
          requestedByName: "Lia",
          requestedAt: "2026-08-16T12:00:00.000Z",
          expiresAt: "2026-08-16T12:10:00.000Z",
        },
        { requestId: "incompleta" },
      ]),
    ).toEqual([
      expect.objectContaining({
        requestId: "request-1",
        action: "discount",
        discountCents: 500,
      }),
    ]);
  });
});
