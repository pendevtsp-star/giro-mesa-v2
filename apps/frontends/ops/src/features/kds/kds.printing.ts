import type { KdsItem, KdsTicket } from "../../operations.shared";

export interface KdsThermalPrintJob {
  documentType: "kds_ticket";
  printerId: string;
  station: string;
  copies: number;
  payload: {
    generatedAt: string;
    id: string;
    reference: string;
    stationName: string;
    tableLabel: string | null;
    tabLabel: string | null;
    channel: string | null;
    rush: boolean;
    dueAt: string | null;
    items: Array<{
      quantity: number;
      productName: string;
      modifiers: string[];
      notes: string | null;
      allergyNote: string | null;
      seatNumber: number | null;
    }>;
  };
}

export function createKdsThermalPrintRequest(
  ticket: KdsTicket,
  items: KdsItem[],
  options: { copies: number; printerId: string },
  generatedAt = new Date(),
  idempotencyKey = `kds/${ticket.id}/${crypto.randomUUID()}`,
) {
  const reference = ticket.reference ?? ticket.id.slice(0, 6).toUpperCase();
  return {
    idempotencyKey,
    job: {
      documentType: "kds_ticket",
      printerId: options.printerId || "default",
      station: ticket.stationName ?? ticket.stationId,
      copies: options.copies,
      payload: {
        generatedAt: generatedAt.toISOString(),
        id: ticket.id,
        reference,
        stationName: ticket.stationName ?? "Produção",
        tableLabel: ticket.tableLabel,
        tabLabel: ticket.tabLabel,
        channel: ticket.channel,
        rush: ticket.rush,
        dueAt: ticket.dueAt,
        items: items.map((item) => ({
          quantity: item.quantity,
          productName: item.productName,
          modifiers: item.modifiers,
          notes: item.notes,
          allergyNote: item.allergyNote,
          seatNumber: item.seatNumber,
        })),
      },
    } satisfies KdsThermalPrintJob,
  };
}
