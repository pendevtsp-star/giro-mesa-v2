import assert from "node:assert/strict";
import { it } from "node:test";
import { ManagementSettlementsService } from "./management-settlements.service.js";

it("exporta CSV com delimitadores, aspas e quebras protegidos e sem fórmulas executáveis", async () => {
  const lines = ["=1+1", "+1+1", "-1+1", "@SUM(A1:A2)", "\t=1+1", " \r\n+1+1"].map(
    (personName) => ({
      personName,
      roleLabel: 'Garçom; "Equipe"\r\nNoite',
      payableCents: 1_000,
      operationalLossCents: 500,
    }),
  );
  const query = {
    limit: async () => [{ periodFrom: "2033-04-10", periodTo: "2033-04-10", status: "closed" }],
    orderBy: async () => lines,
  };
  const database = { db: { select: () => ({ from: () => ({ where: () => query }) }) } };
  const scope = { requireUnitAccess: async () => ({ role: "owner" }) };
  const service = new ManagementSettlementsService(database as never, scope as never, {} as never);
  const result = await service.exportCsv("owner", "organization", "unit", "settlement");
  assert.ok(result.content.startsWith('\uFEFF"Pessoa";"Função";'));
  for (const line of lines) assert.ok(result.content.includes(`"'${line.personName}";`));
  assert.ok(result.content.includes('"Garçom; ""Equipe""\r\nNoite"'));
  assert.ok(result.content.includes('"500";"1000";"closed"'));
  assert.ok(result.content.includes('"Perdas operacionais (informativo)";"A pagar"'));
});
