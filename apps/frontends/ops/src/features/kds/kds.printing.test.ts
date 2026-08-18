import { describe, expect, it } from "vitest";
import type { KdsItem, KdsTicket } from "../../operations.shared";
import { createKdsThermalPrintRequest } from "./kds.printing";

describe("KDS thermal printing", () => {
  it("formats operational exceptions and a stable idempotency key", () => {
    const ticket = {
      id: "ticket-1",
      stationId: "station-1",
      stationName: "Cozinha",
      reference: "014",
      rush: true,
      tableLabel: "Mesa 12",
      tabLabel: null,
      channel: "Salão",
      dueAt: null,
      updatedAt: "2026-08-18T12:00:00.000Z",
      createdAt: null,
    } as KdsTicket;
    const item = {
      quantity: 2,
      productName: "Croquete",
      modifiers: ["Sem molho"],
      allergyNote: "Amendoim",
      notes: null,
      seatNumber: 2,
    } as KdsItem;

    const request = createKdsThermalPrintRequest(
      ticket,
      [item],
      { copies: 1, printerId: "kitchen" },
      new Date("2026-08-18T12:01:00Z"),
      "kds/ticket-1/attempt-1",
    );
    expect(request.idempotencyKey).toBe("kds/ticket-1/attempt-1");
    expect(request.job).toMatchObject({
      documentType: "kds_ticket",
      printerId: "kitchen",
      station: "Cozinha",
      payload: {
        rush: true,
        reference: "014",
        items: [
          {
            quantity: 2,
            productName: "Croquete",
            modifiers: ["Sem molho"],
            allergyNote: "Amendoim",
            seatNumber: 2,
          },
        ],
      },
    });
  });
});
