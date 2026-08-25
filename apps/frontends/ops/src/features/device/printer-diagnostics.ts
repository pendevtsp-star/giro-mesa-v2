export interface PrinterDiagnostic {
  id: string;
  configured: boolean;
  available: boolean;
  isDefault: boolean;
  paperWidthMm: number;
  supportsRasterGraphics: boolean;
  errorCode: string | null;
}

export interface LocalPrintQueueJob {
  id: string;
  status: "printing" | "accepted" | "failed" | "rejected" | "confirmation_required";
  stationId: string | null;
  stationName: string | null;
  printerId: string | null;
  documentType: string;
  copies: number;
  errorCode: string | null;
  bytesWritten: number;
  createdAt: string | null;
  updatedAt: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function field(row: Record<string, unknown>, camel: string, pascal: string): unknown {
  return row[camel] ?? row[pascal];
}

function stringField(row: Record<string, unknown>, camel: string, pascal: string): string | null {
  const value = field(row, camel, pascal);
  return typeof value === "string" && value.trim() ? value : null;
}

function numberField(
  row: Record<string, unknown>,
  camel: string,
  pascal: string,
  fallback = 0,
): number {
  const value = field(row, camel, pascal);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanField(row: Record<string, unknown>, camel: string, pascal: string): boolean {
  return field(row, camel, pascal) === true;
}

function listFromPayload(value: unknown, key: string, pascalKey: string): unknown[] {
  if (Array.isArray(value)) return value;
  const payload = record(value);
  const candidates = payload ? field(payload, key, pascalKey) : null;
  return Array.isArray(candidates) ? candidates : [];
}

export function parsePrinterDiagnostics(value: unknown): PrinterDiagnostic[] {
  return listFromPayload(value, "printers", "Printers").flatMap((candidate) => {
    const row = record(candidate);
    if (!row) return [];
    const id = stringField(row, "id", "Id");
    if (!id) return [];
    return [
      {
        id,
        configured: booleanField(row, "configured", "Configured"),
        available: booleanField(row, "available", "Available"),
        isDefault: booleanField(row, "isDefault", "IsDefault"),
        paperWidthMm: numberField(row, "paperWidthMm", "PaperWidthMm", 80),
        supportsRasterGraphics: booleanField(
          row,
          "supportsRasterGraphics",
          "SupportsRasterGraphics",
        ),
        errorCode: stringField(row, "errorCode", "ErrorCode"),
      },
    ];
  });
}

export function parseLocalPrintQueue(value: unknown): LocalPrintQueueJob[] {
  const supportedStatuses = new Set<LocalPrintQueueJob["status"]>([
    "printing",
    "accepted",
    "failed",
    "rejected",
    "confirmation_required",
  ]);
  return listFromPayload(value, "jobs", "Jobs").flatMap((candidate) => {
    const row = record(candidate);
    if (!row) return [];
    const id = stringField(row, "id", "Id");
    const status = stringField(row, "status", "Status") as LocalPrintQueueJob["status"] | null;
    if (!id || !status || !supportedStatuses.has(status)) return [];
    return [
      {
        id,
        status,
        stationId: stringField(row, "stationId", "StationId"),
        stationName:
          stringField(row, "stationName", "StationName") ?? stringField(row, "station", "Station"),
        printerId: stringField(row, "printerId", "PrinterId"),
        documentType: stringField(row, "documentType", "DocumentType") ?? "unknown",
        copies: numberField(row, "copies", "Copies", 1),
        errorCode: stringField(row, "errorCode", "ErrorCode"),
        bytesWritten: numberField(row, "bytesWritten", "BytesWritten"),
        createdAt: stringField(row, "createdAt", "CreatedAt"),
        updatedAt: stringField(row, "updatedAt", "UpdatedAt"),
      },
    ];
  });
}
