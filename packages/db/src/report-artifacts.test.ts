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

  it("renders a localized, paginated and searchable report table", () => {
    const rows = Array.from({ length: 90 }, (_, index) => ({
      seção: "vendas",
      data: "2026-08-22",
      produto: `Refeição ${index + 1}`,
      quantidade: index + 1,
      revenue_cents: 1200 + index,
      garçom: "João",
      forma_pagamento: "Pix",
    }));
    const artifact = buildReportArtifact("pdf", rows, "Relatório analítico de vendas", {
      organizationName: "Restaurante São José",
      unitName: "Unidade Centro",
      period: { from: "2026-08-01", to: "2026-08-22" },
      timezone: "America/Sao_Paulo",
      generatedAt: "2026-08-22T12:30:00.000Z",
      reference: "export-123",
      filters: { canal: "Salão" },
      warnings: ["Custos indisponíveis; margens não foram calculadas."],
    });
    const pdf = Buffer.from(artifact.content, "base64").toString("latin1");

    assert.match(pdf, /^%PDF-1\.4/);
    assert.match(pdf, /\/MediaBox \[0 0 842 595\]/);
    assert.match(pdf, /\/Count ([2-9]|\d{2,}) /);
    assert.match(pdf, /\/Encoding \/WinAnsiEncoding/);
    assert.match(pdf, /Relat\\363rio anal\\355tico de vendas/);
    assert.match(pdf, /R\$ 12,00/);
    assert.match(pdf, /P\\341gina 1\//);
    assert.match(pdf, /Refer\\352ncia: export-123/);
    assert.doesNotMatch(pdf, /produto:/i);
  });

  it("renders an explicit empty state without inventing rows", () => {
    const artifact = buildReportArtifact("pdf", [], "Vendas do período");
    const pdf = Buffer.from(artifact.content, "base64").toString("latin1");

    assert.match(pdf, /Nenhum registro encontrado/);
    assert.match(pdf, /Registros exportados: 0/);
  });
});
