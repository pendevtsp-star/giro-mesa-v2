import { describe, expect, it } from "vitest";
import {
  createKdsInitialPrintRequest,
  KDS_INITIAL_PRINT_REASON,
  kdsReprintIdempotencyKey,
} from "./kds.printing";

describe("KDS thermal printing", () => {
  it("uses one stable key for the initial manual print", () => {
    expect(createKdsInitialPrintRequest("ticket-1", { copies: 2 })).toEqual({
      idempotencyKey: "kds/ticket-1/manual/initial",
      body: {
        copies: 2,
        reason: KDS_INITIAL_PRINT_REASON,
      },
    });
  });

  it("only addresses a printer when the persisted terminal profile selected one", () => {
    expect(
      createKdsInitialPrintRequest("ticket-1", { copies: 9, printerId: "kitchen" }).body,
    ).toEqual({ copies: 5, printerId: "kitchen", reason: KDS_INITIAL_PRINT_REASON });
  });

  it("creates a distinct stable key for an explicit reprint attempt", () => {
    expect(kdsReprintIdempotencyKey("ticket-1", "attempt-2")).toBe(
      "kds/ticket-1/manual/reprint/attempt-2",
    );
  });
});
