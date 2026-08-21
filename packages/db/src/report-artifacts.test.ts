import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReportArtifact, parseReportCsv } from "./report-artifacts.js";

describe("report artifacts", () => {
  it("creates auditable CSV, PDF and XLSX artifacts without executable spreadsheet formulas", () => {
    const rows = [{ label: "=SUM(A1)", amountCents: 1200 }];
    const csv = buildReportArtifact("csv", rows);
    const pdf = buildReportArtifact("pdf", rows);
    const xlsx = buildReportArtifact("xlsx", rows);

    assert.equal(csv.contentEncoding, "utf8");
    assert.match(csv.content, /'=SUM\(A1\)/);
    assert.equal(Buffer.from(pdf.content, "base64").subarray(0, 5).toString(), "%PDF-");
    assert.equal(Buffer.from(xlsx.content, "base64").subarray(0, 2).toString(), "PK");
    assert.match(pdf.sha256, /^[a-f0-9]{64}$/);
    assert.match(xlsx.sha256, /^[a-f0-9]{64}$/);
    assert.equal(parseReportCsv('"label";"value"\r\n"A;B";"1"')[0]?.label, "A;B");
  });
});
