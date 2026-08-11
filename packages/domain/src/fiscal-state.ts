export const fiscalDocumentStates = [
  "pending",
  "submitted",
  "authorized",
  "rejected",
  "cancelled",
] as const;
export type FiscalDocumentState = (typeof fiscalDocumentStates)[number];
export type FiscalDocumentEvent = "submit" | "authorize" | "reject" | "retry" | "cancel";

const transitions: Readonly<
  Record<FiscalDocumentState, Partial<Record<FiscalDocumentEvent, FiscalDocumentState>>>
> = {
  pending: { submit: "submitted" },
  submitted: { authorize: "authorized", reject: "rejected", retry: "pending" },
  authorized: { cancel: "cancelled" },
  rejected: { retry: "pending" },
  cancelled: {},
};

export function transitionFiscalDocument(
  current: FiscalDocumentState,
  event: FiscalDocumentEvent,
): FiscalDocumentState {
  const next = transitions[current][event];
  if (!next) throw new Error(`Invalid fiscal transition: ${current} -> ${event}`);
  return next;
}

export type FiscalAdapterRequest = Readonly<{
  documentId: string;
  idempotencyKey: string;
  saleReference: string;
  totalCents: number;
  document: Readonly<Record<string, unknown>>;
}>;

export type FiscalAdapterResult = Readonly<{
  status: "authorized" | "rejected" | "pending" | "cancelled";
  documentReference?: string;
  errorCode?: string;
}>;

export interface FiscalAdapter {
  readonly name: string;
  readonly homologated: boolean;
  issue(request: FiscalAdapterRequest): Promise<FiscalAdapterResult>;
  lookup(documentReference: string): Promise<FiscalAdapterResult>;
  cancel(documentReference: string, reason: string): Promise<FiscalAdapterResult>;
}
