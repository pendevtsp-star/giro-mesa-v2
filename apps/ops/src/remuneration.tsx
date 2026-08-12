import { Badge, Button, Card, EmptyState } from "@giromesa/ui";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { ManagementScope } from "./management";

type Kind = "service" | "commission" | "profit_sharing";
type Status = "estimated" | "approved" | "closed";
export interface RemunerationRunView {
  runId: string;
  kind: Kind;
  status: Status;
  outputCents: number;
  memoryHash: string;
}
export interface RemunerationPortfolioView {
  periodStart: string;
  periodEnd: string;
  byKind: Record<Kind, RemunerationRunView[]>;
  disclaimer: string;
}

export class InvalidRemunerationPayloadError extends Error {}

export function parseRemunerationPortfolio(value: unknown): RemunerationPortfolioView {
  if (!value || typeof value !== "object")
    throw new InvalidRemunerationPayloadError("Relatório de remuneração inválido.");
  const row = value as Record<string, unknown>;
  if (
    typeof row.periodStart !== "string" ||
    typeof row.periodEnd !== "string" ||
    typeof row.disclaimer !== "string" ||
    !row.byKind ||
    typeof row.byKind !== "object"
  )
    throw new InvalidRemunerationPayloadError("Relatório de remuneração incompleto.");
  const source = row.byKind as Record<string, unknown>;
  const parseKind = (kind: Kind) => {
    const entries = source[kind];
    if (!Array.isArray(entries))
      throw new InvalidRemunerationPayloadError(`Categoria ${kind} inválida.`);
    return entries.map((entry) => {
      if (!entry || typeof entry !== "object")
        throw new InvalidRemunerationPayloadError("Apuração inválida.");
      const run = entry as Record<string, unknown>;
      if (
        typeof run.runId !== "string" ||
        run.kind !== kind ||
        !["estimated", "approved", "closed"].includes(String(run.status)) ||
        !Number.isSafeInteger(run.outputCents) ||
        typeof run.memoryHash !== "string"
      )
        throw new InvalidRemunerationPayloadError("Apuração incompleta.");
      return run as unknown as RemunerationRunView;
    });
  };
  return {
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    disclaimer: row.disclaimer,
    byKind: {
      service: parseKind("service"),
      commission: parseKind("commission"),
      profit_sharing: parseKind("profit_sharing"),
    },
  };
}

const labels: Record<Kind, string> = {
  service: "Taxa de serviço",
  commission: "Comissão",
  profit_sharing: "Participação nos resultados",
};

function amount(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function download(payload: Record<string, unknown>, format: "csv" | "pdf" | "print") {
  const encoded = typeof payload.bodyBase64 === "string" ? atob(payload.bodyBase64) : null;
  const body = encoded
    ? Uint8Array.from(encoded, (character) => character.charCodeAt(0))
    : String(payload.body ?? "");
  if (format === "print") {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (popup && typeof body === "string") {
      popup.document.write(body);
      popup.document.close();
      popup.print();
    }
    return;
  }
  const url = URL.createObjectURL(
    new Blob([body], { type: String(payload.contentType ?? "application/octet-stream") }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = String(payload.fileName ?? `remuneracao.${format}`);
  anchor.click();
  URL.revokeObjectURL(url);
}

export function RemunerationReport({
  portfolio,
  onExport,
}: {
  portfolio: RemunerationPortfolioView;
  onExport?: (runId: string, format: "csv" | "pdf" | "print") => void;
}) {
  return (
    <section aria-labelledby="remuneration-title">
      <h1 id="remuneration-title">Relatório de remuneração</h1>
      <p>{portfolio.disclaimer}</p>
      {(Object.keys(labels) as Kind[]).map((kind) => (
        <Card key={kind}>
          <h2>{labels[kind]}</h2>
          {portfolio.byKind[kind].length === 0 ? (
            <EmptyState
              icon="-"
              title="Sem apuração"
              description="Nenhum cálculo persistido no período."
            />
          ) : (
            <ul>
              {portfolio.byKind[kind].map((run) => (
                <li key={run.runId}>
                  <Badge>
                    {run.status === "estimated"
                      ? "Estimado"
                      : run.status === "approved"
                        ? "Aprovado"
                        : "Fechado"}
                  </Badge>{" "}
                  <strong>{amount(run.outputCents)}</strong>
                  <fieldset aria-label={`Exportar ${labels[kind]}`}>
                    <Button onClick={() => onExport?.(run.runId, "csv")}>CSV</Button>
                    <Button onClick={() => onExport?.(run.runId, "pdf")}>PDF</Button>
                    <Button onClick={() => onExport?.(run.runId, "print")}>Imprimir</Button>
                  </fieldset>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </section>
  );
}

export function RemunerationPage({ scope, demo }: { scope: ManagementScope; demo: boolean }) {
  const [portfolio, setPortfolio] = useState<RemunerationPortfolioView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void scope.refreshToken;
    if (demo) return;
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const start = `${end.slice(0, 8)}01`;
    void api.management
      .remunerationPortfolio(scope.organizationId, scope.unitId, start, end)
      .then((payload) => setPortfolio(parseRemunerationPortfolio(payload)))
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Falha ao carregar apurações."),
      );
  }, [demo, scope.organizationId, scope.unitId, scope.refreshToken]);
  if (demo)
    return (
      <RemunerationReport
        portfolio={{
          periodStart: "",
          periodEnd: "",
          byKind: { service: [], commission: [], profit_sharing: [] },
          disclaimer:
            "Modo demonstrativo: nenhum valor financeiro foi fabricado. Conecte dados persistidos para apurar.",
        }}
      />
    );
  if (error) return <EmptyState icon="-" title="Relatório indisponível" description={error} />;
  if (!portfolio) return <p role="status">Carregando apurações…</p>;
  return (
    <RemunerationReport
      portfolio={portfolio}
      onExport={(runId, format) => {
        void api.management
          .remunerationExport(scope.organizationId, scope.unitId, runId, format)
          .then((payload) => download(payload, format))
          .catch((reason) =>
            setError(reason instanceof Error ? reason.message : "Falha ao exportar."),
          );
      }}
    />
  );
}
