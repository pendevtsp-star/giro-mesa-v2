import {
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
} from "react";

export type SalonTableStatus = "available" | "occupied" | "reserved" | "attention" | "paying";

export interface SalonMapTable {
  id: string;
  label: string;
  seats: number;
  status: SalonTableStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  areaId: string | null;
  totalCents?: number;
  elapsedMinutes?: number;
  ownerName?: string;
}

export interface SalonMapFilters {
  query: string;
  statuses: SalonTableStatus[];
  allowedAreaIds: string[];
}

const statusLabels: Record<SalonTableStatus, string> = {
  available: "Livre",
  occupied: "Em atendimento",
  reserved: "Reservada",
  attention: "Solicitou ajuda",
  paying: "Em pagamento",
};

const statusOrder: SalonTableStatus[] = [
  "available",
  "occupied",
  "reserved",
  "attention",
  "paying",
];

export function clampMapScale(value: number) {
  return Math.min(1.8, Math.max(0.65, Math.round(value * 20) / 20));
}

export function buildSalonMapModel(tables: readonly SalonMapTable[], filters: SalonMapFilters) {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("pt-BR");
  const statusSet = new Set(filters.statuses);
  const areaSet = new Set(filters.allowedAreaIds);
  const visible = tables.filter(
    (table) =>
      (!normalizedQuery || table.label.toLocaleLowerCase("pt-BR").includes(normalizedQuery)) &&
      (statusSet.size === 0 || statusSet.has(table.status)) &&
      (areaSet.size === 0 || (table.areaId !== null && areaSet.has(table.areaId))),
  );
  const summary = { available: 0, occupied: 0, attention: 0, reserved: 0, paying: 0 };
  for (const table of tables) summary[table.status] += 1;
  return {
    visible,
    summary,
    bounds: {
      width: Math.max(0, ...tables.map((table) => table.x + table.width)),
      height: Math.max(0, ...tables.map((table) => table.y + table.height)),
    },
  };
}

export function moveSalonFocus(
  tables: readonly SalonMapTable[],
  currentId: string,
  direction: "up" | "down" | "left" | "right",
) {
  const current = tables.find((table) => table.id === currentId);
  if (!current) return null;
  const currentX = current.x + current.width / 2;
  const currentY = current.y + current.height / 2;
  const candidates = tables.flatMap((table) => {
    if (table.id === currentId) return [];
    const dx = table.x + table.width / 2 - currentX;
    const dy = table.y + table.height / 2 - currentY;
    const inDirection =
      (direction === "left" && dx < 0) ||
      (direction === "right" && dx > 0) ||
      (direction === "up" && dy < 0) ||
      (direction === "down" && dy > 0);
    if (!inDirection) return [];
    const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    return [{ id: table.id, score: primary + cross * 1.75 }];
  });
  return candidates.sort((left, right) => left.score - right.score)[0]?.id ?? currentId;
}

