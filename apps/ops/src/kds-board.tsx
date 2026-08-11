import { useEffect, useRef, useState } from "react";

export type KdsBoardStatus = "pending" | "preparing" | "ready";
export type KdsDeviceState = "online" | "degraded" | "offline";

export interface KdsBoardTicket {
  id: string;
  reference: string;
  station: string;
  status: KdsBoardStatus;
  elapsedMinutes: number;
  priority?: boolean;
  items: Array<{ id: string; label: string; notes?: string }>;
}

export interface KdsSla {
  level: "on-track" | "attention" | "critical" | "ready";
  label: "No prazo" | "Atenção ao SLA" | "SLA estourado" | "Pronto para retirada";
}

export function classifyKdsSla(ticket: KdsBoardTicket): KdsSla {
  if (ticket.status === "ready") return { level: "ready", label: "Pronto para retirada" };
  if (ticket.elapsedMinutes >= 20) return { level: "critical", label: "SLA estourado" };
  if (ticket.elapsedMinutes >= 12) return { level: "attention", label: "Atenção ao SLA" };
  return { level: "on-track", label: "No prazo" };
}

const slaWeight: Record<KdsSla["level"], number> = {
  critical: 3,
  attention: 2,
  "on-track": 1,
  ready: 0,
};

export function buildKdsBoardModel(tickets: readonly KdsBoardTicket[], station: string) {
  const visible = tickets
    .filter((ticket) => station === "Todas" || ticket.station === station)
    .toSorted((left, right) => {
      if (Boolean(left.priority) !== Boolean(right.priority)) return left.priority ? -1 : 1;
      const bySla = slaWeight[classifyKdsSla(right).level] - slaWeight[classifyKdsSla(left).level];
      return bySla || right.elapsedMinutes - left.elapsedMinutes;
    });
  return {
    stations: [...new Set(tickets.map((ticket) => ticket.station))].toSorted(),
    visible,
    summary: {
      pending: visible.filter((ticket) => ticket.status === "pending").length,
      preparing: visible.filter((ticket) => ticket.status === "preparing").length,
      ready: visible.filter((ticket) => ticket.status === "ready").length,
    },
  };
}

export function nextKdsBoardState(status: KdsBoardStatus): "preparing" | "ready" | "done" {
  if (status === "pending") return "preparing";
  if (status === "preparing") return "ready";
  return "done";
}

const columnMeta: Record<KdsBoardStatus, { label: string; step: string }> = {
  pending: { label: "Novos", step: "1" },
  preparing: { label: "Em preparo", step: "2" },
  ready: { label: "Prontos", step: "3" },
};

const deviceMeta: Record<KdsDeviceState, { label: string; detail: string }> = {
  online: { label: "Dispositivo online", detail: "Fila sincronizada" },
  degraded: { label: "Conexão instável", detail: "Confirme os envios pendentes" },
  offline: { label: "Dispositivo offline", detail: "Ações bloqueadas até reconectar" },
};

