import { describe, expect, it } from "vitest";
import type { TableQrPrintBatch, TableQrSettings, TableQrTestResult } from "../../api";
import {
  canReprintTableQrBatch,
  selectedTableQrs,
  tableQrContrast,
  tableQrFilename,
  tableQrTestMessage,
} from "./table-qrs";
import { buildTableQrPrintHtml, createTableQrPdf, tableQrLayout } from "./table-qrs.print";

const settings: TableQrSettings = {
  revision: 3,
  displayName: "Casa & Mesa",
  headline: "Peça pelo celular",
  instructions: "Aponte a câmera e confirme sua mesa.",
  logoUrl: null,
  primaryColor: "#047857",
  wifiNotice: null,
  serviceChargeNotice: "Serviço opcional de 10%",
  template: "classic",
  presenceProtection: "session_only",
  updatedAt: "2026-08-24T12:00:00.000Z",
};

const batch = {
  id: "00000000-0000-4000-8000-000000000010",
  format: "a4_4",
  output: "print",
  template: "classic",
  menuSlug: "casa-mesa",
  includeWifi: false,
  status: "generated",
  settingsRevision: 3,
  settings: {
    displayName: settings.displayName,
    headline: settings.headline,
    instructions: settings.instructions,
    logoUrl: null,
    primaryColor: settings.primaryColor,
    wifiNotice: null,
    serviceChargeNotice: settings.serviceChargeNotice,
    template: settings.template,
    presenceProtection: settings.presenceProtection,
  },
  tables: [
    {
      tableId: "00000000-0000-4000-8000-000000000001",
      label: "Mesa 2",
      tokenVersion: 2,
      currentVersion: 2,
      isCurrent: true,
      url: "https://menu.example/m/casa?table=1&token=secret",
    },
  ],
  createdByIdentityId: "00000000-0000-4000-8000-000000000002",
  createdByLabel: "Ana",
  generatedAt: "2026-08-24T12:00:00.000Z",
  printedByIdentityId: null,
  printedByLabel: null,
  printedAt: null,
} satisfies TableQrPrintBatch;

describe("QR das mesas", () => {
  it("ordena naturalmente e seleciona apenas mesas reais", () => {
    const rows = [
      { tableId: "b", label: "Mesa 10" },
      { tableId: "a", label: "Mesa 2" },
      { tableId: "c", label: "Varanda" },
    ];
    expect(selectedTableQrs(rows, new Set(["a", "b"])).map((row) => row.label)).toEqual([
      "Mesa 2",
      "Mesa 10",
    ]);
  });

  it("reprova amarelo claro sobre branco e define fallback escuro", () => {
    expect(tableQrContrast("#fff475")).toMatchObject({
      effectiveColor: "#334155",
      passes: false,
    });
    expect(tableQrContrast("#047857").passes).toBe(true);
  });

  it("confirma estabelecimento, unidade, mesa e versão no teste", () => {
    const result: TableQrTestResult = {
      valid: true,
      displayName: "Casa Aurora",
      unitName: "Centro",
      slug: "casa-aurora",
      tableId: "00000000-0000-4000-8000-000000000001",
      tableLabel: "Mesa 2",
      tokenVersion: 4,
      expiresAt: "2027-08-24T12:00:00.000Z",
      reason: null,
    };
    expect(tableQrTestMessage(result)).toContain("Estabelecimento: Casa Aurora");
    expect(tableQrTestMessage(result)).toContain("Unidade: Centro");
    expect(tableQrTestMessage(result)).toContain("Mesa: Mesa 2");
    expect(tableQrTestMessage(result)).toContain("QR v4");
  });

  it("gera HTML escapado, com CSS balanceado e layouts físicos", () => {
    const html = buildTableQrPrintHtml(
      [
        {
          tableId: "table-1",
          label: 'Mesa <2> "VIP"',
          tokenVersion: 1,
          url: "https://menu.example",
          dataUrl: "data:image/svg+xml,qr",
        },
      ],
      settings,
      "a4_4",
    );
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    let depth = 0;
    for (const character of css) {
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    expect(css).toContain("min-height:134mm}.qr-panel{");
    expect(html).toContain("Casa &amp; Mesa");
    expect(html).toContain("Mesa &lt;2&gt; &quot;VIP&quot;");
    expect(html).not.toContain("wifi");
    expect(tableQrLayout("a4_2").capacity).toBe(2);
    expect(tableQrLayout("a4_6").capacity).toBe(6);
    expect(tableQrLayout("sticker").capacity).toBe(12);
    expect(tableQrLayout("table_tent").orientation).toBe("landscape");
  });

  it("bloqueia reimpressão de lote rotacionado e normaliza nomes de arquivo", () => {
    const currentTable = batch.tables.at(0);
    if (!currentTable) throw new Error("Mesa de teste ausente.");
    expect(canReprintTableQrBatch(batch)).toBe(true);
    expect(
      canReprintTableQrBatch({
        ...batch,
        tables: [{ ...currentTable, isCurrent: false, url: null }],
      }),
    ).toBe(false);
    expect(tableQrFilename("Mesa São João", "png")).toBe("qr-mesa-sao-joao.png");
  });

  it("falha explicitamente ao gerar PDF sem mesas", async () => {
    await expect(createTableQrPdf([], settings, "a4_4")).rejects.toThrow(
      "Selecione ao menos uma mesa",
    );
  });
});
