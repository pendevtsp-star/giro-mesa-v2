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
};

export function buildTableQrPrintHtml(
  rows: ReadonlyArray<{ label: string; dataUrl: string }>,
  brand: CatalogPrintBrand = {},
) {
  const color = /^#[0-9a-f]{6}$/i.test(brand.primaryColor ?? "") ? brand.primaryColor : "#059669";
  const brandHeader = `${brand.logoUrl ? `<img class="brand-logo" src="${escapeCatalogHtml(brand.logoUrl)}" alt="">` : ""}<strong class="brand-name">${escapeCatalogHtml(brand.displayName?.trim() || "GiroMesa")}</strong>`;
  const cards = rows
    .map(
      ({ label, dataUrl }) =>
        `<article>${brandHeader}<h2>${escapeCatalogHtml(label)}</h2><img class="qr-code" src="${escapeCatalogHtml(dataUrl)}" alt="QR Code ${escapeCatalogHtml(label)}"><p>Aponte a câmera para abrir o cardápio e pedir.</p></article>`,
    )
    .join("");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR Codes de mesas</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;display:grid;grid-template-columns:1fr 1fr;gap:12mm}article{text-align:center;border:2px solid ${color};border-radius:12px;padding:16px;break-inside:avoid}.brand-logo{display:block;width:52px;height:52px;object-fit:contain;margin:0 auto 6px}.brand-name{display:block;color:${color};margin-bottom:12px}h2{margin:0 0 8px}.qr-code{width:180px;height:180px}p{font-size:12px;color:#475569}</style></head><body>${cards}<script>window.onload=()=>window.print();</script></body></html>`;
}
