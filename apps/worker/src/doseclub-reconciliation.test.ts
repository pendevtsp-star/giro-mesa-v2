import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDoseClubFindings } from "./doseclub-reconciliation.js";

describe("DoseClub reconciliation detector", () => {
  it("reports deterministic mapping and version gaps without changing source state", () => {
    const source = {
      mappings: [
        { externalProductId: "inactive-product", active: false, dimension: "volume", unit: "ml" },
        { externalProductId: "wrong-dimension", active: true, dimension: "count", unit: "un" },
      ],
      states: [
        {
          externalClubId: "club-1",
          eligibleProductIds: ["inactive-product", "missing-product"],
          contractVersion: "v2",
          version: 4,
          updatedAt: new Date("2026-08-01T00:00:00.000Z"),
          latestOperationVersion: 3,
          latestReconcileAt: null,
        },
      ],
    } as const;

    const before = structuredClone(source);
    const findings = buildDoseClubFindings(source, new Date("2026-08-11T00:00:00.000Z"));

    assert.deepEqual(source, before);
    assert.deepEqual(findings.map((finding) => finding.kind).sort(), [
      "inactive_mapping",
      "invalid_inventory_dimension",
      "invalid_inventory_unit",
      "missing_mapping",
      "missing_reconcile_heartbeat",
      "state_version_gap",
    ]);
    assert.equal(new Set(findings.map((finding) => finding.fingerprint)).size, findings.length);
  });

  it("fails closed when a persisted state has no accepted operation", () => {
    const findings = buildDoseClubFindings(
      {
        mappings: [],
        states: [
          {
            externalClubId: "club-without-operation",
            eligibleProductIds: [],
            contractVersion: "v1",
            version: 1,
            updatedAt: new Date("2026-08-11T00:00:00.000Z"),
            latestOperationVersion: null,
            latestReconcileAt: null,
          },
        ],
      },
      new Date("2026-08-11T01:00:00.000Z"),
    );

    assert.deepEqual(
      findings.map((finding) => finding.kind),
      ["state_version_gap"],
    );
    assert.equal(findings[0]?.evidence.latestOperationVersion, null);
  });

  it("counts one finding when several clubs reference the same missing product", () => {
    const states = ["club-a", "club-b"].map((externalClubId) => ({
      externalClubId,
      eligibleProductIds: ["shared-missing-product"],
      contractVersion: "v1",
      version: 1,
      updatedAt: new Date("2026-08-11T00:00:00.000Z"),
      latestOperationVersion: 1,
      latestReconcileAt: null,
    }));

    const findings = buildDoseClubFindings({ mappings: [], states });

    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.kind, "missing_mapping");
    assert.equal(findings[0]?.entityId, "shared-missing-product");
  });
});
