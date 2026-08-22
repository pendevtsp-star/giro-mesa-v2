import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

export type ReportArtifactFormat = "csv" | "pdf" | "xlsx";

export interface ReportArtifactOptions {
  brandName?: string;
  subtitle?: string;
  organizationName?: string;
  unitName?: string;
  period?: { from: string; to: string };
  timezone?: string;
  generatedAt?: Date | string;
  generatedBy?: string;
  reference?: string;
  classification?: string;
  family?: string;
  filters?: Readonly<Record<string, unknown>>;
  summary?: ReadonlyArray<{ label: string; value: unknown }>;
  warnings?: readonly string[];
  orientation?: "auto" | "portrait" | "landscape";
}

const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export function reportRowsCsv(rows: readonly Record<string, unknown>[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `\uFEFF${[
    columns.map(csvCell).join(";"),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(";")),
  ].join("\r\n")}`;
}

export function parseReportCsv(content: string) {
  const records: string[][] = [[""]];
  let quoted = false;
  for (let index = content.charCodeAt(0) === 0xfeff ? 1 : 0; index < content.length; index += 1) {
    const character = content[index] ?? "";
    const row = records.at(-1) as string[];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        row[row.length - 1] += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ";" && !quoted) row.push("");
    else if ((character === "\r" || character === "\n") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      records.push([""]);
    } else row[row.length - 1] += character;
  }
  if (records.at(-1)?.length === 1 && records.at(-1)?.[0] === "") records.pop();
  const [columns = [], ...rows] = records;
  return rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""])),
  );
}

