import type { TableQrPrintFormat, TableQrSettings, TableQrVisualTemplate } from "../../api";
import { tableQrContrast } from "./table-qrs";

export type RenderedTableQr = {
  tableId: string;
  label: string;
  tokenVersion: number;
  url: string;
  dataUrl: string;
};

type PrintLayout = {
  capacity: number;
  columns: number;
  page: "a4" | "a5";
  orientation: "portrait" | "landscape";
  rows: number;
};

export const TABLE_QR_FORMATS: Array<{
  value: TableQrPrintFormat;
  label: string;
  description: string;
}> = [
  { value: "a4_2", label: "A4 · 2 placas", description: "Placa grande, duas por folha" },
  { value: "a4_4", label: "A4 · 4 placas", description: "Equilíbrio entre leitura e economia" },
  { value: "a4_6", label: "A4 · 6 placas", description: "Placa compacta, seis por folha" },
  { value: "a5", label: "A5", description: "Uma placa por página A5" },
  { value: "table_tent", label: "Display dobrável", description: "Frente e verso em A4 paisagem" },
  { value: "sticker", label: "Adesivo", description: "Doze etiquetas por folha A4" },
];

export const TABLE_QR_TEMPLATES: Array<{
  value: TableQrVisualTemplate;
  label: string;
  description: string;
}> = [
  { value: "classic", label: "Clássico", description: "Marca, chamada e instruções completas" },
  { value: "compact", label: "Compacto", description: "Mais QR, menos texto" },
  { value: "minimal", label: "Minimalista", description: "Nome, mesa e QR" },
];

export function tableQrLayout(format: TableQrPrintFormat): PrintLayout {
  if (format === "a4_2") {
    return { capacity: 2, columns: 1, page: "a4", orientation: "portrait", rows: 2 };
  }
  if (format === "a4_4") {
    return { capacity: 4, columns: 2, page: "a4", orientation: "portrait", rows: 2 };
  }
  if (format === "a4_6") {
    return { capacity: 6, columns: 2, page: "a4", orientation: "portrait", rows: 3 };
  }
  if (format === "a5") {
    return { capacity: 1, columns: 1, page: "a5", orientation: "portrait", rows: 1 };
  }
  if (format === "table_tent") {
    return { capacity: 1, columns: 2, page: "a4", orientation: "landscape", rows: 1 };
  }
  return { capacity: 12, columns: 3, page: "a4", orientation: "portrait", rows: 4 };
}

export function escapeTableQrHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character] ?? character;
  });
}

function validColor(value: string) {
  return tableQrContrast(value).effectiveColor;
}

function printablePanel(row: RenderedTableQr, settings: TableQrSettings) {
  const logo = settings.logoUrl
    ? `<img class="qr-logo" src="${escapeTableQrHtml(settings.logoUrl)}" alt="">`
    : "";
  const detail =
    settings.template === "minimal"
      ? ""
      : `<p class="qr-instructions">${escapeTableQrHtml(settings.instructions)}</p>`;
  const notices =
    settings.template === "classic"
      ? [settings.wifiNotice, settings.serviceChargeNotice]
          .filter((notice): notice is string => Boolean(notice?.trim()))
          .map((notice) => `<small>${escapeTableQrHtml(notice)}</small>`)
          .join("")
      : "";
  return `<section class="qr-panel qr-panel--${settings.template}">${logo}<span class="qr-brand">${escapeTableQrHtml(settings.displayName)}</span><h2>${escapeTableQrHtml(row.label)}</h2><p class="qr-headline">${escapeTableQrHtml(settings.headline)}</p><img class="qr-code" src="${escapeTableQrHtml(row.dataUrl)}" alt="QR Code da ${escapeTableQrHtml(row.label)}">${detail}${notices}</section>`;
}

