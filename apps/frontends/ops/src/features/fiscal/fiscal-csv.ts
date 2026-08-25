export interface FiscalTaxImportRow {
  productId: string;
  status: "active";
  effectiveFrom: string;
  classification: {
    ncm: string;
    cfop: string;
    origin: number;
    csosn?: string;
    cstIcms?: string;
    cstPis: string;
    cstCofins: string;
    cstIbsCbs?: string;
    cClassTrib?: string;
  };
}

const headers = [
  "productId",
  "productName",
  "category",
  "ncm",
  "cfop",
  "origin",
  "csosn",
  "cstIcms",
  "cstPis",
  "cstCofins",
  "cstIbsCbs",
  "cClassTrib",
  "effectiveFrom",
] as const;

export function fiscalTaxCsvTemplate(
  products: Array<{ id: string; name: string; categoryName: string }>,
  effectiveFrom: string,
) {
  return [
    headers.join(","),
    ...products.map((product) =>
      [
        product.id,
        product.name,
        product.categoryName,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        effectiveFrom,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
}

export function parseFiscalTaxCsv(csv: string, allowedProductIds: ReadonlySet<string>) {
  const table = parseCsv(csv);
  const [header, ...rows] = table;
  if (!header) throw new Error("O arquivo CSV está vazio.");
  const positions = new Map(
    header.map((name, index) => [name.replace(/^\uFEFF/, "").trim(), index]),
  );
  for (const required of [
    "productId",
    "ncm",
    "cfop",
    "origin",
    "cstPis",
    "cstCofins",
    "effectiveFrom",
  ]) {
    if (!positions.has(required)) throw new Error(`A coluna ${required} é obrigatória.`);
  }
  const value = (row: string[], name: string) => row[positions.get(name) ?? -1]?.trim() ?? "";
  const parsed: FiscalTaxImportRow[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (row.every((cell) => cell.trim() === "")) return;
    const line = index + 2;
    const productId = value(row, "productId");
    const ncm = value(row, "ncm");
    const cfop = value(row, "cfop");
    const origin = value(row, "origin");
    const effectiveFrom = value(row, "effectiveFrom");
    const csosn = value(row, "csosn");
    const cstIcms = value(row, "cstIcms");
    const cstPis = value(row, "cstPis");
    const cstCofins = value(row, "cstCofins");
    const cstIbsCbs = value(row, "cstIbsCbs");
    const cClassTrib = value(row, "cClassTrib");
    if (!allowedProductIds.has(productId)) throw new Error(`Linha ${line}: produto inválido.`);
    if (seen.has(productId)) throw new Error(`Linha ${line}: produto repetido.`);
    if (!/^\d{8}$/.test(ncm)) throw new Error(`Linha ${line}: NCM deve ter 8 dígitos.`);
    if (!/^\d{4}$/.test(cfop)) throw new Error(`Linha ${line}: CFOP deve ter 4 dígitos.`);
    if (!/^[0-8]$/.test(origin)) throw new Error(`Linha ${line}: origem deve estar entre 0 e 8.`);
    if (csosn && !/^\d{3}$/.test(csosn)) throw new Error(`Linha ${line}: CSOSN inválido.`);
    if (cstIcms && !/^\d{2,3}$/.test(cstIcms)) throw new Error(`Linha ${line}: CST ICMS inválido.`);
    if (!csosn && !cstIcms) throw new Error(`Linha ${line}: informe CSOSN ou CST ICMS.`);
    if (!/^\d{2}$/.test(cstPis)) throw new Error(`Linha ${line}: CST PIS inválido.`);
    if (!/^\d{2}$/.test(cstCofins)) throw new Error(`Linha ${line}: CST COFINS inválido.`);
    if (Boolean(cstIbsCbs) !== Boolean(cClassTrib)) {
      throw new Error(`Linha ${line}: informe CST IBS/CBS e cClassTrib em conjunto.`);
    }
    if (cstIbsCbs && !/^\d{3}$/.test(cstIbsCbs)) {
      throw new Error(`Linha ${line}: CST IBS/CBS inválido.`);
    }
    if (cClassTrib && !/^\d{6}$/.test(cClassTrib)) {
      throw new Error(`Linha ${line}: cClassTrib inválido.`);
    }
    if (!validDate(effectiveFrom)) throw new Error(`Linha ${line}: vigência inválida.`);
    seen.add(productId);
    parsed.push({
      productId,
      status: "active",
      effectiveFrom,
      classification: {
        ncm,
        cfop,
        origin: Number(origin),
        ...(csosn ? { csosn } : {}),
        ...(cstIcms ? { cstIcms } : {}),
        cstPis,
        cstCofins,
        ...(cstIbsCbs ? { cstIbsCbs } : {}),
        ...(cClassTrib ? { cClassTrib } : {}),
      },
    });
  });
  if (!parsed.length) throw new Error("O CSV não possui produtos preenchidos.");
  if (parsed.length > 500) throw new Error("Importe no máximo 500 produtos por arquivo.");
  return parsed;
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("O CSV possui aspas não fechadas.");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
}
