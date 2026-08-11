import { Badge, Card, EmptyState } from "@giromesa/ui";

export interface IncidentReportView {
  incidentId: string;
  status: "reported" | "under_review" | "approved" | "rejected" | "closed";
  neutralSummary: string;
  amountCents: number | null;
  payrollAction: false;
  evidenceCount: number;
}

export class InvalidIncidentPayloadError extends Error {}

export function parseIncidentReports(value: unknown): IncidentReportView[] {
  if (!Array.isArray(value))
    throw new InvalidIncidentPayloadError("Relatório de incidentes inválido.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object")
      throw new InvalidIncidentPayloadError("Incidente inválido.");
    const row = entry as Record<string, unknown>;
    if (
      typeof row.incidentId !== "string" ||
      !["reported", "under_review", "approved", "rejected", "closed"].includes(
        String(row.status),
      ) ||
      typeof row.neutralSummary !== "string" ||
      (row.amountCents !== null && !Number.isSafeInteger(row.amountCents)) ||
      row.payrollAction !== false ||
      !Number.isSafeInteger(row.evidenceCount)
    )
      throw new InvalidIncidentPayloadError("Incidente incompleto ou com ação salarial proibida.");
    return row as unknown as IncidentReportView;
  });
}

export function IncidentsReport({ incidents }: { incidents: IncidentReportView[] }) {
  if (incidents.length === 0)
    return <EmptyState icon="-" title="Sem incidentes" description="Nenhum fato registrado no período." />;
  return (
    <Card>
      <h2>Incidentes gerenciais</h2>
      <p>Registro factual para revisão humana. Nenhum desconto em folha é realizado.</p>
      <ul aria-label="Incidentes gerenciais">
        {incidents.map((incident) => (
          <li key={incident.incidentId}>
            <Badge>{incident.status}</Badge> {incident.neutralSummary} ({incident.evidenceCount}{" "}
            evidências)
          </li>
        ))}
      </ul>
    </Card>
  );
}