export function buildTableQrPrintHtml(
  rows: ReadonlyArray<RenderedTableQr>,
  settings: TableQrSettings,
  format: TableQrPrintFormat,
) {
  const layout = tableQrLayout(format);
  const pageSize = layout.page === "a5" ? "A5" : "A4";
  const color = validColor(settings.primaryColor);
  const cards = rows
    .map((row) => {
      const panel = printablePanel(row, settings);
      return format === "table_tent"
        ? `<article class="qr-card qr-card--tent">${panel}<div class="qr-fold" aria-hidden="true">DOBRAR</div>${panel}</article>`
        : `<article class="qr-card">${panel}</article>`;
    })
    .join("");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QR das mesas · ${escapeTableQrHtml(settings.displayName)}</title><style>@page{size:${pageSize} ${layout.orientation};margin:8mm}*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:#fff;color:#111827;font-family:Arial,sans-serif;display:grid;grid-template-columns:repeat(${format === "table_tent" ? 1 : layout.columns},minmax(0,1fr));gap:5mm}.qr-card{border:1.5px dashed ${color};border-radius:4mm;break-after:${format === "a5" || format === "table_tent" ? "page" : "auto"};break-inside:avoid;display:flex;min-height:${format === "sticker" ? "63mm" : format === "a4_6" ? "88mm" : format === "a5" ? "194mm" : "134mm"}}.qr-panel{align-items:center;display:flex;flex:1;flex-direction:column;justify-content:center;min-width:0;padding:${format === "sticker" ? "3mm" : "7mm"};text-align:center}.qr-logo{height:${format === "sticker" ? "8mm" : "15mm"};max-width:35mm;object-fit:contain}.qr-brand{color:${color};font-size:${format === "sticker" ? "7pt" : "10pt"};font-weight:800;margin-top:2mm}.qr-panel h2{font-size:${format === "sticker" ? "11pt" : "20pt"};margin:2mm 0 1mm}.qr-headline{font-size:${format === "sticker" ? "6.5pt" : "10pt"};font-weight:700;margin:0 0 2mm}.qr-code{height:${format === "sticker" ? "25mm" : settings.template === "compact" ? "58mm" : "50mm"};max-height:46%;max-width:80%;width:auto}.qr-instructions{color:#475569;font-size:${format === "sticker" ? "6pt" : "8.5pt"};line-height:1.35;margin:2mm 0 0;max-width:70mm}.qr-panel small{color:#475569;display:block;font-size:7pt;margin-top:1.5mm}.qr-card--tent{display:grid;grid-template-columns:1fr auto 1fr;min-height:190mm}.qr-fold{align-items:center;border-left:1px dashed #94a3b8;color:#64748b;display:flex;font-size:7pt;letter-spacing:.12em;padding:2mm;writing-mode:vertical-rl}.qr-panel--minimal .qr-headline{display:none}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${cards}<script>window.addEventListener("load",()=>window.print(),{once:true});</script></body></html>`;
}

function dataUrlFromBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem da marca."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Não foi possível ler a imagem da marca."));
    reader.readAsDataURL(blob);
  });
}

async function loadLogo(url: string | null) {
  if (!url) return null;
  const response = await fetch(url, { credentials: "omit", mode: "cors" });
  if (!response.ok) throw new Error("A logo remota não permitiu download.");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("A URL da logo não retornou uma imagem.");
  return {
    dataUrl: await dataUrlFromBlob(blob),
    format: blob.type.split("/")[1]?.toUpperCase() ?? "PNG",
  };
}

