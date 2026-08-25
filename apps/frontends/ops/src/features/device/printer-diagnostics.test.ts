import { describe, expect, it } from "vitest";
import { parseLocalPrintQueue, parsePrinterDiagnostics } from "./printer-diagnostics";

describe("printer diagnostics parser", () => {
  it("accepts camelCase and PascalCase bridge payloads", () => {
    expect(
      parsePrinterDiagnostics({
        Printers: [
          {
            Id: "kitchen",
            Configured: true,
            Available: false,
            IsDefault: true,
            PaperWidthMm: 80,
            ErrorCode: "OFFLINE",
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "kitchen",
        configured: true,
        available: false,
        isDefault: true,
        paperWidthMm: 80,
        errorCode: "OFFLINE",
      }),
    ]);
  });

  it("keeps only actionable local queue states", () => {
    expect(
      parseLocalPrintQueue({
        jobs: [
          {
            id: "job-1",
            status: "confirmation_required",
            stationName: "Cozinha",
            documentType: "kds_ticket",
            copies: 1,
          },
          { id: "job-ignored", status: "printed" },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "job-1",
        status: "confirmation_required",
        stationName: "Cozinha",
      }),
    ]);
  });
});
