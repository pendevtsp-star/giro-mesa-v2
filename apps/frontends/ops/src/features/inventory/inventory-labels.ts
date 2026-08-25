import QRCode from "qrcode";
import { escapeCatalogHtml } from "../catalog/catalog.print";

export interface InventoryLabel {
  title: string;
  detail: string;
  code: string;
}

export function buildInventoryLabelsHtml(
  labels: ReadonlyArray<InventoryLabel & { dataUrl: string }>,
) {
  const cards = labels
    .map(
      (label) =>
        `<article><img src="${escapeCatalogHtml(label.dataUrl)}" alt="QR ${escapeCatalogHtml(label.title)}"><strong>${escapeCatalogHtml(label.title)}</strong><small>${escapeCatalogHtml(label.detail)}</small><code>${escapeCatalogHtml(label.code)}</code></article>`,
    )
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas de estoque</title><style>@page{size:A4;margin:8mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}article{min-height:58mm;border:1px dashed #64748b;padding:4mm;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;break-inside:avoid}img{width:32mm;height:32mm}strong,small,code{display:block;max-width:100%;overflow-wrap:anywhere}strong{margin-top:2mm;font-size:12px}small,code{font-size:9px;color:#475569}@media print{body{print-color-adjust:exact}}</style></head><body>${cards}<script>window.addEventListener("load",()=>window.print(),{once:true});</script></body></html>`;
}

export async function printInventoryLabels(labels: ReadonlyArray<InventoryLabel>) {
  if (!labels.length) return false;
  const printable = await Promise.all(
    labels.map(async (label) => ({
      ...label,
      dataUrl: await QRCode.toDataURL(label.code, { width: 256, margin: 1 }),
    })),
  );
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) throw new Error("Permita pop-ups para imprimir as etiquetas.");
  printWindow.document.write(buildInventoryLabelsHtml(printable));
  printWindow.document.close();
  return true;
}
