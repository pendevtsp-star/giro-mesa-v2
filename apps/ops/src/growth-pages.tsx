import { Badge, Button, Card, EmptyState } from "@giromesa/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ProfileId } from "./domain";
import { formatMoney } from "./rules";
import { UiIcon } from "./ui-icon";

export interface GrowthScope {
  organizationId: string;
  unitId: string;
  profileId: ProfileId;
  refreshToken: number;
}

type Row = Record<string, unknown>;
type RemoteState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export class InvalidGrowthPayloadError extends Error {
  constructor() {
    super("A API retornou dados de relacionamento em formato inesperado.");
    this.name = "InvalidGrowthPayloadError";
  }
}

function record(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new InvalidGrowthPayloadError();
  return value as Row;
}

function records(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new InvalidGrowthPayloadError();
  return value.map(record);
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidGrowthPayloadError();
  return value;
}

function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function number(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new InvalidGrowthPayloadError();
  return parsed;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InvalidGrowthPayloadError();
  return value;
}

export interface DeliveryZone {
  id: string;
  name: string;
  feeCents: number;
  minimumOrderCents: number;
  active: boolean;
}

export function parseDeliveryZones(value: unknown): DeliveryZone[] {
  return records(value).map((row) => ({
    id: text(row.id),
    name: text(row.name),
    feeCents: number(row.feeCents),
    minimumOrderCents: number(row.minimumOrderCents),
    active: bool(row.active),
  }));
}

interface Reservation {
  id: string;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  notes: string | null;
}

interface WaitlistEntry {
  id: string;
  guestName: string;
  guestPhone: string | null;
  partySize: number;
  quotedWaitMinutes: number | null;
  status: string;
  joinedAt: string;
}

export function parseReservations(value: unknown): Reservation[] {
  return records(value).map((row) => ({
    id: text(row.id),
    guestName: text(row.guestName),
    guestPhone: optionalText(row.guestPhone),
    partySize: number(row.partySize),
    scheduledAt: text(row.scheduledAt),
    durationMinutes: number(row.durationMinutes),
    status: text(row.status),
    notes: optionalText(row.notes),
  }));
}

export function parseWaitlist(value: unknown): WaitlistEntry[] {
  return records(value).map((row) => ({
    id: text(row.id),
    guestName: text(row.guestName),
    guestPhone: optionalText(row.guestPhone),
    partySize: number(row.partySize),
    quotedWaitMinutes: row.quotedWaitMinutes === null ? null : number(row.quotedWaitMinutes),
    status: text(row.status),
    joinedAt: text(row.joinedAt),
  }));
}

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  marketingOptIn: boolean;
}

interface Campaign {
  id: string;
  name: string;
  channel: string;
  status: string;
  subject: string | null;
  queuedAt: string | null;
  sentAt: string | null;
}

export function parseCustomers(value: unknown): Customer[] {
  return records(value).map((row) => ({
    id: text(row.id),
    name: text(row.name),
    email: optionalText(row.email),
    phone: optionalText(row.phone),
    marketingOptIn: bool(row.marketingOptIn),
  }));
}

export function parseCampaigns(value: unknown): Campaign[] {
  return records(value).map((row) => ({
    id: text(row.id),
    name: text(row.name),
    channel: text(row.channel),
    status: text(row.status),
    subject: optionalText(row.subject),
    queuedAt: optionalText(row.queuedAt),
    sentAt: optionalText(row.sentAt),
  }));
}

interface MultiunitSummary {
  generatedAt: string;
  units: Array<{
    id: string;
    name: string;
    completedDeliveryGrossCents: number;
    activeReservations: number;
    activeWaitlist: number;
  }>;
  transfersByStatus: Record<string, number>;
  disclaimer: string;
}

export function parseMultiunitSummary(value: unknown): MultiunitSummary {
  const payload = record(value);
  const transfers = record(payload.transfersByStatus);
  return {
    generatedAt: text(payload.generatedAt),
    units: records(payload.units).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      completedDeliveryGrossCents: number(row.completedDeliveryGrossCents),
      activeReservations: number(row.activeReservations),
      activeWaitlist: number(row.activeWaitlist),
    })),
    transfersByStatus: Object.fromEntries(
      Object.entries(transfers).map(([key, value]) => [key, number(value)]),
    ),
    disclaimer: text(payload.disclaimer),
  };
}

