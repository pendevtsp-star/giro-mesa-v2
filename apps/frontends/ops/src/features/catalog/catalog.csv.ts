import type { CatalogProduct, PilotCatalog } from "../../operations.shared";

const headers = [
  "ID",
  "Nome",
  "Categoria",
  "Preco_Salao_Reais",
  "Preco_Delivery_Reais",
  "Custo_Reais",
  "Descricao",
  "NCM",
  "CFOP",
  "Disponivel",
  "Preparo_Minutos",
  "Destaques",
  "Limite_Diario",
] as const;

const catalogTags = new Set<NonNullable<CatalogProduct["tags"]>[number]>([
  "chef_special",
  "bestseller",
  "new",
  "promo",
]);

export interface CatalogCsvRow {
  id: CatalogProduct["id"] | null;
  name: CatalogProduct["name"];
  categoryName: string;
  priceCents: CatalogProduct["priceCents"];
  deliveryPriceCents: CatalogProduct["deliveryPriceCents"] | null;
  costCents: CatalogProduct["costCents"] | null;
  description: CatalogProduct["description"];
  ncm: CatalogProduct["ncm"] | null;
  cfop: CatalogProduct["cfop"] | null;
  available: CatalogProduct["available"] | null;
  estimatedPrepTimeMinutes: CatalogProduct["estimatedPrepTimeMinutes"] | null;
  tags: NonNullable<CatalogProduct["tags"]>;
  dailyStockLimit: CatalogProduct["dailyStockLimit"] | null;
}

export function serializeCatalogCsv(catalog: Pick<PilotCatalog, "categories" | "products">) {
  const categoryNames = new Map(
    catalog.categories.map((category) => [category.id, category.name] as const),
  );
  const rows = catalog.products.map((product) => [
    product.id,
    product.name,
    categoryNames.get(product.categoryId) ?? product.categoryId,
    formatCents(product.priceCents),
    formatOptionalCents(product.deliveryPriceCents),
    formatOptionalCents(product.costCents),
    product.description ?? "",
    product.ncm ?? "",
    product.cfop ?? "",
    product.available ? "SIM" : "NAO",
    product.estimatedPrepTimeMinutes ?? "",
    product.tags?.join(";") ?? "",
    product.dailyStockLimit ?? "",
  ]);

  return serializeTable(rows);
}

export function catalogCsvTemplate() {
  return serializeTable([
    [
      "",
      "Burger Artesanal Supreme",
      "Hambúrgueres",
      "42.90",
      "48.90",
      "14.50",
      "Blend 180g, queijo cheddar e bacon.",
      "2106.90.90",
      "5.102",
      "SIM",
      "20",
      "chef_special",
      "50",
    ],
  ]);
}

export function parseCatalogCsv(csv: string): CatalogCsvRow[] {
  const table = parseTable(csv, detectDelimiter(csv));
  const [rawHeader, ...rows] = table;
  if (!rawHeader) throw new Error("O arquivo CSV está vazio.");

  const positions = new Map(
    rawHeader.map((header, index) => [normalizeHeader(header), index] as const),
  );
  const column = (...aliases: string[]) => {
    for (const alias of aliases) {
      const index = positions.get(alias);
      if (index !== undefined) return index;
    }
    return undefined;
  };
  const columns = {
    id: column("id"),
    name: column("nome"),
    category: column("categoria"),
    price: column("preco_salao_reais", "preco_salao"),
    deliveryPrice: column("preco_delivery_reais", "preco_delivery"),
    cost: column("custo_reais", "custo_cmv"),
    description: column("descricao"),
    ncm: column("ncm"),
    cfop: column("cfop"),
    available: column("disponivel"),
    prepTime: column("preparo_minutos"),
    tags: column("destaques"),
    dailyLimit: column("limite_diario"),
  };
  for (const [label, index] of [
    ["Nome", columns.name],
    ["Categoria", columns.category],
    ["Preco_Salao", columns.price],
  ] as const) {
    if (index === undefined) throw new Error(`A coluna ${label} é obrigatória.`);
  }

  const value = (row: string[], index: number | undefined) =>
    index === undefined ? "" : (row[index]?.trim() ?? "");
  const parsed: CatalogCsvRow[] = [];

  rows.forEach((row, rowIndex) => {
    if (row.every((cell) => cell.trim() === "")) return;
    const line = rowIndex + 2;
    const name = value(row, columns.name);
    const categoryName = value(row, columns.category);
    if (!name) throw new Error(`Linha ${line}: nome é obrigatório.`);
    if (!categoryName) throw new Error(`Linha ${line}: categoria é obrigatória.`);

    parsed.push({
      id: value(row, columns.id) || null,
      name,
      categoryName,
      priceCents: parseCents(value(row, columns.price), "preço de salão", line) ?? 0,
      deliveryPriceCents: parseCents(value(row, columns.deliveryPrice), "preço de delivery", line),
      costCents: parseCents(value(row, columns.cost), "custo", line),
      description: value(row, columns.description) || null,
      ncm: value(row, columns.ncm) || null,
      cfop: value(row, columns.cfop) || null,
      available: parseAvailability(value(row, columns.available), line),
      estimatedPrepTimeMinutes: parseOptionalInteger(
        value(row, columns.prepTime),
        "tempo de preparo",
        line,
      ),
      tags: parseTags(value(row, columns.tags), line),
      dailyStockLimit: parseOptionalInteger(value(row, columns.dailyLimit), "limite diário", line),
    });
  });

  if (!parsed.length) throw new Error("O CSV não possui produtos preenchidos.");
  return parsed;
}

function serializeTable(rows: ReadonlyArray<ReadonlyArray<string | number>>) {
  return `\uFEFF${[headers, ...rows]
    .map((row) => row.map((value) => csvCell(String(value))).join(";"))
    .join("\r\n")}`;
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[;",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function detectDelimiter(csv: string): "," | ";" {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (character === "\r" || character === "\n")) {
      break;
    } else if (!quoted && character === ",") commas += 1;
    else if (!quoted && character === ";") semicolons += 1;
  }
  return semicolons > commas ? ";" : ",";
}

function parseTable(csv: string, delimiter: "," | ";") {
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
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\r" || character === "\n")) {
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

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function formatCents(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Valor em centavos inválido.");
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function formatOptionalCents(value: number | null | undefined) {
  return value == null ? "" : formatCents(value);
}

function parseCents(value: string, label: string, line: number) {
  if (!value) return null;
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value);
  if (!match?.[1]) throw new Error(`Linha ${line}: ${label} inválido.`);
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Linha ${line}: ${label} excede o limite aceito.`);
  }
  return Number(cents);
}

function parseOptionalInteger(value: string, label: string, line: number) {
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new Error(`Linha ${line}: ${label} inválido.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`Linha ${line}: ${label} excede o limite aceito.`);
  return parsed;
}

function parseAvailability(value: string, line: number) {
  if (!value) return null;
  const normalized = normalizeHeader(value);
  if (["sim", "true", "1"].includes(normalized)) return true;
  if (["nao", "false", "0"].includes(normalized)) return false;
  throw new Error(`Linha ${line}: disponibilidade inválida.`);
}

function parseTags(value: string, line: number): NonNullable<CatalogProduct["tags"]> {
  if (!value) return [];
  const tags = value
    .split(/[;|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  for (const tag of tags) {
    if (!catalogTags.has(tag as NonNullable<CatalogProduct["tags"]>[number])) {
      throw new Error(`Linha ${line}: destaque ${tag} inválido.`);
    }
  }
  return tags as NonNullable<CatalogProduct["tags"]>;
}