export async function createTableQrPdf(
  rows: ReadonlyArray<RenderedTableQr>,
  settings: TableQrSettings,
  format: TableQrPrintFormat,
): Promise<{ blob: Blob; warnings: string[] }> {
  if (rows.length === 0) throw new Error("Selecione ao menos uma mesa para gerar o PDF.");
  const [{ jsPDF }, logoResult] = await Promise.all([
    import("jspdf"),
    loadLogo(settings.logoUrl).catch(() => null),
  ]);
  const warnings =
    settings.logoUrl && !logoResult
      ? ["A logo remota não permitiu incorporação no PDF; o arquivo foi gerado sem ela."]
      : [];
  const layout = tableQrLayout(format);
  const document = new jsPDF({
    format: layout.page,
    orientation: layout.orientation,
    unit: "mm",
  });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const margin = 8;
  const gap = 5;
  const renderColumns = format === "table_tent" ? 1 : layout.columns;
  const cardWidth = (pageWidth - margin * 2 - gap * (renderColumns - 1)) / renderColumns;
  const cardHeight = (pageHeight - margin * 2 - gap * (layout.rows - 1)) / layout.rows;
  const primary = validColor(settings.primaryColor);

  rows.forEach((row, index) => {
    const pageIndex = Math.floor(index / layout.capacity);
    const slot = index % layout.capacity;
    if (pageIndex > 0 && slot === 0) document.addPage(layout.page, layout.orientation);
    const column = slot % renderColumns;
    const line = Math.floor(slot / renderColumns);
    const x = margin + column * (cardWidth + gap);
    const y = margin + line * (cardHeight + gap);
    const panelCount = format === "table_tent" ? 2 : 1;
    const panelWidth = cardWidth / panelCount;

    document.setDrawColor(primary);
    document.setLineDashPattern([2, 1.5], 0);
    document.roundedRect(x, y, cardWidth, cardHeight, 3, 3);
    document.setLineDashPattern([], 0);
    if (format === "table_tent") {
      document.setDrawColor("#94a3b8");
      document.setLineDashPattern([1, 1], 0);
      document.line(x + panelWidth, y, x + panelWidth, y + cardHeight);
      document.setLineDashPattern([], 0);
    }

    for (let panel = 0; panel < panelCount; panel += 1) {
      const panelX = x + panel * panelWidth;
      const compact = format === "sticker" || settings.template !== "classic";
      const center = panelX + panelWidth / 2;
      let cursor = y + (compact ? 5 : 8);
      if (logoResult) {
        try {
          document.addImage(logoResult.dataUrl, logoResult.format, center - 8, cursor, 16, 12);
          cursor += 14;
        } catch {
          if (
            !warnings.includes(
              "A logo não pôde ser renderizada no PDF; o arquivo foi gerado sem ela.",
            )
          ) {
            warnings.push("A logo não pôde ser renderizada no PDF; o arquivo foi gerado sem ela.");
          }
        }
      }
      document.setTextColor(primary);
      document.setFont("helvetica", "bold");
      document.setFontSize(format === "sticker" ? 7 : 10);
      document.text(settings.displayName, center, cursor, {
        align: "center",
        maxWidth: panelWidth - 8,
      });
      cursor += format === "sticker" ? 4 : 6;
      document.setTextColor("#111827");
      document.setFontSize(format === "sticker" ? 11 : 18);
      document.text(row.label, center, cursor, { align: "center", maxWidth: panelWidth - 8 });
      cursor += format === "sticker" ? 4 : 7;
      if (settings.template !== "minimal") {
        document.setFontSize(format === "sticker" ? 6 : 9);
        document.text(settings.headline, center, cursor, {
          align: "center",
          maxWidth: panelWidth - 8,
        });
        cursor += format === "sticker" ? 3 : 5;
      }
      const qrSize = Math.min(
        format === "sticker" ? 24 : settings.template === "compact" ? 55 : 48,
        panelWidth - 12,
        cardHeight * (format === "sticker" ? 0.42 : 0.48),
      );
      document.addImage(row.dataUrl, "PNG", center - qrSize / 2, cursor, qrSize, qrSize);
      cursor += qrSize + 3;
      if (settings.template === "classic" && format !== "sticker") {
        document.setFont("helvetica", "normal");
        document.setTextColor("#475569");
        document.setFontSize(8);
        document.text(settings.instructions, center, cursor, {
          align: "center",
          maxWidth: panelWidth - 12,
        });
      }
    }
  });

  return { blob: document.output("blob"), warnings };
}

export function downloadTableQrBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}
