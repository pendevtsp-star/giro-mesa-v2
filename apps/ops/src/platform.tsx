import { Badge, Button, Card, EmptyState } from "@giromesa/ui";
import { useEffect, useState } from "react";
import { api } from "./api";

type Row = Record<string, unknown>;

interface PlatformOverview {
  counts: { organizations: number; units: number; activeTrials: number };
  recentTrialApplications: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    businessName: string;
    planSlug: string;
    createdAt: string;
  }>;
  recentContacts: Array<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
    message: string;
    createdAt: string;
  }>;
  recentOrganizations: Array<{
    id: string;
    name: string;
    billingState: string;
    createdAt: string;
  }>;
}

export class InvalidPlatformPayloadError extends Error {
  constructor() {
    super("A API retornou o painel da plataforma em formato inesperado.");
    this.name = "InvalidPlatformPayloadError";
  }
}

function record(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new InvalidPlatformPayloadError();
  return value as Row;
}

function records(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new InvalidPlatformPayloadError();
  return value.map(record);
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidPlatformPayloadError();
  return value;
}

function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidPlatformPayloadError();
  return value;
}

export function parsePlatformOverview(value: unknown): PlatformOverview {
  const payload = record(value);
  const counts = record(payload.counts);
  return {
    counts: {
      organizations: number(counts.organizations),
      units: number(counts.units),
      activeTrials: number(counts.activeTrials),
    },
    recentTrialApplications: records(payload.recentTrialApplications).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      email: text(row.email),
      phone: text(row.phone),
      businessName: text(row.businessName),
      planSlug: text(row.planSlug),
      createdAt: text(row.createdAt),
    })),
    recentContacts: records(payload.recentContacts).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      email: text(row.email),
      phone: optionalText(row.phone),
      message: text(row.message),
      createdAt: text(row.createdAt),
    })),
    recentOrganizations: records(payload.recentOrganizations).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      billingState: text(row.billingState),
      createdAt: text(row.createdAt),
    })),
  };
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data inválida"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function RealPlatformPage({ refreshToken }: { refreshToken: number }) {
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: PlatformOverview }
  >({ status: "loading" });
  useEffect(() => {
    void retryToken;
    void refreshToken;
    let active = true;
    setState({ status: "loading" });
    api.platform
      .overview()
      .then(parsePlatformOverview)
      .then((data) => active && setState({ status: "ready", data }))
      .catch(
        (error: unknown) =>
          active &&
          setState({
            status: "error",
            message:
              error instanceof Error ? error.message : "Não foi possível carregar a administração.",
          }),
      );
    return () => {
      active = false;
    };
  }, [refreshToken, retryToken]);

  if (state.status === "loading")
    return (
      <Card className="remote-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Carregando visão administrativa…</strong>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card className="remote-state" role="alert">
        <strong>Falha ao carregar a plataforma</strong>
        <p>{state.message}</p>
        <Button onClick={() => setRetryToken((value) => value + 1)} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      </Card>
    );
  const { data } = state;
  return (
    <div className="growth-stack">
      <div className="metric-strip">
        <Card>
          <small>Organizações</small>
          <strong>{data.counts.organizations}</strong>
        </Card>
        <Card>
          <small>Unidades</small>
          <strong>{data.counts.units}</strong>
        </Card>
        <Card>
          <small>Testes ativos</small>
          <strong>{data.counts.activeTrials}</strong>
        </Card>
      </div>
      <div className="ops-grid">
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Comercial</p>
              <h2>Solicitações de teste</h2>
            </div>
            <Badge tone="info">{data.recentTrialApplications.length}</Badge>
          </div>
          {data.recentTrialApplications.length === 0 ? (
            <EmptyState
              icon="◇"
              title="Sem solicitações recentes"
              description="Nenhuma adesão recente foi persistida."
            />
          ) : (
            <div className="data-list">
              {data.recentTrialApplications.map((trial) => (
                <article className="data-row" key={trial.id}>
                  <div>
                    <strong>{trial.businessName}</strong>
                    <small>
                      {trial.name} · {trial.email} · {trial.phone}
                    </small>
                  </div>
                  <div className="data-row__end">
                    <Badge tone="neutral">{trial.planSlug}</Badge>
                    <small>{dateTime(trial.createdAt)}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Atendimento</p>
              <h2>Contatos recentes</h2>
            </div>
            <Badge tone="info">{data.recentContacts.length}</Badge>
          </div>
          {data.recentContacts.length === 0 ? (
            <EmptyState
              icon="?"
              title="Sem contatos recentes"
              description="Nenhum contato comercial foi persistido."
            />
          ) : (
            <div className="data-list">
              {data.recentContacts.map((contact) => (
                <article className="data-row" key={contact.id}>
                  <div>
                    <strong>{contact.name}</strong>
                    <small>
                      {contact.email}
                      {contact.phone ? ` · ${contact.phone}` : ""}
                    </small>
                    <p>{contact.message}</p>
                  </div>
                  <small>{dateTime(contact.createdAt)}</small>
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Card>
        <div className="section-title">
          <div>
            <p className="eyebrow">Tenants</p>
            <h2>Organizações recentes</h2>
          </div>
        </div>
        {data.recentOrganizations.length === 0 ? (
          <EmptyState
            icon="◎"
            title="Sem organizações"
            description="Nenhuma organização foi criada."
          />
        ) : (
          <div className="data-list">
            {data.recentOrganizations.map((organization) => (
              <article className="data-row" key={organization.id}>
                <div>
                  <strong>{organization.name}</strong>
                  <small>Criada em {dateTime(organization.createdAt)}</small>
                </div>
                <Badge tone={organization.billingState === "active" ? "success" : "neutral"}>
                  {organization.billingState}
                </Badge>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
