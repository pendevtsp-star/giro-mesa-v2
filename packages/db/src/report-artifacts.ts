import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

export type ReportArtifactFormat = "csv" | "pdf" | "xlsx";

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

function zip(files: ReadonlyArray<{ name: string; content: string }>) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const content = Buffer.from(file.content, "utf8");
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
  return zip([
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

const pdfText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");

function reportRowsPdf(title: string, rows: readonly Record<string, unknown>[]) {
  const lines = [
    title,
    "",
    ...(rows.length ? rows : [{ mensagem: "Sem dados no periodo" }]).flatMap((row) => {
      const line = Object.entries(row)
        .map(([key, value]) => `${key}: ${String(value ?? "")}`)
        .join(" | ");
      return line.match(/.{1,105}(?:\s|$)/g) ?? [line.slice(0, 105)];
    }),
  ];
  const pages = Array.from({ length: Math.ceil(lines.length / 46) }, (_, index) =>
    lines.slice(index * 46, index * 46 + 46),
  );
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((page, index) => {
    const pageId = pageIds[index] ?? 4;
    const contentId = pageId + 1;
    const body = `BT /F1 9 Tf 42 800 Td 12 TL ${page
      .map((line, lineIndex) => `${lineIndex ? "T* " : ""}(${pdfText(line)}) Tj`)
      .join(" ")} ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`;
  });
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(document);
    document += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join("\n")}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(document, "ascii");
}

export function buildReportArtifact(
  format: ReportArtifactFormat,
  rows: readonly Record<string, unknown>[],
  title = "Relatório GiroMesa",
) {
  const binary =
    format === "pdf" ? reportRowsPdf(title, rows) : format === "xlsx" ? reportRowsXlsx(rows) : null;
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