const xml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const columnName = (index: number) => {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
};

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZipArtifact(files: ReadonlyArray<{ name: string; content: string | Buffer }>) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const content = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, "utf8");
    const compressed = deflateRawSync(content);
    const checksum = crc32(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(content.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

function reportRowsXlsx(rows: readonly Record<string, unknown>[]) {
  const normalized = rows.length ? rows : [{ mensagem: "Sem dados no período" }];
  const columns = [...new Set(normalized.flatMap((row) => Object.keys(row)))];
  const cell = (value: unknown, row: number, column: number) => {
    const reference = `${columnName(column)}${row}`;
    if (typeof value === "number" && Number.isFinite(value))
      return `<c r="${reference}"><v>${value}</v></c>`;
    let safe = String(value ?? "");
    if (/^[=+\-@]/.test(safe)) safe = `'${safe}`;
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(safe)}</t></is></c>`;
  };
  const sheetRows = [columns, ...normalized.map((row) => columns.map((key) => row[key]))]
    .map(
      (values, index) =>
        `<row r="${index + 1}">${values.map((value, column) => cell(value, index + 1, column)).join("")}</row>`,
    )
    .join("");
  return buildZipArtifact([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    },
    {
      name: "xl/styles.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>',
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
  ]);
}

const pdfText = (value: unknown) => {
  const normalized = String(value ?? "")
    .normalize("NFC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\xff]/g, "?");
  return [...Buffer.from(normalized, "latin1")]
    .map((byte) => {
      if (byte === 0x28 || byte === 0x29 || byte === 0x5c) return `\\${String.fromCharCode(byte)}`;
      if (byte < 0x20 || byte >= 0x7f) return `\\${byte.toString(8).padStart(3, "0")}`;
      return String.fromCharCode(byte);
    })
    .join("");
};

const ptBrNumber = new Intl.NumberFormat("pt-BR");
const ptBrCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const humanizePdfColumn = (column: string) =>
  column
    .replace(/(?:_cents|Cents)$/i, "")
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (value) => value.toLocaleUpperCase("pt-BR"));

const formatPdfDate = (value: string, timezone?: string) => {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      ...(value.length > 10 ? { timeStyle: "short" as const } : {}),
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(parsed);
  } catch {
    return value;
  }
};

const formatPdfValue = (column: string, value: unknown, timezone?: string) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (/(?:_cents|Cents)$/i.test(column) && Number.isFinite(Number(value)))
    return ptBrCurrency.format(Number(value) / 100);
  if (typeof value === "number" && Number.isFinite(value)) return ptBrNumber.format(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    return formatPdfDate(value, timezone);
  return String(value);
};

const wrapPdfText = (value: string, width: number, fontSize: number) => {
  const maximum = Math.max(3, Math.floor((width - 8) / (fontSize * 0.52)));
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words.length ? words : [""]) {
      const parts = word.match(new RegExp(`.{1,${maximum}}`, "g")) ?? [word];
      for (const part of parts) {
        if (!line) line = part;
        else if (`${line} ${part}`.length <= maximum) line += ` ${part}`;
        else {
          lines.push(line);
          line = part;
        }
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
};

interface PdfTableGroup {
  title: string;
  columns: string[];
  rows: readonly Record<string, unknown>[];
}

function reportPdfGroups(rows: readonly Record<string, unknown>[]): PdfTableGroup[] {
  const sectionColumn = ["seção", "secao", "section"].find((key) => rows.some((row) => key in row));
  if (!sectionColumn)
    return [
      {
        title: "Detalhamento",
        columns: [...new Set(rows.flatMap((row) => Object.keys(row)))],
        rows,
      },
    ];
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const title = humanizePdfColumn(String(row[sectionColumn] ?? "Detalhamento"));
    const copy = { ...row };
    delete copy[sectionColumn];
    const existing = grouped.get(title) ?? [];
    existing.push(copy);
    grouped.set(title, existing);
  }
  return [...grouped].map(([title, groupRows]) => ({
    title,
    columns: [...new Set(groupRows.flatMap((row) => Object.keys(row)))],
    rows: groupRows,
  }));
}

function reportRowsPdf(
  title: string,
  rows: readonly Record<string, unknown>[],
  options: ReportArtifactOptions,
) {
  const groups = reportPdfGroups(rows);
  const widestTable = Math.max(0, ...groups.map((group) => group.columns.length));
  const landscape =
    options.orientation === "landscape" || (options.orientation !== "portrait" && widestTable > 5);
  const width = landscape ? 842 : 595;
  const height = landscape ? 595 : 842;
  const margin = 36;
  const bottom = 42;
  const bodyFontSize = widestTable > 9 ? 6 : widestTable > 6 ? 7 : 8;
  const lineHeight = bodyFontSize + 3;
  const pages: string[][] = [];
  let commands: string[] = [];
  let y = 0;
  let currentWidths: number[] = [];

  const text = (value: unknown, x: number, baseline: number, size = 8, bold = false) => {
    commands.push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${baseline} Td (${pdfText(value)}) Tj ET`,
    );
  };
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    commands.push(`0.78 0.8 0.78 RG 0.5 w ${x1} ${y1} m ${x2} ${y2} l S`);
  const fill = (x: number, fromY: number, cellWidth: number, cellHeight: number, color: string) =>
    commands.push(`${color} rg ${x} ${fromY} ${cellWidth} ${cellHeight} re f`);

  const columnWidths = (group: PdfTableGroup) => {
    const available = width - margin * 2;
    const weights = group.columns.map((column) => {
      const content = group.rows
        .slice(0, 30)
        .reduce(
          (maximum, row) =>
            Math.max(maximum, formatPdfValue(column, row[column], options.timezone).length),
          humanizePdfColumn(column).length,
        );
      return Math.min(28, Math.max(8, content));
    });
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    return weights.map((value) => (available * value) / total);
  };

  const tableHeader = (group: PdfTableGroup) => {
    currentWidths = columnWidths(group);
    const wrapped = group.columns.map((column, index) =>
      wrapPdfText(humanizePdfColumn(column), currentWidths[index] ?? 0, bodyFontSize),
    );
    const headerHeight = Math.max(1, ...wrapped.map((cell) => cell.length)) * lineHeight + 7;
    fill(margin, y - headerHeight, width - margin * 2, headerHeight, "0.91 0.95 0.92");
    let x = margin;
    wrapped.forEach((cell, index) => {
      cell.forEach((value, lineIndex) => {
        text(value, x + 4, y - 10 - lineIndex * lineHeight, bodyFontSize, true);
      });
      x += currentWidths[index] ?? 0;
    });
    line(margin, y - headerHeight, width - margin, y - headerHeight);
    y -= headerHeight;
  };

  const beginPage = (group: PdfTableGroup, first: boolean, continuation: boolean) => {
    if (commands.length) pages.push(commands);
    commands = [];
    text(options.brandName ?? "GIROMESA", margin, height - 35, 9, true);
    text(title, margin, height - 56, first ? 16 : 12, true);
    y = height - (first ? 72 : 68);
    if (first) {
      if (options.subtitle) {
        text(options.subtitle, margin, y, 9);
        y -= 16;
      }
      const context = [
        options.organizationName,
        options.unitName,
        options.period
          ? `Período: ${formatPdfDate(options.period.from)} a ${formatPdfDate(options.period.to)}`
          : undefined,
        options.family ? `Família: ${humanizePdfColumn(options.family)}` : undefined,
        options.timezone ? `Fuso: ${options.timezone}` : undefined,
      ].filter(Boolean);
      if (context.length) {
        text(context.join("  |  "), margin, y, 8);
        y -= 15;
      }
      const audit = [
        options.generatedAt
          ? `Emitido em ${formatPdfDate(
              options.generatedAt instanceof Date
                ? options.generatedAt.toISOString()
                : options.generatedAt,
              options.timezone,
            )}`
          : undefined,
        options.generatedBy ? `Solicitante: ${options.generatedBy}` : undefined,
        options.reference ? `Referência: ${options.reference}` : undefined,
      ].filter(Boolean);
      if (audit.length) {
        text(audit.join("  |  "), margin, y, 8);
        y -= 15;
      }
      const summary = [
        { label: "Registros exportados", value: rows.length },
        ...(options.summary ?? []),
      ];
      text("Resumo", margin, y, 9, true);
      y -= 13;
      const summaryText = summary
        .map((item) => `${item.label}: ${formatPdfValue(item.label, item.value, options.timezone)}`)
        .join("  |  ");
      for (const value of wrapPdfText(summaryText, width - margin * 2, 8)) {
        text(value, margin, y, 8);
        y -= 11;
      }
      if (options.filters && Object.keys(options.filters).length) {
        const filters = Object.entries(options.filters)
          .map(
            ([key, value]) =>
              `${humanizePdfColumn(key)}: ${formatPdfValue(key, value, options.timezone)}`,
          )
          .join("  |  ");
        text("Filtros aplicados", margin, y - 2, 8, true);
        y -= 14;
        for (const value of wrapPdfText(filters, width - margin * 2, 8)) {
          text(value, margin, y, 8);
          y -= 11;
        }
      }
      for (const warning of options.warnings ?? []) {
        fill(margin, y - 14, width - margin * 2, 18, "0.98 0.94 0.84");
        text(`Atenção: ${warning}`, margin + 5, y - 7, 8, true);
        y -= 23;
      }
    } else if (options.period) {
      text(
        `${formatPdfDate(options.period.from)} a ${formatPdfDate(options.period.to)}${
          options.timezone ? `  |  ${options.timezone}` : ""
        }`,
        margin,
        y,
        8,
      );
      y -= 15;
    }
    line(margin, y, width - margin, y);
    y -= 18;
    text(`${group.title}${continuation ? " - continuação" : ""}`, margin, y, 10, true);
    y -= 12;
    tableHeader(group);
  };

  const renderRowPart = (cells: string[][], offset: number, count: number, numeric: boolean[]) => {
    const rowHeight = count * lineHeight + 7;
    let x = margin;
    cells.forEach((cell, columnIndex) => {
      const cellWidth = currentWidths[columnIndex] ?? 0;
      cell.slice(offset, offset + count).forEach((value, lineIndex) => {
        const approximateWidth = value.length * bodyFontSize * 0.52;
        const textX = numeric[columnIndex]
          ? Math.max(x + 4, x + cellWidth - approximateWidth - 4)
          : x + 4;
        text(value, textX, y - 10 - lineIndex * lineHeight, bodyFontSize);
      });
      x += cellWidth;
    });
    line(margin, y - rowHeight, width - margin, y - rowHeight);
    y -= rowHeight;
  };

  if (!rows.length) {
    const empty = groups[0] ?? { title: "Detalhamento", columns: [], rows: [] };
    beginPage(empty, true, false);
    text("Nenhum registro encontrado para os filtros e o período informados.", margin, y - 18, 10);
  } else {
    let firstPage = true;
    for (const group of groups) {
      if (!commands.length) beginPage(group, firstPage, false);
      else if (y < bottom + 70) beginPage(group, false, false);
      else {
        y -= 15;
        text(group.title, margin, y, 10, true);
        y -= 12;
        tableHeader(group);
      }
      firstPage = false;
      for (const row of group.rows) {
        const cells = group.columns.map((column, index) =>
          wrapPdfText(
            formatPdfValue(column, row[column], options.timezone),
            currentWidths[index] ?? 0,
            bodyFontSize,
          ),
        );
        const numeric = group.columns.map((column) =>
          group.rows.every(
            (item) =>
              item[column] === null ||
              item[column] === undefined ||
              Number.isFinite(Number(item[column])),
          ),
        );
        const totalLines = Math.max(1, ...cells.map((cell) => cell.length));
        let offset = 0;
        while (offset < totalLines) {
          const availableLines = Math.floor((y - bottom - 7) / lineHeight);
          if (availableLines < 1) {
            beginPage(group, false, true);
            continue;
          }
          const count = Math.min(totalLines - offset, availableLines);
          renderRowPart(cells, offset, count, numeric);
          offset += count;
          if (offset < totalLines) beginPage(group, false, true);
        }
      }
    }
  }
  if (commands.length) pages.push(commands);

  pages.forEach((page, index) => {
    page.push(`0.78 0.8 0.78 RG 0.5 w ${margin} 29 m ${width - margin} 29 l S`);
    const footer = [
      options.classification ?? "Documento auditável GiroMesa",
      options.reference ? `Ref. ${options.reference}` : undefined,
    ]
      .filter(Boolean)
      .join("  |  ");
    page.push(`BT /F1 7 Tf ${margin} 17 Td (${pdfText(footer)}) Tj ET`);
    page.push(
      `BT /F1 7 Tf ${width - margin - 62} 17 Td (${pdfText(
        `Página ${index + 1}/${pages.length}`,
      )}) Tj ET`,
    );
  });

  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((page, index) => {
    const pageId = pageIds[index] ?? 5;
    const contentId = pageId + 1;
    const body = page.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(body, "ascii")} >>\nstream\n${body}\nendstream`;
  });
  let document = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(document, "latin1");
    document += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document, "latin1");
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join("\n")}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(document, "latin1");
}

export function buildReportArtifact(
  format: ReportArtifactFormat,
  rows: readonly Record<string, unknown>[],
  title = "Relatório GiroMesa",
  options: ReportArtifactOptions = {},
) {
  const binary =
    format === "pdf"
      ? reportRowsPdf(title, rows, options)
      : format === "xlsx"
        ? reportRowsXlsx(rows)
        : null;
  const content = binary ? binary.toString("base64") : reportRowsCsv(rows);
  const digestSource = binary ?? Buffer.from(content, "utf8");
  return {
    content,
    contentEncoding: binary ? ("base64" as const) : ("utf8" as const),
    mimeType:
      format === "pdf"
        ? "application/pdf"
        : format === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv; charset=utf-8",
    extension: format,
    sha256: createHash("sha256").update(digestSource).digest("hex"),
  };
}