export function KdsBoard({
  tickets,
  deviceState,
  busyId = "",
  commitDelayMs = 5_000,
  onAdvance,
}: {
  tickets: readonly KdsBoardTicket[];
  deviceState: KdsDeviceState;
  busyId?: string;
  commitDelayMs?: number;
  onAdvance: (
    ticket: KdsBoardTicket,
    state: "preparing" | "ready" | "done",
  ) => void | Promise<void>;
}) {
  const [station, setStation] = useState("Todas");
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const model = buildKdsBoardModel(tickets, station);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  function schedule(ticket: KdsBoardTicket) {
    if (deviceState === "offline" || timers.current.has(ticket.id)) return;
    const state = nextKdsBoardState(ticket.status);
    setPendingIds((current) => [...current, ticket.id]);
    const timer = setTimeout(() => {
      timers.current.delete(ticket.id);
      setPendingIds((current) => current.filter((id) => id !== ticket.id));
      void onAdvance(ticket, state);
    }, commitDelayMs);
    timers.current.set(ticket.id, timer);
  }

  function undo(ticketId: string) {
    const timer = timers.current.get(ticketId);
    if (timer) clearTimeout(timer);
    timers.current.delete(ticketId);
    setPendingIds((current) => current.filter((id) => id !== ticketId));
  }

  return (
    <section className="production-kds" aria-label="Quadro de produção">
      <header className="production-kds__commandbar">
        <div>
          <p className="production-kds__eyebrow">Produção ao vivo</p>
          <h2>Fila por estação</h2>
          <p>
            Avanços têm <strong>Desfazer por 5s</strong> antes do envio.
          </p>
        </div>
        <div className={`kds-device kds-device--${deviceState}`} role="status">
          <span aria-hidden="true" className="kds-device__indicator" />
          <span>
            <strong>{deviceMeta[deviceState].label}</strong>
            <small>{deviceMeta[deviceState].detail}</small>
          </span>
        </div>
      </header>

      <fieldset className="production-kds__filters">
        <legend className="gm-sr-only">Filtrar estação</legend>
        <button
          aria-pressed={station === "Todas"}
          onClick={() => setStation("Todas")}
          type="button"
        >
          Todas as estações <strong>{tickets.length}</strong>
        </button>
        {model.stations.map((item) => (
          <button
            aria-pressed={station === item}
            key={item}
            onClick={() => setStation(item)}
            type="button"
          >
            {item} <strong>{tickets.filter((ticket) => ticket.station === item).length}</strong>
          </button>
        ))}
      </fieldset>

      <div className="production-kds__board">
        {(Object.keys(columnMeta) as KdsBoardStatus[]).map((status) => {
          const columnTickets = model.visible.filter((ticket) => ticket.status === status);
          return (
            <section className={`production-lane production-lane--${status}`} key={status}>
              <header>
                <span className="production-lane__step" aria-hidden="true">
                  {columnMeta[status].step}
                </span>
                <h3>{columnMeta[status].label}</h3>
                <strong>
                  <span className="gm-sr-only">{columnTickets.length} tickets</span>
                  <span aria-hidden="true">{columnTickets.length}</span>
                </strong>
              </header>
              <div className="production-lane__tickets">
                {columnTickets.length === 0 && <p className="production-lane__empty">Fila livre</p>}
                {columnTickets.map((ticket) => {
                  const sla = classifyKdsSla(ticket);
                  const pending = pendingIds.includes(ticket.id);
                  return (
                    <article
                      className={`production-ticket production-ticket--${sla.level}${ticket.priority ? " production-ticket--priority" : ""}`}
                      key={ticket.id}
                    >
                      <div className="production-ticket__flags">
                        <span className={`kds-sla kds-sla--${sla.level}`}>
                          <span aria-hidden="true">
                            {sla.level === "critical"
                              ? "!!"
                              : sla.level === "attention"
                                ? "!"
                                : "•"}
                          </span>
                          {sla.label}
                        </span>
                        {ticket.priority && <strong className="kds-priority">PRIORIDADE</strong>}
                      </div>
                      <div className="production-ticket__identity">
                        <span>
                          <small>{ticket.station}</small>
                          <strong>{ticket.reference}</strong>
                        </span>
                        <strong className="production-ticket__timer">
                          {ticket.elapsedMinutes} min
                        </strong>
                      </div>
                      <ul>
                        {ticket.items.map((item) => (
                          <li key={item.id}>
                            <strong>{item.label}</strong>
                            {item.notes && <small>{item.notes}</small>}
                          </li>
                        ))}
                      </ul>
                      {pending ? (
                        <div className="production-ticket__undo" role="status">
                          <span>Avanço agendado</span>
                          <button onClick={() => undo(ticket.id)} type="button">
                            Desfazer
                          </button>
                        </div>
                      ) : (
                        <button
                          className="production-ticket__action"
                          disabled={deviceState === "offline" || busyId === ticket.id}
                          onClick={() => schedule(ticket)}
                          type="button"
                        >
                          {busyId === ticket.id
                            ? "Confirmando…"
                            : status === "pending"
                              ? "Iniciar preparo"
                              : status === "preparing"
                                ? "Marcar pronto"
                                : "Confirmar retirada"}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
