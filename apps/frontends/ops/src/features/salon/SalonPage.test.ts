import { describe, expect, it } from "vitest";
import {
  buildTableTransferCommand,
  findPriorityServiceCall,
  tableStatusPresentation,
} from "./SalonPage";

describe("tableStatusPresentation", () => {
  it("never presents an operational call as a free table", () => {
    expect(tableStatusPresentation("attention")).toMatchObject({
      className: "attention",
      label: "Chamando",
      pulse: true,
      tone: "danger",
    });
    expect(tableStatusPresentation("attention").label).not.toBe("Livre");
  });

  it("keeps bill requests distinct from ordinary occupied tables", () => {
    expect(tableStatusPresentation("closing").label).toBe("Pediu a conta");
    expect(tableStatusPresentation("occupied").label).toBe("Em atendimento");
  });

  it("keeps table turnover unavailable until cleaning is confirmed", () => {
    expect(tableStatusPresentation("needs_cleaning").label).toBe("Aguardando limpeza");
    expect(tableStatusPresentation("cleaning").label).toBe("Em limpeza");
  });

  it("opens the account when a table has bill and assistance calls at the same time", () => {
    const selected = findPriorityServiceCall(
      [
        { id: "help", kind: "assistance", tableId: "table-1" },
        { id: "bill", kind: "bill", tableId: "table-1" },
      ],
      ["table-1"],
    );

    expect(selected?.id).toBe("bill");
  });
});

describe("buildTableTransferCommand", () => {
  it("keeps the target table inside the body used by online and replay dispatch", () => {
    expect(buildTableTransferCommand("tab-1", "table-2")).toEqual({
      body: { tableId: "table-2", reason: "Mudança de mesa pelo atendimento" },
      payload: {
        kind: "pilot.mutation",
        action: "transfer-tab",
        data: {
          tabId: "tab-1",
          body: { tableId: "table-2", reason: "Mudança de mesa pelo atendimento" },
        },
      },
    });
  });
});
