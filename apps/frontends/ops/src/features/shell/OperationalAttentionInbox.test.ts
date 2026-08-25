import { describe, expect, it } from "vitest";
import type { PosPrintJob } from "../../api";
import type { PilotFloor } from "../../operations.shared";
import { buildOperationalAttentions } from "./OperationalAttentionInbox";

describe("buildOperationalAttentions", () => {
  it("prioritizes overdue calls, ready orders and failed prints", () => {
    const now = new Date("2026-08-20T15:00:00Z").getTime();
    const floor = {
      tables: [{ id: "table-1", label: "Mesa 1" }],
      serviceCalls: [
        {
          id: "call-1",
          tableId: "table-1",
          tabId: "tab-1",
          kind: "assistance",
          status: "open",
          slaMinutes: 3,
          createdAt: "2026-08-20T14:55:00Z",
        },
      ],
      tablePhases: [
        {
          tableId: "table-1",
          tabId: "tab-1",
          phase: "ready",
          since: "2026-08-20T14:57:00Z",
        },
      ],
    } as PilotFloor;
    const printJobs = [
      {
        id: "print-1",
        status: "failed",
        lastError: "Sem papel",
        updatedAt: "2026-08-20T14:59:00Z",
      },
    ] as PosPrintJob[];

    const result = buildOperationalAttentions(
      floor,
      printJobs,
      { salon: true, counter: true },
      now,
    );

    expect(result.map((item) => item.id)).toEqual(["call:call-1", "print:print-1", "ready:tab-1"]);
    expect(result[0]?.priority).toBe("critical");
    expect(result[2]?.priority).toBe("warning");
  });

  it("direciona o chamado ao responsável persistido e prioriza a fila atual", () => {
    const now = new Date("2026-08-20T15:00:00Z").getTime();
    const floor = {
      tables: [
        { id: "table-current", label: "Mesa 2" },
        { id: "table-other", label: "Mesa 3" },
      ],
      openTabs: [
        {
          id: "tab-current",
          tableId: "table-current",
          responsibleIdentityId: "identity-current",
        },
        { id: "tab-other", tableId: "table-other", responsibleIdentityId: "identity-other" },
      ],
      serviceCalls: [
        {
          id: "call-other",
          tableId: "table-other",
          tabId: "tab-other",
          kind: "assistance",
          status: "open",
          slaMinutes: 10,
          createdAt: "2026-08-20T14:59:00Z",
        },
        {
          id: "call-current",
          tableId: "table-current",
          tabId: "tab-current",
          kind: "assistance",
          status: "open",
          slaMinutes: 10,
          createdAt: "2026-08-20T14:59:00Z",
        },
      ],
      tablePhases: [],
      tableGroupMembers: [],
      tableGroups: [],
      staff: [
        { identityId: "identity-current", displayName: "Ana" },
        { identityId: "identity-other", displayName: "Beto" },
      ],
      serviceSectionTables: [],
      serviceSections: [],
      shiftTableTransfers: [],
      shiftSectionTables: [],
      shiftSectionStaff: [],
      activeShift: null,
    } as unknown as PilotFloor;

    const result = buildOperationalAttentions(
      floor,
      [],
      { salon: true, counter: false },
      now,
      [],
      "identity-current",
    );

    expect(result.map((item) => item.id)).toEqual(["call:call-current", "call:call-other"]);
    expect(result[0]?.detail).toContain("Responsável: você");
    expect(result[1]?.detail).toContain("Responsável: Beto");
  });

  it("distingue draft QR por evento real e mantém draft comum sem origem inventada", () => {
    const now = new Date("2026-08-20T15:00:00Z").getTime();
    const floor = {
      tables: [{ id: "table-1", label: "Mesa 1" }],
      openTabs: [{ id: "tab-1", tableId: "table-1", responsibleIdentityId: null }],
      serviceCalls: [],
      tablePhases: [
        {
          tableId: "table-1",
          tabId: "tab-1",
          phase: "preparing",
          since: "2026-08-20T14:59:00Z",
        },
      ],
      tableGroupMembers: [],
      tableGroups: [],
      staff: [],
      serviceSectionTables: [],
      serviceSections: [],
      shiftTableTransfers: [],
      shiftSectionTables: [],
      shiftSectionStaff: [],
      activeShift: null,
    } as unknown as PilotFloor;
    const baseDetail = {
      tab: { id: "tab-1", tableId: "table-1" },
      orders: [
        { id: "order-qr", status: "draft", createdAt: "2026-08-20T14:59:00Z" },
        { id: "order-common", status: "draft", createdAt: "2026-08-20T14:59:00Z" },
      ],
      items: [
        { id: "item-qr", orderId: "order-qr", status: "draft" },
        { id: "item-common", orderId: "order-common", status: "draft" },
      ],
      events: [
        {
          id: "event-qr",
          type: "order.created",
          payload: { orderId: "order-qr", source: "qr_table" },
        },
      ],
      payments: [],
      presence: [],
    } as unknown as import("../../operations.shared").TabDetail;

    const result = buildOperationalAttentions(floor, [], { salon: true, counter: false }, now, [
      baseDetail,
    ]);

    expect(result.find((item) => item.orderId === "order-qr")).toMatchObject({
      isQrOrder: true,
      title: "Mesa 1 · Pedido QR aguardando confirmação",
    });
    expect(result.find((item) => item.orderId === "order-common")).toMatchObject({
      isQrOrder: false,
      title: "Mesa 1 · Pedido aguardando revisão",
    });
  });
});
