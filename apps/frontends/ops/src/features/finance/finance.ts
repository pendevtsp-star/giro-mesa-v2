export interface ReconciliationImportEntry {
  paymentDirection: "payable" | "receivable";
  externalKey: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  status: "unmatched";
}

function moneyToCents(value: string): number {
  const normalized = value.trim().replace(/[^\d,.-]/g, "");
  const decimal = normalized.includes(",")
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized;
  const amount = Number(decimal);
  if (!Number.isFinite(amount)) throw new Error(`Valor inválido: ${value}`);
  return Math.round(amount * 100);
}

function csvCells(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function parseCsv(content: string): ReconciliationImportEntry[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("O CSV precisa de cabeçalho e ao menos uma linha.");
  const delimiter =
    (lines[0]?.match(/;/g)?.length ?? 0) >= (lines[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = csvCells(lines[0] ?? "", delimiter).map((header) =>
    header
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
  );
  const column = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const keyIndex = column("externalkey", "chave", "id", "referencia", "reference");
  const amountIndex = column("valor", "amount", "gross", "bruto", "grosscents");
  const feeIndex = column("taxa", "fee", "feecents");
  const netIndex = column("liquido", "net", "netcents");
  const directionIndex = column("direcao", "direction", "tipo");
  if (keyIndex < 0 || amountIndex < 0)
    throw new Error("O CSV deve conter as colunas referência/id e valor.");
  return lines.slice(1).map((line, index) => {
    const cells = csvCells(line, delimiter);
    const signedAmount = moneyToCents(cells[amountIndex] ?? "");
    const feeCents = feeIndex < 0 ? 0 : Math.abs(moneyToCents(cells[feeIndex] || "0"));
    const explicitDirection = (cells[directionIndex] ?? "").toLowerCase();
    const paymentDirection =
      explicitDirection.includes("pagar") ||
      explicitDirection.includes("payable") ||
      signedAmount < 0
        ? "payable"
        : "receivable";
    const grossCents = Math.abs(signedAmount);
    const netCents =
      netIndex < 0
        ? Math.max(0, grossCents - feeCents)
        : Math.abs(moneyToCents(cells[netIndex] || "0"));
    const externalKey = (cells[keyIndex] ?? "").trim();
    if (!externalKey || grossCents <= 0) throw new Error(`Linha ${index + 2} inválida.`);
    return { paymentDirection, externalKey, grossCents, feeCents, netCents, status: "unmatched" };
  });
}

function parseOfx(content: string): ReconciliationImportEntry[] {
  const transactions = content.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi) ?? [];
  if (!transactions.length) throw new Error("Nenhuma transação foi encontrada no OFX.");
  const tag = (block: string, name: string) =>
    block.match(new RegExp(`<${name}>([^<\\r\\n]+)`, "i"))?.[1]?.trim() ?? "";
  return transactions.map((transaction, index) => {
    const signedAmount = moneyToCents(tag(transaction, "TRNAMT"));
    const externalKey = tag(transaction, "FITID") || `ofx-${index + 1}`;
    const grossCents = Math.abs(signedAmount);
    if (!grossCents) throw new Error(`Transação OFX ${index + 1} sem valor.`);
    return {
      paymentDirection: signedAmount < 0 ? "payable" : "receivable",
      externalKey,
      grossCents,
      feeCents: 0,
      netCents: grossCents,
      status: "unmatched",
    };
  });
}

export function parseReconciliationFile(name: string, content: string) {
  return name.toLowerCase().endsWith(".ofx") ? parseOfx(content) : parseCsv(content);
}

export function financeStatusLabel(status: string) {
  return (
    (
      {
        open: "Em aberto",
        partially_paid: "Parcial",
        partially_received: "Parcial",
        paid: "Pago",
        received: "Recebido",
        canceled: "Cancelado",
      } as Record<string, string>
    )[status] ?? status
  );
}

export function paymentMethodLabel(method: string) {
  return (
    (
      {
        pix: "Pix",
        cash: "Dinheiro",
        credit_card: "Cartão de crédito",
        debit_card: "Cartão de débito",
        bank_transfer: "Transferência",
        other: "Outro",
      } as Record<string, string>
    )[method] ?? method
  );
}
