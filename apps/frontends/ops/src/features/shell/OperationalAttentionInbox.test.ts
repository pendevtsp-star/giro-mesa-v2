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
});
