export const KDS_INITIAL_PRINT_REASON = "Impressão manual inicial solicitada no KDS.";

export function createKdsInitialPrintRequest(
  ticketId: string,
  options: { copies: number; printerId?: string },
) {
  return {
    idempotencyKey: `kds/${ticketId}/manual/initial`,
    body: {
      copies: Math.min(5, Math.max(1, Math.trunc(options.copies))),
      ...(options.printerId ? { printerId: options.printerId } : {}),
      reason: KDS_INITIAL_PRINT_REASON,
    },
  };
}

export function kdsReprintIdempotencyKey(ticketId: string, requestId: string) {
  return `kds/${ticketId}/manual/reprint/${requestId}`;
}