function formatCents(value: number | undefined) {
  if (value === undefined) return null;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

export function SalonMap({
  tables,
  selectedTableId,
  onSelect,
  details,
  allowedAreaIds = [],
  connectionState = "online",
}: {
  tables: SalonMapTable[];
  selectedTableId: string | null;
  onSelect: (tableId: string) => void;
  details: ReactNode;
  allowedAreaIds?: string[];
  connectionState?: "online" | "offline" | "degraded";
}) {
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<SalonTableStatus[]>([]);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [mode, setMode] = useState<"operate" | "edit">("operate");
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const model = useMemo(
    () => buildSalonMapModel(tables, { query, statuses, allowedAreaIds }),
    [allowedAreaIds, query, statuses, tables],
  );

  function toggleStatus(status: SalonTableStatus) {
    setStatuses((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  }

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  }

  function pan(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.originX + event.clientX - drag.x,
      y: drag.originY + event.clientY - drag.y,
    });
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, tableId: string) {
    const directions = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    } as const;
    const direction = directions[event.key as keyof typeof directions];
    if (!direction) return;
    event.preventDefault();
    const next = moveSalonFocus(model.visible, tableId, direction);
    if (!next) return;
    onSelect(next);
    document.getElementById(`salon-table-${next}`)?.focus();
  }

  return (
    <div className="salon-map-shell">
      <section className="salon-map-workspace" aria-label="Mapa operacional do salão">
        <header className="salon-map-toolbar">
          <div>
            <p className="eyebrow">Operação ao vivo</p>
            <h2>Mapa do salão</h2>
          </div>
          <div className={`salon-connection salon-connection--${connectionState}`} role="status">
            <span aria-hidden="true" />
            {connectionState === "online"
              ? "Sincronizado"
              : connectionState === "offline"
                ? "Modo offline"
                : "Sincronização lenta"}
          </div>
          <label className="salon-search">
            <span className="sr-only">Buscar mesa</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar mesa"
            />
          </label>
          <fieldset className="salon-map-tools">
            <legend className="sr-only">Ferramentas do mapa</legend>
            <button
              type="button"
              onClick={() => setScale((value) => clampMapScale(value - 0.1))}
              aria-label="Diminuir zoom"
            >
              −
            </button>
            <output aria-label="Zoom atual">{Math.round(scale * 100)}%</output>
            <button
              type="button"
              onClick={() => setScale((value) => clampMapScale(value + 0.1))}
              aria-label="Aumentar zoom"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                setScale(1);
                setOffset({ x: 0, y: 0 });
              }}
            >
              Centralizar
            </button>
            <button
              type="button"
              aria-pressed={mode === "edit"}
              onClick={() => setMode((value) => (value === "operate" ? "edit" : "operate"))}
            >
              {mode === "operate" ? "Editar mapa" : "Concluir edição"}
            </button>
          </fieldset>
        </header>

        <fieldset className="salon-status-filters">
          <legend className="sr-only">Filtrar mesas por situação</legend>
          {statusOrder.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={statuses.includes(status)}
              onClick={() => toggleStatus(status)}
            >
              <span className={`salon-status-dot salon-status-dot--${status}`} aria-hidden="true" />
              {statusLabels[status]} <strong>{model.summary[status]}</strong>
            </button>
          ))}
        </fieldset>

        <div
          className="salon-map-viewport"
          onPointerDown={beginPan}
          onPointerMove={pan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          {model.visible.length === 0 ? (
            <div className="salon-map-empty" role="status">
              <strong>Nenhuma mesa neste recorte</strong>
              <span>Limpe a busca ou os filtros para voltar à operação completa.</span>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setStatuses([]);
                }}
              >
                Limpar filtros
              </button>
            </div>
          ) : (
            <div
              className="salon-map-canvas"
              data-mode={mode}
              style={{
                width: Math.max(920, model.bounds.width + 160),
                height: Math.max(620, model.bounds.height + 160),
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              }}
            >
              <span className="salon-map-zone">Salão principal</span>
              {model.visible.map((table) => (
                <button
                  id={`salon-table-${table.id}`}
                  key={table.id}
                  className="salon-map-table"
                  data-status={table.status}
                  aria-label={`${table.label}, ${statusLabels[table.status]}, ${table.seats} lugares`}
                  aria-pressed={selectedTableId === table.id}
                  onClick={() => onSelect(table.id)}
                  onKeyDown={(event) => navigate(event, table.id)}
                  style={{
                    left: table.x,
                    top: table.y,
                    width: table.width,
                    minHeight: table.height,
                  }}
                  type="button"
                >
                  <span className="salon-map-table__top">
                    <strong>{table.label}</strong>
                    <small>{table.seats} lugares</small>
                  </span>
                  <span className="salon-map-table__status">
                    <i aria-hidden="true" />
                    {statusLabels[table.status]}
                  </span>
                  {(table.totalCents !== undefined || table.elapsedMinutes !== undefined) && (
                    <span className="salon-map-table__meta">
                      {formatCents(table.totalCents)}
                      {table.elapsedMinutes !== undefined ? `${table.elapsedMinutes} min` : null}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <footer className="salon-map-hint">
          Arraste o fundo para mover · use as setas entre mesas · selecione para agir
        </footer>
      </section>
      <aside className="salon-detail-panel" aria-label="Detalhes da mesa selecionada">
        {details}
      </aside>
    </div>
  );
}