function useRemote<T>(
  scope: GrowthScope,
  loader: () => Promise<unknown>,
  parser: (value: unknown) => T,
) {
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  const loaderRef = useRef(loader);
  const parserRef = useRef(parser);
  loaderRef.current = loader;
  parserRef.current = parser;
  useEffect(() => {
    void retryToken;
    void scope.organizationId;
    void scope.refreshToken;
    void scope.unitId;
    let active = true;
    setState({ status: "loading" });
    loaderRef
      .current()
      .then(parserRef.current)
      .then((data) => active && setState({ status: "ready", data }))
      .catch(
        (error: unknown) =>
          active &&
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Não foi possível carregar os dados.",
          }),
      );
    return () => {
      active = false;
    };
  }, [retryToken, scope.organizationId, scope.refreshToken, scope.unitId]);
  return { state, retry: () => setRetryToken((value) => value + 1) };
}

function RemoteGate<T>({
  remote,
  children,
}: {
  remote: ReturnType<typeof useRemote<T>>;
  children: (data: T) => React.ReactNode;
}) {
  if (remote.state.status === "loading")
    return (
      <Card className="remote-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Carregando dados persistidos…</strong>
      </Card>
    );
  if (remote.state.status === "error")
    return (
      <Card className="remote-state" role="alert">
        <strong>Não foi possível carregar esta área</strong>
        <p>{remote.state.message}</p>
        <Button onClick={remote.retry} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      </Card>
    );
  return children(remote.state.data);
}

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data inválida"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function RealDeliveryPage({ scope }: { scope: GrowthScope }) {
  const remote = useRemote(
    scope,
    () => api.growth.deliveryZones(scope.organizationId, scope.unitId),
    parseDeliveryZones,
  );
  return (
    <div className="growth-stack">
      <Card className="honest-limit" role="note">
        <Badge tone="info">Integração transparente</Badge>
        <h2>Configuração própria de entrega</h2>
        <p>
          Esta versão do backend ainda não expõe uma listagem autenticada de pedidos de delivery.
          Por isso, o GiroMesa mostra apenas zonas realmente persistidas e não simula pedidos ou
          status de marketplaces.
        </p>
      </Card>
      <RemoteGate remote={remote}>
        {(zones) =>
          zones.length === 0 ? (
            <EmptyState
              icon={<UiIcon name="location" />}
              title="Nenhuma zona configurada"
              description="Defina zonas, taxa e pedido mínimo antes de ativar a entrega própria."
            />
          ) : (
            <div className="ops-grid">
              {zones.map((zone) => (
                <Card key={zone.id}>
                  <div className="section-title">
                    <h2>{zone.name}</h2>
                    <Badge tone={zone.active ? "success" : "neutral"}>
                      {zone.active ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  <dl className="definition-grid">
                    <div>
                      <dt>Taxa</dt>
                      <dd>{formatMoney(zone.feeCents)}</dd>
                    </div>
                    <div>
                      <dt>Pedido mínimo</dt>
                      <dd>{formatMoney(zone.minimumOrderCents)}</dd>
                    </div>
                  </dl>
                </Card>
              ))}
            </div>
          )
        }
      </RemoteGate>
    </div>
  );
}

