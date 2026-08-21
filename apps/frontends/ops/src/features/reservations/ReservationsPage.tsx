// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Modal,
  NativeSelect,
  Textarea,
} from "@giromesa/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import {
  dateTime,
  type GrowthScope,
  mutationKey,
  parseReservations,
  parseWaitlist,
  RemoteGate,
  useRemote,
} from "../../growth.shared";
import { parsePilotFloor } from "../../operations.shared";
import "./reservations.css";

type SeatTarget = {
  id: string;
  kind: "reservation" | "waitlist";
  guestName: string;
  guestPhone: string | null;
  partySize: number;
};

function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function agendaWindow(day: string) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(`${day}T23:59:59.999`);
  return { from: start.toISOString(), to: end.toISOString() };
}

function elapsedMinutes(value: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
}

function matchesArrival(query: string, name: string, phone: string | null) {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  return !normalized || `${name} ${phone ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalized);
}

export function suggestedWait(data: ReturnType<typeof parsePilotFloor>, partySize: number) {
  const compatible = data.tables.filter((table) => table.active && table.seats >= partySize);
  if (compatible.some((table) => table.status === "available")) return 0;
  if (compatible.some((table) => ["needs_cleaning", "cleaning"].includes(table.status))) return 10;
  const releases = compatible.flatMap((table) => {
    const tab = data.openTabs.find((candidate) => candidate.tableId === table.id);
    if (!tab?.openedAt) return [];
    // ponytail: 120-minute estimate; replace with unit history when enough closed-tab data exists.
    return [
      Math.max(
        5,
        Math.ceil((new Date(tab.openedAt).getTime() + 120 * 60_000 - Date.now()) / 60_000),
      ),
    ];
  });
  return releases.length > 0 ? Math.min(...releases) : null;
}

export function reservationCapacity(
  floor: ReturnType<typeof parsePilotFloor>,
  rows: ReturnType<typeof parseReservations>,
  scheduledAt: string,
  partySize: number,
) {
  const start = new Date(scheduledAt).getTime();
  if (!Number.isFinite(start)) return null;
  const activeTables = floor.tables.filter((table) => table.active);
  const totalSeats = activeTables.reduce((sum, table) => sum + table.seats, 0);
  const reservedSeats = rows
    .filter((row) => {
      if (!["booked", "confirmed"].includes(row.status)) return false;
      const rowStart = new Date(row.scheduledAt).getTime();
      const rowEnd = rowStart + row.durationMinutes * 60_000;
      return rowStart < start + 120 * 60_000 && rowEnd > start;
    })
    .reduce((sum, row) => sum + row.partySize, 0);
  return {
    compatible: activeTables.some((table) => table.seats >= partySize),
    remainingSeats: totalSeats - reservedSeats - partySize,
  };
}

const statusLabel: Record<string, string> = {
  booked: "A confirmar",
  confirmed: "Confirmada",
  seated: "Sentado",
  completed: "Concluída",
  canceled: "Cancelada",
  no_show: "Não compareceu",
  waiting: "Aguardando",
  notified: "Contato registrado",
  left: "Saiu da fila",
};

export function RealReservationsPage({ scope }: { scope: GrowthScope }) {
  const [agendaDate, setAgendaDate] = useState(localDateValue);
  const [historyLimit, setHistoryLimit] = useState(20);
  const agendaRange = agendaWindow(agendaDate);
  const reservations = useRemote(
    scope,
    () =>
      api.growth.reservations(scope.organizationId, scope.unitId, {
        scope: "active",
        from: agendaRange.from,
        to: agendaRange.to,
      }),
    parseReservations,
    agendaDate,
  );
  const waitlist = useRemote(
    scope,
    () => api.growth.waitlist(scope.organizationId, scope.unitId, { scope: "active" }),
    parseWaitlist,
  );
  const reservationHistory = useRemote(
    scope,
    () =>
      api.growth.reservations(scope.organizationId, scope.unitId, {
        scope: "history",
        limit: historyLimit,
      }),
    parseReservations,
    String(historyLimit),
  );
  const waitlistHistory = useRemote(
    scope,
    () =>
      api.growth.waitlist(scope.organizationId, scope.unitId, {
        scope: "history",
        limit: historyLimit,
      }),
    parseWaitlist,
    String(historyLimit),
  );
  const floor = useRemote(
    scope,
    () => api.pilot.floor(scope.organizationId, scope.unitId),
    parsePilotFloor,
  );
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [scheduledAt, setScheduledAt] = useState("");
  const [reservationNotes, setReservationNotes] = useState("");
  const [waitMinutes, setWaitMinutes] = useState(20);
  const [arrivalQuery, setArrivalQuery] = useState("");
  const [seatTarget, setSeatTarget] = useState<SeatTarget | null>(null);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const reservationComposerRef = useRef<HTMLDetailsElement>(null);
  const reservationNameRef = useRef<HTMLInputElement>(null);
  const waitlistComposerRef = useRef<HTMLDetailsElement>(null);
  const waitlistNameRef = useRef<HTMLInputElement>(null);
  const waitSuggestion =
    floor.state.status === "ready" ? suggestedWait(floor.state.data, partySize) : null;
  const capacity =
    floor.state.status === "ready" && reservations.state.status === "ready" && scheduledAt
      ? reservationCapacity(floor.state.data, reservations.state.data, scheduledAt, partySize)
      : null;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  function openComposer(kind: "reservation" | "waitlist") {
    const composer =
      kind === "reservation" ? reservationComposerRef.current : waitlistComposerRef.current;
    const otherComposer =
      kind === "reservation" ? waitlistComposerRef.current : reservationComposerRef.current;
    const nameInput = kind === "reservation" ? reservationNameRef.current : waitlistNameRef.current;
    if (!composer) return;
    otherComposer?.removeAttribute("open");
    composer.open = true;
    composer.scrollIntoView({ behavior: "smooth", block: "start" });
    nameInput?.focus({ preventScroll: true });
  }

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

  async function createReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime())) {
      setFeedback("Informe uma data e hora válidas para a reserva.");
      return;
    }
    setBusy("new-reservation");
    setFeedback("");
    try {
      await api.growth.createReservation(scope.organizationId, {
        unitId: scope.unitId,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        partySize,
        scheduledAt: date.toISOString(),
        durationMinutes: 120,
        notes: reservationNotes.trim() || undefined,
        idempotencyKey: mutationKey("reservation"),
      });
      setFeedback("Reserva adicionada à agenda.");
      setGuestName("");
      setGuestPhone("");
      setReservationNotes("");
      reservations.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível criar a reserva.");
    } finally {
      setBusy("");
    }
  }

  async function createWaitlistEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("new-waitlist");
    setFeedback("");
    try {
      await api.growth.createWaitlistEntry(scope.organizationId, {
        unitId: scope.unitId,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        partySize,
        quotedWaitMinutes: waitMinutes,
        idempotencyKey: mutationKey("waitlist"),
      });
      setFeedback("Cliente adicionado à lista de espera.");
      setGuestName("");
      setGuestPhone("");
      waitlist.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível atualizar a fila.");
    } finally {
      setBusy("");
    }
  }

  function prepareSeat(target: SeatTarget) {
    setSelectedTableId("");
    setSeatTarget(target);
  }

  async function seatGuest() {
    if (!seatTarget || !selectedTableId) return;
    setBusy(`seat-${seatTarget.id}`);
    setFeedback("");
    try {
      await api.pilot.openTab(
        scope.organizationId,
        scope.unitId,
        {
          tableId: selectedTableId,
          guestCount: seatTarget.partySize,
          fulfillmentType: "dine_in",
          customerName: seatTarget.guestName,
          customerPhone: seatTarget.guestPhone ?? undefined,
          ...(seatTarget.kind === "reservation"
            ? { reservationId: seatTarget.id }
            : { waitlistEntryId: seatTarget.id }),
        },
        mutationKey(`seat-${seatTarget.kind}`),
      );
      setFeedback(`Mesa ocupada e comanda aberta para ${seatTarget.guestName}.`);
      setSeatTarget(null);
      setSelectedTableId("");
      reservations.retry();
      waitlist.retry();
      reservationHistory.retry();
      waitlistHistory.retry();
      floor.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível ocupar a mesa.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="growth-stack reservations-page">
      {feedback && (
        <p className="form-feedback" role="status">
          {feedback}
        </p>
      )}
      <div
        aria-live={!online || reservations.refreshError || waitlist.refreshError ? "polite" : "off"}
        className="reception-sync-status"
        role="status"
      >
        <span>
          <Badge
            tone={
              !online || reservations.refreshError || waitlist.refreshError ? "warning" : "success"
            }
          >
            {!online
              ? "Sem conexão"
              : reservations.refreshError || waitlist.refreshError
                ? "Dados podem estar atrasados"
                : "Dados confirmados"}
          </Badge>
          <small>
            {!online
              ? "Cadastros e mudanças exigem reconexão."
              : (reservations.refreshError ??
                waitlist.refreshError ??
                (reservations.lastSuccessfulAt
                  ? `Última confirmação às ${new Date(reservations.lastSuccessfulAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                  : "Aguardando primeira confirmação"))}
          </small>
        </span>
        <Button
          disabled={!online || reservations.refreshing || waitlist.refreshing}
          onClick={() => {
            reservations.retry();
            waitlist.retry();
            floor.retry();
          }}
          size="sm"
          variant="ghost"
        >
          {reservations.refreshing || waitlist.refreshing ? "Atualizando…" : "Atualizar"}
        </Button>
      </div>
      <Card className="arrival-bar">
        <label className="search-field">
          <Icon name="search" size={18} />
          <Input
            onChange={(event) => setArrivalQuery(event.target.value)}
            placeholder="Buscar chegada por nome ou telefone"
            type="search"
            value={arrivalQuery}
          />
        </label>
        <label>
          Agenda do dia
          <Input
            onChange={(event) => setAgendaDate(event.target.value)}
            type="date"
            value={agendaDate}
          />
        </label>
        <div className="arrival-bar__actions">
          <Button onClick={() => openComposer("reservation")} size="sm" variant="secondary">
            Nova reserva
          </Button>
          <Button onClick={() => openComposer("waitlist")} size="sm">
            Cliente sem reserva
          </Button>
        </div>
      </Card>
      <div className="quick-actions-grid reservations-actions">
        <details className="action-panel" id="reservation-composer" ref={reservationComposerRef}>
          <summary>
            <span>
              <strong>Nova reserva</strong>
              <small>Inclua um cliente na agenda da unidade.</small>
            </span>
            <Icon name="plus" size={18} />
          </summary>
          <form className="action-form" onSubmit={(event) => void createReservation(event)}>
            <label>
              Nome
              <Input
                minLength={2}
                onChange={(event) => setGuestName(event.target.value)}
                ref={reservationNameRef}
                required
                value={guestName}
              />
            </label>
            <label>
              Telefone
              <Input
                minLength={8}
                onChange={(event) => setGuestPhone(event.target.value)}
                type="tel"
                value={guestPhone}
              />
            </label>
            <label>
              Pessoas
              <Input
                min={1}
                onChange={(event) => setPartySize(Number(event.target.value))}
                required
                type="number"
                value={partySize}
              />
            </label>
            <label>
              Data e hora
              <Input
                onChange={(event) => {
                  setScheduledAt(event.target.value);
                  if (event.target.value.length >= 10)
                    setAgendaDate(event.target.value.slice(0, 10));
                }}
                required
                type="datetime-local"
                value={scheduledAt}
              />
            </label>
            <label className="action-form__wide">
              Preferências e observações
              <Textarea
                maxLength={500}
                onChange={(event) => setReservationNotes(event.target.value)}
                rows={2}
                value={reservationNotes}
              />
            </label>
            {capacity && (
              <p
                className={`action-form__wide capacity-hint ${!capacity.compatible || capacity.remainingSeats < 0 ? "capacity-hint--warning" : ""}`}
                role="status"
              >
                {!capacity.compatible
                  ? `Atenção: nenhuma mesa individual comporta ${partySize} pessoas.`
                  : capacity.remainingSeats < 0
                    ? `Atenção: a agenda excede a capacidade estimada em ${Math.abs(capacity.remainingSeats)} lugar(es).`
                    : `Capacidade estimada após esta reserva: ${capacity.remainingSeats} lugar(es).`}
              </p>
            )}
            <Button
              disabled={busy === "new-reservation" || guestName.trim().length < 2}
              type="submit"
            >
              {busy === "new-reservation" ? "Salvando…" : "Criar reserva"}
            </Button>
          </form>
        </details>
        <details className="action-panel" id="waitlist-composer" ref={waitlistComposerRef}>
          <summary>
            <span>
              <strong>Adicionar à espera</strong>
              <small>Registre chegada e previsão informada.</small>
            </span>
            <Icon name="plus" size={18} />
          </summary>
          <form className="action-form" onSubmit={(event) => void createWaitlistEntry(event)}>
            <label>
              Nome
              <Input
                minLength={2}
                onChange={(event) => setGuestName(event.target.value)}
                ref={waitlistNameRef}
                required
                value={guestName}
              />
            </label>
            <label>
              Telefone
              <Input
                minLength={8}
                onChange={(event) => setGuestPhone(event.target.value)}
                type="tel"
                value={guestPhone}
              />
            </label>
            <label>
              Pessoas
              <Input
                min={1}
                onChange={(event) => setPartySize(Number(event.target.value))}
                required
                type="number"
                value={partySize}
              />
            </label>
            <label>
              Espera informada (min)
              <Input
                min={0}
                onChange={(event) => setWaitMinutes(Number(event.target.value))}
                type="number"
                value={waitMinutes}
              />
            </label>
            {waitSuggestion !== null && (
              <div className="action-form__wide capacity-hint" role="status">
                <span>
                  Sugestão pela ocupação atual: <strong>{waitSuggestion} min</strong>
                </span>
                {waitMinutes !== waitSuggestion && (
                  <Button
                    onClick={() => setWaitMinutes(waitSuggestion)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Usar sugestão
                  </Button>
                )}
              </div>
            )}
            <Button disabled={busy === "new-waitlist" || guestName.trim().length < 2} type="submit">
              {busy === "new-waitlist" ? "Salvando…" : "Adicionar à fila"}
            </Button>
          </form>
        </details>
      </div>
      <div className="ops-grid reservations-board">
        <Card className="reservations-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">Agenda</p>
              <h2>Reservas</h2>
            </div>
          </div>
          <RemoteGate remote={reservations}>
            {(rows) => {
              const sortedRows = rows
                .filter((row) => matchesArrival(arrivalQuery, row.guestName, row.guestPhone))
                .sort(
                  (left, right) =>
                    new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime(),
                );
              return sortedRows.length === 0 ? (
                <EmptyState
                  action={
                    <Button
                      aria-controls="reservation-composer"
                      onClick={() => openComposer("reservation")}
                      size="sm"
                      variant="secondary"
                    >
                      Criar reserva
                    </Button>
                  }
                  icon={<Icon name="reservations" size={28} />}
                  title="Sem reservas"
                  description={
                    arrivalQuery
                      ? "Nenhuma reserva corresponde à busca."
                      : "Nenhuma reserva ativa para este dia."
                  }
                />
              ) : (
                <div className="data-list">
                  {sortedRows.map((row) => {
                    const minutesUntil = Math.ceil(
                      (new Date(row.scheduledAt).getTime() - Date.now()) / 60_000,
                    );
                    return (
                      <article className="data-row" key={row.id}>
                        <div>
                          <strong>
                            {row.guestName} · {row.partySize} pessoas
                          </strong>
                          <small>
                            {dateTime(row.scheduledAt)} · {row.durationMinutes} min
                          </small>
                          <small className={minutesUntil < 0 ? "priority-late" : undefined}>
                            {minutesUntil < 0
                              ? `${Math.abs(minutesUntil)} min em atraso`
                              : minutesUntil <= 30
                                ? `Chega em ${minutesUntil} min`
                                : "Programada"}
                          </small>
                          <Badge tone={row.status === "seated" ? "success" : "neutral"}>
                            {statusLabel[row.status] ?? row.status}
                          </Badge>
                          {row.guestPhone && <a href={`tel:${row.guestPhone}`}>{row.guestPhone}</a>}
                          {row.notes && <small className="reservation-note">{row.notes}</small>}
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
                              disabled={busy === `seat-${row.id}`}
                              onClick={() =>
                                prepareSeat({
                                  id: row.id,
                                  kind: "reservation",
                                  guestName: row.guestName,
                                  guestPhone: row.guestPhone,
                                  partySize: row.partySize,
                                })
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
                          {["booked", "confirmed"].includes(row.status) && (
                            <details className="row-more-actions">
                              <summary>Mais</summary>
                              <div>
                                <Button
                                  disabled={busy === row.id}
                                  onClick={() =>
                                    void mutate(
                                      row.id,
                                      () =>
                                        api.growth.transitionReservation(
                                          scope.organizationId,
                                          row.id,
                                          "no_show",
                                        ),
                                      () => {
                                        reservations.retry();
                                        reservationHistory.retry();
                                      },
                                    )
                                  }
                                  size="sm"
                                  variant="ghost"
                                >
                                  Não compareceu
                                </Button>
                                <Button
                                  disabled={busy === row.id}
                                  onClick={() =>
                                    void mutate(
                                      row.id,
                                      () =>
                                        api.growth.transitionReservation(
                                          scope.organizationId,
                                          row.id,
                                          "canceled",
                                        ),
                                      () => {
                                        reservations.retry();
                                        reservationHistory.retry();
                                      },
                                    )
                                  }
                                  size="sm"
                                  variant="ghost"
                                >
                                  Cancelar reserva
                                </Button>
                              </div>
                            </details>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              );
            }}
          </RemoteGate>
        </Card>
        <Card className="reservations-card">
          <div className="section-title">
            <div>
              <p className="eyebrow">Recepção</p>
              <h2>Lista de espera</h2>
            </div>
          </div>
          <RemoteGate remote={waitlist}>
            {(rows) => {
              const sortedRows = rows
                .filter((row) => matchesArrival(arrivalQuery, row.guestName, row.guestPhone))
                .sort(
                  (left, right) =>
                    new Date(left.joinedAt).getTime() - new Date(right.joinedAt).getTime(),
                );
              return sortedRows.length === 0 ? (
                <EmptyState
                  action={
                    <Button
                      aria-controls="waitlist-composer"
                      onClick={() => openComposer("waitlist")}
                      size="sm"
                      variant="secondary"
                    >
                      Adicionar cliente
                    </Button>
                  }
                  icon={<Icon name="clock" size={28} />}
                  title="Fila vazia"
                  description={
                    arrivalQuery
                      ? "Nenhum cliente da fila corresponde à busca."
                      : "Nenhum cliente aguardando mesa agora."
                  }
                />
              ) : (
                <div className="data-list">
                  {sortedRows.map((row) => {
                    const waitingMinutes = elapsedMinutes(row.joinedAt);
                    const waitDelta =
                      row.quotedWaitMinutes === null
                        ? null
                        : waitingMinutes - row.quotedWaitMinutes;
                    return (
                      <article className="data-row" key={row.id}>
                        <div>
                          <strong>
                            {row.guestName} · {row.partySize} pessoas
                          </strong>
                          <small>
                            Aguarda {waitingMinutes} min · entrada {dateTime(row.joinedAt)}
                          </small>
                          <small
                            className={
                              waitDelta !== null && waitDelta > 0 ? "priority-late" : undefined
                            }
                          >
                            {row.quotedWaitMinutes === null
                              ? "Previsão não informada"
                              : waitDelta !== null && waitDelta > 0
                                ? `Previsão excedida em ${waitDelta} min`
                                : `${Math.max(0, -(waitDelta ?? 0))} min restantes da previsão`}
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
                            {statusLabel[row.status] ?? row.status}
                          </Badge>
                          {row.guestPhone && <a href={`tel:${row.guestPhone}`}>{row.guestPhone}</a>}
                          {row.status === "notified" && (
                            <small>Contato registrado em {dateTime(row.updatedAt)}</small>
                          )}
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
                              Registrar contato
                            </Button>
                          )}
                          {["waiting", "notified"].includes(row.status) && (
                            <Button
                              disabled={busy === `seat-${row.id}`}
                              onClick={() =>
                                prepareSeat({
                                  id: row.id,
                                  kind: "waitlist",
                                  guestName: row.guestName,
                                  guestPhone: row.guestPhone,
                                  partySize: row.partySize,
                                })
                              }
                              size="sm"
                            >
                              Sentar
                            </Button>
                          )}
                          {["waiting", "notified"].includes(row.status) && (
                            <details className="row-more-actions">
                              <summary>Mais</summary>
                              <div>
                                <Button
                                  disabled={busy === row.id}
                                  onClick={() =>
                                    void mutate(
                                      row.id,
                                      () =>
                                        api.growth.transitionWaitlist(
                                          scope.organizationId,
                                          row.id,
                                          "left",
                                        ),
                                      () => {
                                        waitlist.retry();
                                        waitlistHistory.retry();
                                      },
                                    )
                                  }
                                  size="sm"
                                  variant="ghost"
                                >
                                  Saiu da fila
                                </Button>
                                <Button
                                  disabled={busy === row.id}
                                  onClick={() =>
                                    void mutate(
                                      row.id,
                                      () =>
                                        api.growth.transitionWaitlist(
                                          scope.organizationId,
                                          row.id,
                                          "no_show",
                                        ),
                                      () => {
                                        waitlist.retry();
                                        waitlistHistory.retry();
                                      },
                                    )
                                  }
                                  size="sm"
                                  variant="ghost"
                                >
                                  Não compareceu
                                </Button>
                              </div>
                            </details>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              );
            }}
          </RemoteGate>
        </Card>
      </div>
      <details className="reception-history">
        <summary>Histórico de reservas e fila</summary>
        <div className="ops-grid reservations-board">
          <Card>
            <h3>Reservas anteriores</h3>
            <RemoteGate remote={reservationHistory}>
              {(rows) =>
                rows.length === 0 ? (
                  <p className="muted-copy">Sem reservas concluídas ou canceladas.</p>
                ) : (
                  <div className="data-list">
                    {rows.map((row) => (
                      <article className="data-row" key={row.id}>
                        <span>
                          <strong>{row.guestName}</strong>
                          <small>{dateTime(row.scheduledAt)}</small>
                        </span>
                        <Badge tone="neutral">{statusLabel[row.status] ?? row.status}</Badge>
                      </article>
                    ))}
                  </div>
                )
              }
            </RemoteGate>
          </Card>
          <Card>
            <h3>Passagens pela fila</h3>
            <RemoteGate remote={waitlistHistory}>
              {(rows) =>
                rows.length === 0 ? (
                  <p className="muted-copy">Sem histórico de espera.</p>
                ) : (
                  <div className="data-list">
                    {rows.map((row) => (
                      <article className="data-row" key={row.id}>
                        <span>
                          <strong>{row.guestName}</strong>
                          <small>{dateTime(row.joinedAt)}</small>
                        </span>
                        <Badge tone="neutral">{statusLabel[row.status] ?? row.status}</Badge>
                      </article>
                    ))}
                  </div>
                )
              }
            </RemoteGate>
          </Card>
        </div>
        {historyLimit < 200 && (
          <Button onClick={() => setHistoryLimit((value) => value + 20)} variant="secondary">
            Carregar mais histórico
          </Button>
        )}
      </details>
      <Modal
        isOpen={seatTarget !== null}
        onClose={() => {
          setSeatTarget(null);
          setSelectedTableId("");
        }}
        size="sm"
        title={seatTarget ? `Sentar ${seatTarget.guestName}` : "Escolher mesa"}
      >
        {seatTarget && (
          <RemoteGate remote={floor}>
            {(data) => {
              const compatibleTables = data.tables
                .filter(
                  (table) =>
                    table.active &&
                    table.seats >= seatTarget.partySize &&
                    (table.status === "available" ||
                      (seatTarget.kind === "reservation" && table.status === "reserved")),
                )
                .sort(
                  (left, right) =>
                    left.seats - right.seats || left.label.localeCompare(right.label),
                );
              return compatibleTables.length === 0 ? (
                <EmptyState
                  icon={<Icon name="salon" size={28} />}
                  title="Sem mesa compatível"
                  description={`Nenhuma mesa livre comporta ${seatTarget.partySize} pessoa(s).`}
                />
              ) : (
                <form
                  className="seat-guest-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void seatGuest();
                  }}
                >
                  <p>
                    A confirmação ocupará a mesa, abrirá a comanda e atualizará a recepção em uma
                    única operação.
                  </p>
                  <label>
                    Mesa compatível
                    <NativeSelect
                      onChange={(event) => setSelectedTableId(event.target.value)}
                      required
                      value={selectedTableId}
                    >
                      <option value="">Selecione</option>
                      {compatibleTables.map((table) => (
                        <option key={table.id} value={table.id}>
                          {data.rooms.find((room) => room.id === table.roomId)?.name ?? "Salão"} ·{" "}
                          {table.label} · {table.seats} lugares
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <Button
                    disabled={!selectedTableId || busy === `seat-${seatTarget.id}`}
                    type="submit"
                  >
                    {busy === `seat-${seatTarget.id}` ? "Sentando…" : "Ocupar mesa e abrir comanda"}
                  </Button>
                </form>
              );
            }}
          </RemoteGate>
        )}
      </Modal>
    </div>
  );
}
