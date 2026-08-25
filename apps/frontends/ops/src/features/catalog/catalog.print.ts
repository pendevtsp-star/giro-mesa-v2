export function escapeCatalogHtml(value: string) {
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

export type CatalogPrintBrand = {
  displayName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  wifiNotice?: string | null;
};

const tableLabelCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

export function selectTableQrRows<T extends { tableId: string; label: string }>(
  rows: ReadonlyArray<T>,
  selectedTableIds: ReadonlySet<string>,
) {
  return rows
    .filter((row) => selectedTableIds.has(row.tableId))
    .toSorted(
      (left, right) =>
        tableLabelCollator.compare(left.label, right.label) ||
        left.tableId.localeCompare(right.tableId),
    );
}

export function buildTableQrPrintHtml(
  rows: ReadonlyArray<{ label: string; dataUrl: string }>,
  brand: CatalogPrintBrand = {},
) {
  const color = /^#[0-9a-f]{6}$/i.test(brand.primaryColor ?? "") ? brand.primaryColor : "#059669";
  const brandHeader = `${brand.logoUrl ? `<img class="brand-logo" src="${escapeCatalogHtml(brand.logoUrl)}" alt="">` : ""}<strong class="brand-name">${escapeCatalogHtml(brand.displayName?.trim() || "GiroMesa")}</strong>`;
  const wifiNotice = brand.wifiNotice?.trim()
    ? `<p class="wifi">${escapeCatalogHtml(brand.wifiNotice.trim())}</p>`
    : "";
  const cards = rows
    .map(
      ({ label, dataUrl }) =>
        `<article>${brandHeader}<h2>${escapeCatalogHtml(label)}</h2><img class="qr-code" src="${escapeCatalogHtml(dataUrl)}" alt="QR Code ${escapeCatalogHtml(label)}"><p>Aponte a câmera para abrir o cardápio e solicitar atendimento.</p>${wifiNotice}</article>`,
    )
    .join("");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QR Codes de mesas</title><style>@page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;display:grid;grid-template-columns:1fr 1fr;gap:10mm}article{height:246mm;text-align:center;border:2px dashed ${color};border-radius:12px;padding:14mm 8mm;break-inside:avoid;display:flex;flex-direction:column;align-items:center;justify-content:center}.brand-logo{display:block;width:18mm;height:18mm;object-fit:contain;margin:0 auto 3mm}.brand-name{display:block;color:${color};margin-bottom:6mm;font-size:15px}h2{margin:0 0 5mm;font-size:24px}.qr-code{display:block;width:58mm;height:58mm;image-rendering:auto}p{max-width:64mm;margin:5mm 0 0;font-size:12px;line-height:1.4;color:#475569}.wifi{margin-top:6mm;padding-top:4mm;border-top:1px solid #cbd5e1;font-weight:700}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${cards}<script>window.addEventListener("load",()=>window.print(),{once:true});</script></body></html>`;
}