export function RealReservationsPage({ scope }: { scope: GrowthScope }) {
  const reservations = useRemote(
    scope,
    () => api.growth.reservations(scope.organizationId, scope.unitId),
    parseReservations,
  );
  const waitlist = useRemote(
    scope,
    () => api.growth.waitlist(scope.organizationId, scope.unitId),
    parseWaitlist,
  );
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  async function mutate(id: string, action: () => Promise<unknown>, retry: () => void) {
    setBusy(id);
    setFeedback("");
    try {
      await action();
      retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "A transição não foi confirmada.");
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="growth-stack">
      {feedback && (
        <p className="field-error" role="alert">
          {feedback}
        </p>
      )}
      <div className="ops-grid">
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Agenda</p>
              <h2>Reservas</h2>
            </div>
          </div>
          <RemoteGate remote={reservations}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<UiIcon name="clock" />}
                  title="Sem reservas"
                  description="Nenhuma reserva persistida para esta unidade."
                />
              ) : (
                <div className="data-list">
                  {rows.map((row) => (
                    <article className="data-row" key={row.id}>
                      <div>
                        <strong>
                          {row.guestName} · {row.partySize} pessoas
                        </strong>
                        <small>
                          {dateTime(row.scheduledAt)} · {row.durationMinutes} min
                        </small>
                        <Badge tone={row.status === "seated" ? "success" : "neutral"}>
                          {row.status}
                        </Badge>
                      </div>
                      <div className="compact-actions">
                        {["booked"].includes(row.status) && (
                          <Button
                            disabled={busy === row.id}
                            onClick={() =>
                              void mutate(
                                row.id,
                                () =>
                                  api.growth.transitionReservation(
                                    scope.organizationId,
                                    row.id,
                                    "confirmed",
                                  ),
                                reservations.retry,
                              )
                            }
                            size="sm"
                            variant="secondary"
                          >
                            Confirmar
                          </Button>
                        )}
                        {["booked", "confirmed"].includes(row.status) && (
                          <Button
                            disabled={busy === row.id}
                            onClick={() =>
                              void mutate(
                                row.id,
                                () =>
                                  api.growth.transitionReservation(
                                    scope.organizationId,
                                    row.id,
                                    "seated",
                                  ),
                                reservations.retry,
                              )
                            }
                            size="sm"
                          >
                            Sentar
                          </Button>
                        )}
                        {row.status === "seated" && (
                          <Button
                            disabled={busy === row.id}
                            onClick={() =>
                              void mutate(
                                row.id,
                                () =>
                                  api.growth.transitionReservation(
                                    scope.organizationId,
                                    row.id,
                                    "completed",
                                  ),
                                reservations.retry,
                              )
                            }
                            size="sm"
                          >
                            Concluir
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )
            }
          </RemoteGate>
        </Card>
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Recepção</p>
              <h2>Lista de espera</h2>
            </div>
          </div>
          <RemoteGate remote={waitlist}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<UiIcon name="clock" />}
                  title="Fila vazia"
                  description="Nenhum cliente aguarda mesa neste momento."
                />
              ) : (
                <div className="data-list">
                  {rows.map((row) => (
                    <article className="data-row" key={row.id}>
                      <div>
                        <strong>
                          {row.guestName} · {row.partySize} pessoas
                        </strong>
                        <small>
                          {row.quotedWaitMinutes === null
                            ? "Espera não estimada"
                            : `${row.quotedWaitMinutes} min estimados`}{" "}
                          · entrada {dateTime(row.joinedAt)}
                        </small>
                        <Badge
                          tone={
                            row.status === "notified"
                              ? "warning"
                              : row.status === "seated"
                                ? "success"
                                : "neutral"
                          }
                        >
                          {row.status}
                        </Badge>
                      </div>
                      <div className="compact-actions">
                        {row.status === "waiting" && (
                          <Button
                            disabled={busy === row.id}
                            onClick={() =>
                              void mutate(
                                row.id,
                                () =>
                                  api.growth.transitionWaitlist(
                                    scope.organizationId,
                                    row.id,
                                    "notified",
                                  ),
                                waitlist.retry,
                              )
                            }
                            size="sm"
                            variant="secondary"
                          >
                            Notificar
                          </Button>
                        )}
                        {["waiting", "notified"].includes(row.status) && (
                          <Button
                            disabled={busy === row.id}
                            onClick={() =>
                              void mutate(
                                row.id,
                                () =>
                                  api.growth.transitionWaitlist(
                                    scope.organizationId,
                                    row.id,
                                    "seated",
                                  ),
                                waitlist.retry,
                              )
                            }
                            size="sm"
                          >
                            Sentar
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )
            }
          </RemoteGate>
        </Card>
      </div>
    </div>
  );
}

export function RealCrmPage({ scope }: { scope: GrowthScope }) {
  const customers = useRemote(
    scope,
    () => api.growth.customers(scope.organizationId),
    parseCustomers,
  );
  const campaigns = useRemote(
    scope,
    () => api.growth.campaigns(scope.organizationId),
    parseCampaigns,
  );
  const [balanceByCustomer, setBalanceByCustomer] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  async function loadBalance(customerId: string) {
    setBusy(customerId);
    setFeedback("");
    try {
      const payload = record(await api.growth.loyaltyBalance(scope.organizationId, customerId));
      setBalanceByCustomer((value) => ({ ...value, [customerId]: number(payload.balance) }));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível consultar o saldo.");
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="growth-stack">
      {feedback && (
        <p className="field-error" role="alert">
          {feedback}
        </p>
      )}
      <div className="ops-grid">
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Relacionamento</p>
              <h2>Clientes e fidelidade</h2>
            </div>
          </div>
          <RemoteGate remote={customers}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<UiIcon name="crm" />}
                  title="Sem clientes"
                  description="O cadastro de clientes ainda não possui registros."
                />
              ) : (
                <div className="data-list">
                  {rows.map((row) => (
                    <article className="data-row" key={row.id}>
                      <div>
                        <strong>{row.name}</strong>
                        <small>{row.email ?? row.phone ?? "Sem contato"}</small>
                        <Badge tone={row.marketingOptIn ? "success" : "neutral"}>
                          {row.marketingOptIn ? "Marketing autorizado" : "Sem opt-in"}
                        </Badge>
                      </div>
                      <div className="data-row__end">
                        {balanceByCustomer[row.id] === undefined ? (
                          <Button
                            disabled={busy === row.id}
                            onClick={() => void loadBalance(row.id)}
                            size="sm"
                            variant="secondary"
                          >
                            Ver saldo
                          </Button>
                        ) : (
                          <strong>{balanceByCustomer[row.id]} ponto(s)</strong>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )
            }
          </RemoteGate>
        </Card>
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Campanhas</p>
              <h2>Status persistido</h2>
            </div>
          </div>
          <p className="muted">
            O status abaixo vem do banco. “Bloqueada” não significa envio realizado; normalmente
            indica ausência de provedor homologado.
          </p>
          <RemoteGate remote={campaigns}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<UiIcon name="mail" />}
                  title="Sem campanhas"
                  description="Nenhuma campanha foi criada para esta organização."
                />
              ) : (
                <div className="data-list">
                  {rows.map((row) => (
                    <article className="data-row" key={row.id}>
                      <div>
                        <strong>{row.name}</strong>
                        <small>
                          {row.channel}
                          {row.subject ? ` · ${row.subject}` : ""}
                        </small>
                      </div>
                      <Badge
                        tone={
                          row.status === "sent"
                            ? "success"
                            : row.status === "blocked"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {row.status}
                      </Badge>
                    </article>
                  ))}
                </div>
              )
            }
          </RemoteGate>
        </Card>
      </div>
    </div>
  );
}

export function RealMultiunitPage({ scope }: { scope: GrowthScope }) {
  const remote = useRemote(
    scope,
    () => api.growth.multiunitSummary(scope.organizationId),
    parseMultiunitSummary,
  );
  return (
    <RemoteGate remote={remote}>
      {(summary) => (
        <div className="growth-stack">
          <Card className="honest-limit">
            <Badge tone="info">Consolidado persistido</Badge>
            <h2>Visão da organização</h2>
            <p>{summary.disclaimer}</p>
            <small>Gerado em {dateTime(summary.generatedAt)}</small>
          </Card>
          {summary.units.length === 0 ? (
            <EmptyState
              icon={<UiIcon name="multiunit" />}
              title="Sem unidades ativas"
              description="Nenhuma unidade foi retornada no consolidado."
            />
          ) : (
            <div className="ops-grid">
              {summary.units.map((unit) => (
                <Card key={unit.id}>
                  <h2>{unit.name}</h2>
                  <dl className="definition-grid">
                    <div>
                      <dt>Delivery concluído</dt>
                      <dd>{formatMoney(unit.completedDeliveryGrossCents)}</dd>
                    </div>
                    <div>
                      <dt>Reservas ativas</dt>
                      <dd>{unit.activeReservations}</dd>
                    </div>
                    <div>
                      <dt>Fila ativa</dt>
                      <dd>{unit.activeWaitlist}</dd>
                    </div>
                  </dl>
                </Card>
              ))}
            </div>
          )}
          <Card>
            <h2>Transferências de estoque</h2>
            {Object.keys(summary.transfersByStatus).length === 0 ? (
              <p className="muted">Nenhuma transferência persistida.</p>
            ) : (
              <div className="badge-row">
                {Object.entries(summary.transfersByStatus).map(([status, total]) => (
                  <Badge key={status} tone="neutral">
                    {status}: {total}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </RemoteGate>
  );
}
