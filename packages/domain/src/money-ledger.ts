import { randomUUID } from "node:crypto";

export const moneyLedgerKinds = [
  "sale",
  "payment",
  "refund",
  "chargeback",
  "adjustment",
  "reversal",
] as const;

export type MoneyLedgerKind = (typeof moneyLedgerKinds)[number];
export type MoneyComponent = "sale" | "service" | "tip" | "fee" | "adjustment";

export type MoneyLedgerEntry = Readonly<{
  account: string;
  debitCents: number;
  creditCents: number;
  component?: MoneyComponent;
}>;

export type MoneyLedgerPosting = Readonly<{
  postingId: string;
  kind: MoneyLedgerKind;
  referenceId: string;
  currency: "BRL";
  reversalOf?: string;
  debitCents: number;
  creditCents: number;
  entries: readonly MoneyLedgerEntry[];
}>;

function assertCents(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must use non-negative integer cents.`);
  }
}

function addCents(total: number, value: number) {
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new RangeError("Ledger total exceeds safe integer cents.");
  return next;
}

export function createLedgerPosting(input: {
  postingId?: string;
  kind: MoneyLedgerKind;
  referenceId: string;
  reversalOf?: string;
  entries: readonly MoneyLedgerEntry[];
}): MoneyLedgerPosting {
  if (input.referenceId.trim().length === 0) throw new TypeError("referenceId is required.");
  if (input.entries.length < 2)
    throw new TypeError("A ledger posting requires at least two entries.");

  let debitCents = 0;
  let creditCents = 0;
  const entries = input.entries.map((entry, index) => {
    if (entry.account.trim().length === 0)
      throw new TypeError(`entries[${index}].account is required.`);
    assertCents(entry.debitCents, `entries[${index}].debitCents`);
    assertCents(entry.creditCents, `entries[${index}].creditCents`);
    if ((entry.debitCents === 0) === (entry.creditCents === 0)) {
      throw new TypeError(`entries[${index}] must post to exactly one side.`);
    }
    debitCents = addCents(debitCents, entry.debitCents);
    creditCents = addCents(creditCents, entry.creditCents);
    return Object.freeze({ ...entry, account: entry.account.trim() });
  });
  if (debitCents !== creditCents) throw new TypeError("Ledger posting must be balanced.");

  return Object.freeze({
    postingId: input.postingId ?? randomUUID(),
    kind: input.kind,
    referenceId: input.referenceId.trim(),
    currency: "BRL" as const,
    ...(input.reversalOf ? { reversalOf: input.reversalOf } : {}),
    debitCents,
    creditCents,
    entries: Object.freeze(entries),
  });
}

export function createSalePosting(input: {
  postingId?: string;
  referenceId: string;
  saleCents: number;
  serviceCents?: number;
  tipCents?: number;
}) {
  const serviceCents = input.serviceCents ?? 0;
  const tipCents = input.tipCents ?? 0;
  assertCents(input.saleCents, "saleCents");
  assertCents(serviceCents, "serviceCents");
  assertCents(tipCents, "tipCents");
  if (input.saleCents === 0) throw new TypeError("saleCents must be positive integer cents.");
  const totalCents = addCents(addCents(input.saleCents, serviceCents), tipCents);
  const entries: MoneyLedgerEntry[] = [
    {
      account: "accounts_receivable",
      debitCents: totalCents,
      creditCents: 0,
      component: "sale",
    },
    {
      account: "sales_revenue",
      debitCents: 0,
      creditCents: input.saleCents,
      component: "sale",
    },
  ];
  if (serviceCents > 0)
    entries.push({
      account: "service_fee_payable",
      debitCents: 0,
      creditCents: serviceCents,
      component: "service",
    });
  if (tipCents > 0)
    entries.push({
      account: "tips_payable",
      debitCents: 0,
      creditCents: tipCents,
      component: "tip",
    });
  return createLedgerPosting({
    ...(input.postingId ? { postingId: input.postingId } : {}),
    kind: "sale",
    referenceId: input.referenceId,
    entries,
  });
}

export function reverseLedgerPosting(original: MoneyLedgerPosting, referenceId: string) {
  return createLedgerPosting({
    kind: "reversal",
    referenceId,
    reversalOf: original.postingId,
    entries: original.entries.map((entry) => ({
      account: entry.account,
      debitCents: entry.creditCents,
      creditCents: entry.debitCents,
      ...(entry.component ? { component: entry.component } : {}),
    })),
  });
}
