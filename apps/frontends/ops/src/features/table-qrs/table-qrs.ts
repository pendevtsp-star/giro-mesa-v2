import type { CatalogTableQr, TableQrPrintBatch, TableQrTestResult } from "../../api";

const tableLabelCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

export function sortTableQrs<T extends Pick<CatalogTableQr, "tableId" | "label">>(
  rows: ReadonlyArray<T>,
) {
  return rows.toSorted(
    (left, right) =>
      tableLabelCollator.compare(left.label, right.label) ||
      left.tableId.localeCompare(right.tableId),
  );
}

export function selectedTableQrs<T extends Pick<CatalogTableQr, "tableId" | "label">>(
  rows: ReadonlyArray<T>,
  selectedIds: ReadonlySet<string>,
) {
  return sortTableQrs(rows.filter((row) => selectedIds.has(row.tableId)));
}

function linearChannel(value: string) {
  const channel = Number.parseInt(value, 16) / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function tableQrContrast(background: string) {
  if (!/^#[0-9a-f]{6}$/i.test(background)) {
    return { effectiveColor: "#334155", ratio: 1, passes: false };
  }
  const channels = [1, 3, 5].map((index) => linearChannel(background.slice(index, index + 2)));
  const luminance =
    0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
  const whiteRatio = 1.05 / (luminance + 0.05);
  const passes = whiteRatio >= 4.5;
  return { effectiveColor: passes ? background : "#334155", ratio: whiteRatio, passes };
}

export function tableQrTestMessage(result: TableQrTestResult) {
  if (result.valid) {
    return `Estabelecimento: ${result.displayName ?? "não informado"} · Unidade: ${result.unitName ?? "não informada"} · Mesa: ${result.tableLabel ?? "não informada"} · QR v${result.tokenVersion ?? "atual"}.`;
  }
  const messages: Record<NonNullable<TableQrTestResult["reason"]>, string> = {
    invalid_url: "A URL não pertence a um QR de mesa válido.",
    invalid_signature: "A assinatura do QR é inválida.",
    table_not_found: "A mesa vinculada não está mais ativa nesta unidade.",
    rotated: "Este QR foi rotacionado e não deve mais ser usado.",
  };
  return result.reason ? messages[result.reason] : "O QR não pôde ser confirmado.";
}

export function canReprintTableQrBatch(batch: TableQrPrintBatch) {
  return batch.tables.every((table) => table.isCurrent && Boolean(table.url));
}

export function tableQrActorLabel(identityId: string | null, displayName?: string | null) {
  return displayName?.trim() || identityId || "Sistema";
}

export function tableQrFilename(label: string, extension: "svg" | "png") {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `qr-${slug || "mesa"}.${extension}`;
}
