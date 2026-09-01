import { describe, expect, it } from "vitest";
import { ApiClientError } from "../../api";
import {
  buildTableGroupReason,
  buildTableTransferCommand,
  canOpenTableWorkspace,
  findPriorityServiceCall,
  parseSalonViewContext,
  requiredOperationalRevision,
  runFloorRevisionMutation,
  salonTableIdFromHash,
  structuralMergePolicy,
  summarizeSalonAttention,
  tableStatusPresentation,
} from "./SalonPage";
import {
  buildSalonPreflight,
  buildTableTimeline,
  resolveShiftServiceMode,
  tableNextAction,
} from "./salon-operations";

describe("atalho para a mesa", () => {
  it("lê a mesa vinculada sem confundir outros parâmetros", () => {
    expect(salonTableIdFromHash("#/salon?table=table-09&origem=attention")).toBe("table-09");
    expect(salonTableIdFromHash("#/salon?tab=table-09")).toBeNull();
  });
});

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

describe("protected salon operation", () => {
  it("only opens the command workspace when the selected table exposes a tab and full scope", () => {
    expect(canOpenTableWorkspace("summary", "tab-sensitive")).toBe(false);
    expect(canOpenTableWorkspace("overview", "tab-sensitive")).toBe(false);
    expect(canOpenTableWorkspace("full", null)).toBe(false);
    expect(canOpenTableWorkspace("full", "tab-visible")).toBe(true);
  });

  it("keeps the join reason explicit in online and replay payloads", () => {
    expect(buildTableGroupReason("large_party", "  família com 12 pessoas  ")).toEqual({
      reasonCode: "large_party",
      reasonNote: "família com 12 pessoas",
    });
    expect(buildTableGroupReason("sit_together", "")).toEqual({
      reasonCode: "sit_together",
    });
  });

  it("blocks structural merge after financial movement and summarizes operational alerts", () => {
    expect(
      structuralMergePolicy([
        {
          structuralMergeAllowed: false,
          structuralMergeReason: "Pagamento parcial registrado.",
        },
      ]),
    ).toEqual({ allowed: false, reason: "Pagamento parcial registrado." });
    expect(
      summarizeSalonAttention(
        [
          {
            createdAt: "2026-08-22T18:00:00.000Z",
            slaMinutes: 5,
            printStatus: "failed",
          },
          {
            createdAt: "2026-08-22T18:09:00.000Z",
            slaMinutes: 5,
            printStatus: "confirmation_required",
          },
        ],
        new Date("2026-08-22T18:10:00.000Z").getTime(),
      ),
    ).toEqual({ overdue: 1, failedPrints: 1, printConfirmations: 1 });
  });

  it("never mutates the floor or shift without the loaded optimistic revision", () => {
    expect(requiredOperationalRevision(7, "planta")).toBe(7);
    expect(() => requiredOperationalRevision(null, "turno")).toThrow(
      "A revisão do turno não foi carregada",
    );
  });

  it("refreshes a stale floor revision once before creating configuration", async () => {
    const revisions: number[] = [];
    const result = await runFloorRevisionMutation(
      3,
      async () => 4,
      async (expectedRevision) => {
        revisions.push(expectedRevision);
        if (expectedRevision === 3) {
          throw new ApiClientError(
            "A planta foi alterada por outra pessoa.",
            409,
            "FLOOR_LAYOUT_VERSION_CONFLICT",
            false,
          );
        }
        return "created";
      },
    );

    expect(result).toBe("created");
    expect(revisions).toEqual([3, 4]);
  });
});

describe("salon command center guidance", () => {
  it("migrates the retired floor view to the panel and rejects invalid persisted filters", () => {
    expect(
      parseSalonViewContext(
        JSON.stringify({
          view: "floor",
          selectedTableId: "table-12",
          filterStatus: "closing",
          roomFilter: "room-2",
          sectionFilter: "section-1",
          query: "mesa 12",
        }),
        "map",
        "all",
      ),
    ).toMatchObject({
      view: "map",
      selectedTableId: "table-12",
      filterStatus: "closing",
      roomFilter: "room-2",
      sectionFilter: "section-1",
      query: "mesa 12",
    });
    expect(
      parseSalonViewContext('{"view":"wrong","filterStatus":"wrong"}', "map", "mine"),
    ).toMatchObject({ view: "map", filterStatus: "all", sectionFilter: "mine" });
  });

  it("derives the shift mode from reusable sections without asking twice", () => {
    expect(resolveShiftServiceMode([{ serviceMode: "bar" }, { serviceMode: "bar" }])).toBe("bar");
    expect(resolveShiftServiceMode([{ serviceMode: "bar" }, { serviceMode: "full_service" }])).toBe(
      "hybrid",
    );
  });

  it("blocks shift opening only when the physical space or reusable sections are absent", () => {
    const floor = {
      rooms: [{ id: "room-1", name: "Salão", active: true, layoutPolygon: null }],
      tables: [{ id: "table-1", active: true }],
      activeShift: null,
      serviceSections: [],
      serviceSectionTables: [],
      shiftSectionTables: [],
      shiftSectionStaff: [],
      shiftSections: [],
    } as never;

    expect(buildSalonPreflight(floor).slice(0, 2)).toMatchObject([
      { id: "space", ready: true, blocking: true },
      { id: "sections", ready: false, blocking: true },
    ]);
  });

  it("derives one next action and orders only timeline facts returned by the operation", () => {
    expect(
      tableNextAction({
        status: "occupied",
        hasTab: true,
        canOperate: true,
        phase: "ready",
      }),
    ).toBe("Servir pedido");

    expect(
      buildTableTimeline({
        table: { openedAt: "2026-08-23T18:00:00.000Z" } as never,
        tab: null,
        call: {
          kind: "bill",
          status: "open",
          createdAt: "2026-08-23T18:20:00.000Z",
          acknowledgedAt: null,
        } as never,
      }).map((item) => item.label),
    ).toEqual(["Atendimento iniciado", "Conta solicitada"]);
  });
});
