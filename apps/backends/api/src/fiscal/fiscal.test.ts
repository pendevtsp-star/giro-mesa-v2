import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edgeFiscalEventSchema } from "./fiscal.schemas.js";
import { buildAccountingPackage, competenceBounds } from "./fiscal.service.js";

describe("fiscal core", () => {
  it("uses a canonical first-day competence", () => {
    assert.equal(competenceBounds("2026-08").competenceDate, "2026-08-01");
  });

  it("totals only authorized documents in the accounting package", () => {
    const packageData = buildAccountingPackage("org", "unit", "2026-08", new Date(0), [
      {
        id: "authorized",
        model: "nfce",
        status: "authorized",
        accessKey: null,
        series: "1",
        number: 1,
        totalCents: 2_500,
        taxCents: 200,
        issuedAt: new Date(0),
        xmlSha256: null,
      },
      {
        id: "rejected",
        model: "nfce",
        status: "rejected",
        accessKey: null,
        series: "1",
        number: 2,
        totalCents: 9_999,
        taxCents: 999,
        issuedAt: new Date(0),
        xmlSha256: null,
      },
    ]);
    assert.equal(packageData.totals.documents, 2);
    assert.equal(packageData.totals.totalCents, 2_500);
    assert.equal(packageData.totals.taxCents, 200);
    assert.deepEqual(packageData.totals.byStatus, { authorized: 1, rejected: 1 });
  });

  it("validates edge event type and invalidation status", () => {
    const event = edgeFiscalEventSchema.parse({
      id: "event-1",
      type: "fiscal.number_invalidation_result",
      occurredAt: "2026-08-17T00:00:00.000Z",
      payload: {
        kind: "fiscal.number_invalidation_result",
        idempotencyKey: "invalidate-1",
        status: "invalidated",
        cnpj: "12ABC34501DE67",
        series: "1",
        initialNumber: 10,
        finalNumber: 12,
      },
    });
    assert.equal(event.payload.status, "invalidated");
    assert.throws(() =>
      edgeFiscalEventSchema.parse({ ...event, type: "fiscal.document.reconciled" }),
    );
  });
});
