import { Badge, Button, Card, EmptyState } from "@giromesa/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ProfileId } from "./domain";
import { type PilotDispatcher, type PilotLoader, pilotMutation } from "./operational-dispatch";
import { formatMoney } from "./rules";
import { SalonMap, type SalonMapTable, type SalonTableStatus } from "./salon-map";

export interface PilotScope {
  organizationId: string;
  unitId: string;
  membershipId: string;
  profileId: ProfileId;
  refreshToken: number;
  dispatch: PilotDispatcher;
  load: PilotLoader;
}

type Row = Record<string, unknown>;
type RemoteState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

interface CatalogProduct {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  active: boolean;
  priceCents: number | null;
  available: boolean;
  modifierGroupIds: string[];
}

interface ModifierGroup {
  id: string;
  name: string;
  minimumSelections: number;
  maximumSelections: number;
}

interface ModifierOption {
  id: string;
  groupId: string;
  name: string;
  priceDeltaCents: number;
  active: boolean;
}

export interface PilotCatalog {
  categories: Array<{ id: string; name: string }>;
  products: CatalogProduct[];
  groups: ModifierGroup[];
  options: ModifierOption[];
}

interface FloorTable {
  id: string;
  roomId: string;
  label: string;
  seats: number;
  status: "available" | "occupied" | "reserved";
  active: boolean;
}

interface PosTab {
  id: string;
  tableId: string | null;
  label: string | null;
  guestCount: number;
  status: string;
  serviceChargeBasisPoints: number;
  tipCents: number;
  subtotalCents: number;
  discountCents: number;
  serviceChargeCents: number;
  totalCents: number;
}

export interface PilotFloor {
  rooms: Array<{ id: string; name: string; active: boolean }>;
  tables: FloorTable[];
  openTabs: PosTab[];
}

interface OperationalSalonMap {
  state: "empty" | "ready";
  allowedAreaIds: string[];
  nodes: Array<{
    tableId: string;
    areaId: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  occupancies: Array<{
    tableId: string;
    state: "reserved" | "open" | "paying";
  }>;
}

interface PosOrder {
  id: string;
  status: string;
  createdAt: string | null;
}

interface PosItem {
  id: string;
  orderId: string;
  productName: string;
  quantity: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  status: string;
  notes: string | null;
}

interface TabDetail {
  tab: PosTab;
  orders: PosOrder[];
  items: PosItem[];
}

interface KdsTicket {
  id: string;
  orderId: string;
  stationId: string;
  status: "pending" | "preparing" | "ready" | "done" | "canceled";
  createdAt: string | null;
}

export interface KdsData {
  tickets: KdsTicket[];
  items: Array<{ ticketId: string; item: PosItem }>;
}

export class InvalidPilotPayloadError extends Error {
  constructor() {
    super("A API retornou dados operacionais em formato inesperado.");
    this.name = "InvalidPilotPayloadError";
  }
}

function record(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidPilotPayloadError();
  }
  return value as Row;
}

function records(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new InvalidPilotPayloadError();
  return value.map(record);
}

function texts(value: unknown): string[] {
  if (!Array.isArray(value)) throw new InvalidPilotPayloadError();
  return value.map(text);
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidPilotPayloadError();
  return value;
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return text(value);
}

function number(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new InvalidPilotPayloadError();
  return parsed;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InvalidPilotPayloadError();
  return value;
}

function parseTab(row: Row): PosTab {
  return {
    id: text(row.id),
    tableId: optionalText(row.tableId),
    label: optionalText(row.label),
    guestCount: number(row.guestCount),
    status: text(row.status),
    serviceChargeBasisPoints: number(row.serviceChargeBasisPoints),
    tipCents: number(row.tipCents),
    subtotalCents: number(row.subtotalCents),
    discountCents: number(row.discountCents),
    serviceChargeCents: number(row.serviceChargeCents),
    totalCents: number(row.totalCents),
  };
}

function parseItem(row: Row): PosItem {
  return {
    id: text(row.id),
    orderId: text(row.orderId),
    productName: text(row.productName),
    quantity: number(row.quantity),
    grossCents: number(row.grossCents),
    discountCents: number(row.discountCents),
    netCents: number(row.netCents),
    status: text(row.status),
    notes: optionalText(row.notes),
  };
}

export function parsePilotCatalog(value: unknown): PilotCatalog {
  const payload = record(value);
  const prices = new Map(
    records(payload.prices).map((row) => [text(row.productId), number(row.priceCents)]),
  );
  const availability = new Map(
    records(payload.availability).map((row) => [text(row.productId), bool(row.available)]),
  );
  const links = records(payload.productModifierGroups);
  return {
    categories: records(payload.categories).map((row) => ({
      id: text(row.id),
      name: text(row.name),
    })),
    products: records(payload.products).map((row) => ({
      id: text(row.id),
      categoryId: text(row.categoryId),
      name: text(row.name),
      description: optionalText(row.description),
      active: bool(row.active),
      priceCents: prices.get(text(row.id)) ?? null,
      available: availability.get(text(row.id)) ?? false,
      modifierGroupIds: links
        .filter((link) => text(link.productId) === text(row.id))
        .map((link) => text(link.groupId)),
    })),
    groups: records(payload.modifierGroups).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      minimumSelections: number(row.minimumSelections),
      maximumSelections: number(row.maximumSelections),
    })),
    options: records(payload.modifierOptions).map((row) => ({
      id: text(row.id),
      groupId: text(row.groupId),
      name: text(row.name),
      priceDeltaCents: number(row.priceDeltaCents),
      active: bool(row.active),
    })),
  };
}

export function parsePilotFloor(value: unknown): PilotFloor {
  const payload = record(value);
  return {
    rooms: records(payload.rooms).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      active: bool(row.active),
    })),
    tables: records(payload.tables).map((row) => {
      const status = text(row.status);
      if (!["available", "occupied", "reserved"].includes(status)) {
        throw new InvalidPilotPayloadError();
      }
      return {
        id: text(row.id),
        roomId: text(row.roomId),
        label: text(row.label),
        seats: number(row.seats),
        status: status as FloorTable["status"],
        active: bool(row.active),
      };
    }),
    openTabs: records(payload.openTabs).map(parseTab),
  };
}

export function parseOperationalSalonMap(value: unknown): OperationalSalonMap {
  const payload = record(value);
  const state = text(payload.state);
  if (!(["empty", "ready"] as string[]).includes(state)) throw new InvalidPilotPayloadError();
  return {
    state: state as OperationalSalonMap["state"],
    allowedAreaIds: texts(payload.allowedAreaIds ?? []),
    nodes: records(payload.nodes).map((row) => ({
      tableId: text(row.tableId),
      areaId: optionalText(row.areaId),
      x: number(row.x),
      y: number(row.y),
      width: number(row.width),
      height: number(row.height),
    })),
    occupancies: records(payload.occupancies).map((row) => {
      const occupancyState = text(row.state);
      if (!(["reserved", "open", "paying"] as string[]).includes(occupancyState)) {
        throw new InvalidPilotPayloadError();
      }
      return {
        tableId: text(row.tableId),
        state: occupancyState as OperationalSalonMap["occupancies"][number]["state"],
      };
    }),
  };
}

export function parseTabs(value: unknown): PosTab[] {
  return records(value).map(parseTab);
}

export function parseTabDetail(value: unknown): TabDetail {
  const payload = record(value);
  return {
    tab: parseTab(record(payload.tab)),
    orders: records(payload.orders).map((row) => ({
      id: text(row.id),
      status: text(row.status),
      createdAt: optionalText(row.createdAt),
    })),
    items: records(payload.items).map(parseItem),
  };
}

export function parseKds(value: unknown): KdsData {
  const payload = record(value);
  return {
    tickets: records(payload.tickets).map((row) => {
      const status = text(row.status);
      if (!["pending", "preparing", "ready", "done", "canceled"].includes(status)) {
        throw new InvalidPilotPayloadError();
      }
      return {
        id: text(row.id),
        orderId: text(row.orderId),
        stationId: text(row.stationId),
        status: status as KdsTicket["status"],
        createdAt: optionalText(row.createdAt),
      };
    }),
    items: records(payload.items).map((row) => ({
      ticketId: text(row.ticketId),
      item: parseItem(record(row.item)),
    })),
  };
}

function useRemote<T>(
  scope: PilotScope,
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
    void scope.load;
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
            message:
              error instanceof Error ? error.message : "Não foi possível carregar a operação.",
          }),
      );
    return () => {
      active = false;
    };
  }, [retryToken, scope.load, scope.organizationId, scope.refreshToken, scope.unitId]);
  return { state, retry: () => setRetryToken((value) => value + 1) };
}

function RemoteGate<T>({
  remote,
  children,
}: {
  remote: ReturnType<typeof useRemote<T>>;
  children: (data: T) => React.ReactNode;
}) {
  if (remote.state.status === "loading") {
    return (
      <Card className="remote-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Carregando operação…</strong>
        <p>Sincronizando o estado atual da unidade.</p>
      </Card>
    );
  }
  if (remote.state.status === "error") {
    return (
      <Card className="remote-state" role="alert">
        <strong>Não foi possível carregar esta área</strong>
        <p>{remote.state.message}</p>
        <Button onClick={remote.retry} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      </Card>
    );
  }
  return children(remote.state.data);
}

function statusTone(status: string): "success" | "warning" | "neutral" | "danger" {
  if (["available", "ready", "done", "served"].includes(status)) return "success";
  if (["reserved", "preparing", "pending", "draft"].includes(status)) return "warning";
  if (["canceled", "blocked"].includes(status)) return "danger";
  return "neutral";
}

export function RealCatalogPage({ scope }: { scope: PilotScope }) {
  const remote = useRemote(
    scope,
    () =>
      scope.load("catalog", undefined, () => api.pilot.catalog(scope.organizationId, scope.unitId)),
    parsePilotCatalog,
  );
  return (
    <RemoteGate remote={remote}>
      {(catalog) =>
        catalog.products.length === 0 ? (
          <EmptyState
            icon="▦"
            title="Catálogo ainda não configurado"
            description="Cadastre produtos, preços e disponibilidade antes de lançar pedidos reais."
          />
        ) : (
          <div className="ops-grid ops-grid--catalog">
            {catalog.categories.map((category) => {
              const items = catalog.products.filter(
                (product) => product.categoryId === category.id && product.active,
              );
              if (items.length === 0) return null;
              return (
                <Card key={category.id}>
                  <div className="section-title">
                    <div>
                      <p className="eyebrow">Categoria</p>
                      <h2>{category.name}</h2>
                    </div>
                    <Badge tone="neutral">{items.length}</Badge>
                  </div>
                  <div className="data-list">
                    {items.map((product) => (
                      <article className="data-row" key={product.id}>
                        <div>
                          <strong>{product.name}</strong>
                          <small>{product.description ?? "Sem descrição"}</small>
                        </div>
                        <div className="data-row__end">
                          <strong>
                            {product.priceCents === null
                              ? "Sem preço"
                              : formatMoney(product.priceCents)}
                          </strong>
                          <Badge tone={product.available ? "success" : "danger"}>
                            {product.available ? "Disponível" : "Indisponível"}
                          </Badge>
                        </div>
                      </article>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      }
    </RemoteGate>
  );
}

export function RealSalonPage({ scope }: { scope: PilotScope }) {
  const floor = useRemote(
    scope,
    () => scope.load("floor", undefined, () => api.pilot.floor(scope.organizationId, scope.unitId)),
    parsePilotFloor,
  );
  return (
    <RemoteGate remote={floor}>
      {(data) => <RealSalonWorkspace data={data} floorRetry={floor.retry} scope={scope} />}
    </RemoteGate>
  );
}

function RealSalonWorkspace({
  scope,
  data,
  floorRetry,
}: {
  scope: PilotScope;
  data: PilotFloor;
  floorRetry: () => void;
}) {
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const activeRoom = data.rooms.find((room) => room.active) ?? null;
  const operationalMap = useRemote(
    scope,
    () =>
      activeRoom
        ? scope.load("floor", activeRoom.id, () =>
            api.salon.map(scope.organizationId, scope.unitId, activeRoom.id),
          )
        : Promise.resolve({ state: "empty", allowedAreaIds: [], nodes: [], occupancies: [] }),
    parseOperationalSalonMap,
  );
  return (
    <RemoteGate remote={operationalMap}>
      {(map) => {
        const table = data.tables.find((item) => item.id === selectedTableId) ?? null;
        const tab = table
          ? (data.openTabs.find((item) => item.tableId === table.id) ?? null)
          : null;
        const nodeByTable = new Map(map.nodes.map((node) => [node.tableId, node]));
        const occupancyByTable = new Map(
          map.occupancies.map((occupancy) => [occupancy.tableId, occupancy]),
        );
        const activeTables = data.tables.filter(
          (item) => item.active && (!activeRoom || item.roomId === activeRoom.id),
        );
        const mapTables: SalonMapTable[] = activeTables.map((item, index) => {
          const node = nodeByTable.get(item.id);
          const occupancy = occupancyByTable.get(item.id);
          const openTab = data.openTabs.find((candidate) => candidate.tableId === item.id);
          const status: SalonTableStatus =
            occupancy?.state === "paying"
              ? "paying"
              : occupancy?.state === "open"
                ? "occupied"
                : occupancy?.state === "reserved"
                  ? "reserved"
                  : item.status;
          return {
            id: item.id,
            label: item.label,
            seats: item.seats,
            status,
            x: node?.x ?? 80 + (index % 4) * 220,
            y: node?.y ?? 90 + Math.floor(index / 4) * 175,
            width: node?.width ?? 170,
            height: node?.height ?? 126,
            areaId: node?.areaId ?? null,
            totalCents: openTab?.totalCents,
          };
        });
        async function openTab() {
          if (!table) return;
          setBusy(true);
          setFeedback("");
          try {
            const body = {
              tableId: table.id,
              guestCount: guests,
            };
            await scope.dispatch(
              "pos.tab.open_requested",
              pilotMutation("open-tab", { body }),
              (key) => api.pilot.openTab(scope.organizationId, scope.unitId, body, key),
            );
            floorRetry();
            operationalMap.retry();
          } catch (error) {
            setFeedback(
              error instanceof Error ? error.message : "Não foi possível abrir a comanda.",
            );
          } finally {
            setBusy(false);
          }
        }
        return (
          <SalonMap
            allowedAreaIds={map.allowedAreaIds}
            connectionState={
              typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online"
            }
            onSelect={setSelectedTableId}
            selectedTableId={selectedTableId}
            tables={mapTables}
            details={
              !table ? (
                <EmptyState
                  icon="◫"
                  title="Selecione uma mesa"
                  description="Abra ou acompanhe a comanda sem sair do mapa."
                />
              ) : tab ? (
                <TabWorkspace
                  key={tab.id}
                  scope={scope}
                  tabId={tab.id}
                  floor={data}
                  onChanged={() => {
                    floorRetry();
                    operationalMap.retry();
                  }}
                />
              ) : (
                <Card>
                  <p className="eyebrow">{table.label}</p>
                  <h2>Abrir comanda</h2>
                  <p className="muted">A mesa está disponível para um novo atendimento.</p>
                  <label className="compact-field">
                    Pessoas
                    <input
                      min={1}
                      max={500}
                      onChange={(event) => setGuests(Number(event.target.value))}
                      type="number"
                      value={guests}
                    />
                  </label>
                  {feedback && (
                    <p className="field-error" role="alert">
                      {feedback}
                    </p>
                  )}
                  <Button disabled={busy || guests < 1} onClick={() => void openTab()}>
                    {busy ? "Abrindo…" : "Abrir comanda"}
                  </Button>
                </Card>
              )}
          />
        );
      }}
    </RemoteGate>
  );
}

export function RealCounterPage({ scope }: { scope: PilotScope }) {
  const tabs = useRemote(
    scope,
    () => scope.load("tabs", undefined, () => api.pilot.tabs(scope.organizationId, scope.unitId)),
    parseTabs,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [guests, setGuests] = useState(1);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  return (
    <RemoteGate remote={tabs}>
      {(allTabs) => {
        const counterTabs = allTabs.filter((tab) => tab.status === "open" && tab.tableId === null);
        async function open(event: FormEvent) {
          event.preventDefault();
          setBusy(true);
          setFeedback("");
          try {
            const body = {
              label: label.trim() || undefined,
              guestCount: guests,
            };
            const value = record(
              await scope.dispatch(
                "pos.tab.open_requested",
                pilotMutation("open-tab", { body }),
                (key) => api.pilot.openTab(scope.organizationId, scope.unitId, body, key),
              ),
            );
            const tab = parseTab(record(value.tab));
            setSelected(tab.id);
            setLabel("");
            tabs.retry();
          } catch (error) {
            setFeedback(
              error instanceof Error ? error.message : "Não foi possível abrir a comanda.",
            );
          } finally {
            setBusy(false);
          }
        }
        return (
          <div className="ops-layout">
            <section className="ops-board">
              <Card>
                <p className="eyebrow">Balcão e retirada</p>
                <h2>Nova comanda rápida</h2>
                <form className="inline-form" onSubmit={(event) => void open(event)}>
                  <label>
                    Identificação
                    <input
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder="Ex.: Retirada 42"
                      value={label}
                    />
                  </label>
                  <label>
                    Pessoas
                    <input
                      min={1}
                      onChange={(event) => setGuests(Number(event.target.value))}
                      type="number"
                      value={guests}
                    />
                  </label>
                  <Button disabled={busy || guests < 1} type="submit">
                    {busy ? "Abrindo…" : "Abrir comanda"}
                  </Button>
                </form>
                {feedback && (
                  <p className="field-error" role="alert">
                    {feedback}
                  </p>
                )}
              </Card>
              <div className="data-list ops-tab-list">
                {counterTabs.map((tab) => (
                  <button
                    className={selected === tab.id ? "data-row data-row--selected" : "data-row"}
                    key={tab.id}
                    onClick={() => setSelected(tab.id)}
                    type="button"
                  >
                    <div>
                      <strong>{tab.label ?? `Comanda ${tab.id.slice(0, 6)}`}</strong>
                      <small>{tab.guestCount} pessoa(s)</small>
                    </div>
                    <strong>{formatMoney(tab.totalCents)}</strong>
                  </button>
                ))}
              </div>
            </section>
            <aside className="ops-panel">
              {selected ? (
                <TabWorkspace
                  key={selected}
                  scope={scope}
                  tabId={selected}
                  onChanged={tabs.retry}
                />
              ) : (
                <EmptyState
                  icon="＋"
                  title="Selecione uma comanda"
                  description="Escolha uma comanda aberta ou crie uma nova."
                />
              )}
            </aside>
          </div>
        );
      }}
    </RemoteGate>
  );
}

type DraftCartItem = {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  modifierOptionIds: string[];
  notes?: string;
};

function TabWorkspace({
  scope,
  tabId,
  floor,
  onChanged,
}: {
  scope: PilotScope;
  tabId: string;
  floor?: PilotFloor;
  onChanged: () => void;
}) {
  const detail = useRemote(
    scope,
    () => scope.load("tab", tabId, () => api.pilot.tab(scope.organizationId, scope.unitId, tabId)),
    parseTabDetail,
  );
  const catalog = useRemote(
    scope,
    () =>
      scope.load("catalog", undefined, () => api.pilot.catalog(scope.organizationId, scope.unitId)),
    parsePilotCatalog,
  );
  const tabs = useRemote(
    scope,
    () => scope.load("tabs", undefined, () => api.pilot.tabs(scope.organizationId, scope.unitId)),
    parseTabs,
  );
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [cart, setCart] = useState<DraftCartItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [transferTableId, setTransferTableId] = useState("");
  const [mergeTabId, setMergeTabId] = useState("");
  const [splitItemId, setSplitItemId] = useState("");
  const [splitQuantity, setSplitQuantity] = useState(1);
  const [servicePercent, setServicePercent] = useState(10);
  const [tipReais, setTipReais] = useState(0);
  const [approvalItemId, setApprovalItemId] = useState("");
  const [approvalPin, setApprovalPin] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [discountReais, setDiscountReais] = useState(0);

  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setFeedback("");
    try {
      await action();
      setFeedback(success);
      detail.retry();
      tabs.retry();
      onChanged();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "A ação não foi confirmada pelo servidor.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <RemoteGate remote={detail}>
      {(data) => (
        <RemoteGate remote={catalog}>
          {(menu) => {
            const product = menu.products.find((item) => item.id === productId);
            const productGroups = product
              ? menu.groups.filter((group) => product.modifierGroupIds.includes(group.id))
              : [];
            const activeItems = data.items.filter((item) => item.status !== "canceled");
            const availableTables =
              floor?.tables.filter((table) => table.active && table.status === "available") ?? [];
            const mergeTargets =
              tabs.state.status === "ready"
                ? tabs.state.data.filter((tab) => tab.status === "open" && tab.id !== tabId)
                : [];
            function addItem() {
              if (!product || product.priceCents === null || !product.available || quantity < 1)
                return;
              setCart((value) => [
                ...value,
                {
                  id: crypto.randomUUID(),
                  productId: product.id,
                  name: product.name,
                  quantity,
                  modifierOptionIds: options,
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                },
              ]);
              setQuantity(1);
              setNotes("");
              setOptions([]);
            }
            return (
              <div className="tab-workspace">
                <div className="section-title">
                  <div>
                    <p className="eyebrow">Comanda aberta</p>
                    <h2>{data.tab.label ?? `Comanda ${data.tab.id.slice(0, 6)}`}</h2>
                  </div>
                  <strong>{formatMoney(data.tab.totalCents)}</strong>
                </div>
                <div className="totals-strip">
                  <span>
                    Subtotal <strong>{formatMoney(data.tab.subtotalCents)}</strong>
                  </span>
                  <span>
                    Descontos <strong>{formatMoney(data.tab.discountCents)}</strong>
                  </span>
                  <span>
                    Serviço <strong>{formatMoney(data.tab.serviceChargeCents)}</strong>
                  </span>
                  <span>
                    Gorjeta <strong>{formatMoney(data.tab.tipCents)}</strong>
                  </span>
                </div>
                {feedback && (
                  <p
                    className={
                      feedback.includes("Não") || feedback.includes("Falha")
                        ? "field-error"
                        : "success-message"
                    }
                    role="status"
                  >
                    {feedback}
                  </p>
                )}
                <Card className="order-composer">
                  <h3>Adicionar itens</h3>
                  <label className="compact-field">
                    Produto
                    <select
                      onChange={(event) => {
                        setProductId(event.target.value);
                        setOptions([]);
                      }}
                      value={productId}
                    >
                      <option value="">Selecione</option>
                      {menu.products
                        .filter((item) => item.active)
                        .map((item) => (
                          <option
                            disabled={!item.available || item.priceCents === null}
                            key={item.id}
                            value={item.id}
                          >
                            {item.name}
                            {!item.available
                              ? " — indisponível"
                              : item.priceCents === null
                                ? " — sem preço"
                                : ` — ${formatMoney(item.priceCents)}`}
                          </option>
                        ))}
                    </select>
                  </label>
                  {productGroups.map((group) => (
                    <fieldset className="modifier-group" key={group.id}>
                      <legend>
                        {group.name}{" "}
                        <small>
                          {group.minimumSelections}–{group.maximumSelections}
                        </small>
                      </legend>
                      {menu.options
                        .filter((option) => option.groupId === group.id && option.active)
                        .map((option) => (
                          <label key={option.id}>
                            <input
                              checked={options.includes(option.id)}
                              onChange={(event) =>
                                setOptions((current) =>
                                  event.target.checked
                                    ? [...current, option.id]
                                    : current.filter((id) => id !== option.id),
                                )
                              }
                              type="checkbox"
                            />
                            {option.name}{" "}
                            {option.priceDeltaCents > 0 && (
                              <small>+ {formatMoney(option.priceDeltaCents)}</small>
                            )}
                          </label>
                        ))}
                    </fieldset>
                  ))}
                  <div className="inline-form">
                    <label>
                      Quantidade
                      <input
                        min={1}
                        onChange={(event) => setQuantity(Number(event.target.value))}
                        type="number"
                        value={quantity}
                      />
                    </label>
                    <label className="inline-form__wide">
                      Observação
                      <input
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Ex.: sem cebola"
                        value={notes}
                      />
                    </label>
                    <Button
                      disabled={!product || quantity < 1}
                      onClick={addItem}
                      size="sm"
                      variant="secondary"
                    >
                      Adicionar
                    </Button>
                  </div>
                  {cart.length > 0 && (
                    <div className="cart-preview">
                      {cart.map((item) => (
                        <div key={item.id}>
                          <span>
                            {item.quantity}× {item.name}
                          </span>
                          <button
                            aria-label={`Remover ${item.name}`}
                            onClick={() =>
                              setCart((current) =>
                                current.filter((candidate) => candidate.id !== item.id),
                              )
                            }
                            type="button"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void mutate(() => {
                            const body = {
                              items: cart.map(({ id: _id, name: _name, ...item }) => item),
                            };
                            return scope.dispatch(
                              "pos.order.create_requested",
                              pilotMutation("create-order", { tabId, body }),
                              (key) =>
                                api.pilot.createOrder(
                                  scope.organizationId,
                                  scope.unitId,
                                  tabId,
                                  body,
                                  key,
                                ),
                            );
                          }, "Pedido salvo como rascunho.").then(() => setCart([]))
                        }
                      >
                        Salvar pedido
                      </Button>
                    </div>
                  )}
                </Card>
                <div className="data-list">
                  {data.orders.map((order) => (
                    <article className="data-row" key={order.id}>
                      <div>
                        <strong>Pedido {order.id.slice(0, 6)}</strong>
                        <small>
                          {data.items
                            .filter((item) => item.orderId === order.id)
                            .map((item) => `${item.quantity}× ${item.productName}`)
                            .join(" · ") || "Sem itens"}
                        </small>
                      </div>
                      <div className="data-row__end">
                        <Badge tone={statusTone(order.status)}>{order.status}</Badge>
                        {order.status === "draft" && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                () =>
                                  scope.dispatch(
                                    "pos.order.send_requested",
                                    pilotMutation("send-order", { orderId: order.id }),
                                    (key) =>
                                      api.pilot.sendOrder(
                                        scope.organizationId,
                                        scope.unitId,
                                        order.id,
                                        key,
                                      ),
                                  ),
                                "Pedido enviado à produção.",
                              )
                            }
                            size="sm"
                          >
                            Enviar
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                <details className="ops-actions">
                  <summary>Ajustes e ações supervisionadas</summary>
                  <div className="action-grid">
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (transferTableId)
                          void mutate(
                            () =>
                              scope.dispatch(
                                "pos.tab.transfer_requested",
                                pilotMutation("transfer-tab", {
                                  tabId,
                                  body: {
                                    tableId: transferTableId,
                                    reason: "Transferência solicitada na operação",
                                  },
                                }),
                                (key) =>
                                  api.pilot.transferTab(
                                    scope.organizationId,
                                    scope.unitId,
                                    tabId,
                                    {
                                      tableId: transferTableId,
                                      reason: "Transferência solicitada na operação",
                                    },
                                    key,
                                  ),
                              ),
                            "Comanda transferida.",
                          );
                      }}
                    >
                      <h3>Transferir mesa</h3>
                      <select
                        onChange={(event) => setTransferTableId(event.target.value)}
                        value={transferTableId}
                      >
                        <option value="">Selecione mesa livre</option>
                        {availableTables.map((table) => (
                          <option key={table.id} value={table.id}>
                            {table.label}
                          </option>
                        ))}
                      </select>
                      <Button disabled={busy || !transferTableId} size="sm" type="submit">
                        Transferir
                      </Button>
                    </form>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (mergeTabId)
                          void mutate(
                            () =>
                              scope.dispatch(
                                "pos.tabs.merge_requested",
                                pilotMutation("merge-tabs", {
                                  body: { targetTabId: tabId, sourceTabIds: [mergeTabId] },
                                }),
                                (key) =>
                                  api.pilot.mergeTabs(
                                    scope.organizationId,
                                    scope.unitId,
                                    { targetTabId: tabId, sourceTabIds: [mergeTabId] },
                                    key,
                                  ),
                              ),
                            "Comandas unificadas.",
                          );
                      }}
                    >
                      <h3>Unificar comandas</h3>
                      <select
                        onChange={(event) => setMergeTabId(event.target.value)}
                        value={mergeTabId}
                      >
                        <option value="">Selecione a origem</option>
                        {mergeTargets.map((tab) => (
                          <option key={tab.id} value={tab.id}>
                            {tab.label ?? tab.id.slice(0, 6)}
                          </option>
                        ))}
                      </select>
                      <Button disabled={busy || !mergeTabId} size="sm" type="submit">
                        Unificar aqui
                      </Button>
                    </form>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (splitItemId)
                          void mutate(
                            () =>
                              scope.dispatch(
                                "pos.tab.split_requested",
                                pilotMutation("split-tab", {
                                  tabId,
                                  body: {
                                    label: "Conta separada",
                                    items: [{ orderItemId: splitItemId, quantity: splitQuantity }],
                                  },
                                }),
                                (key) =>
                                  api.pilot.splitTab(
                                    scope.organizationId,
                                    scope.unitId,
                                    tabId,
                                    {
                                      label: "Conta separada",
                                      items: [
                                        { orderItemId: splitItemId, quantity: splitQuantity },
                                      ],
                                    },
                                    key,
                                  ),
                              ),
                            "Item separado em nova comanda.",
                          );
                      }}
                    >
                      <h3>Separar item</h3>
                      <select
                        onChange={(event) => setSplitItemId(event.target.value)}
                        value={splitItemId}
                      >
                        <option value="">Selecione</option>
                        {activeItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.quantity}× {item.productName}
                          </option>
                        ))}
                      </select>
                      <input
                        min={1}
                        onChange={(event) => setSplitQuantity(Number(event.target.value))}
                        type="number"
                        value={splitQuantity}
                      />
                      <Button disabled={busy || !splitItemId} size="sm" type="submit">
                        Separar
                      </Button>
                    </form>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void mutate(
                          () =>
                            scope.dispatch(
                              "pos.tab.service_charge_requested",
                              pilotMutation("service-charge", {
                                tabId,
                                basisPoints: Math.round(servicePercent * 100),
                              }),
                              (key) =>
                                api.pilot.serviceCharge(
                                  scope.organizationId,
                                  scope.unitId,
                                  tabId,
                                  Math.round(servicePercent * 100),
                                  key,
                                ),
                            ),
                          "Taxa de serviço atualizada.",
                        );
                      }}
                    >
                      <h3>Serviço</h3>
                      <label>
                        Percentual
                        <input
                          max={100}
                          min={0}
                          onChange={(event) => setServicePercent(Number(event.target.value))}
                          step="0.01"
                          type="number"
                          value={servicePercent}
                        />
                      </label>
                      <Button disabled={busy} size="sm" type="submit">
                        Aplicar
                      </Button>
                    </form>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void mutate(
                          () =>
                            scope.dispatch(
                              "pos.tab.tip_requested",
                              pilotMutation("tip", {
                                tabId,
                                tipCents: Math.round(tipReais * 100),
                              }),
                              (key) =>
                                api.pilot.tip(
                                  scope.organizationId,
                                  scope.unitId,
                                  tabId,
                                  Math.round(tipReais * 100),
                                  key,
                                ),
                            ),
                          "Gorjeta atualizada.",
                        );
                      }}
                    >
                      <h3>Gorjeta</h3>
                      <label>
                        Valor em reais
                        <input
                          min={0}
                          onChange={(event) => setTipReais(Number(event.target.value))}
                          step="0.01"
                          type="number"
                          value={tipReais}
                        />
                      </label>
                      <Button disabled={busy} size="sm" type="submit">
                        Aplicar
                      </Button>
                    </form>
                    <form className="approval-form" onSubmit={(event) => event.preventDefault()}>
                      <h3>Desconto ou cancelamento</h3>
                      <p>Exige PIN de gerente e registra aprovação no servidor.</p>
                      <select
                        onChange={(event) => setApprovalItemId(event.target.value)}
                        value={approvalItemId}
                      >
                        <option value="">Selecione o item</option>
                        {activeItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.productName}
                          </option>
                        ))}
                      </select>
                      <label>
                        PIN do aprovador
                        <input
                          inputMode="numeric"
                          maxLength={8}
                          minLength={4}
                          onChange={(event) =>
                            setApprovalPin(event.target.value.replace(/\D/g, ""))
                          }
                          type="password"
                          value={approvalPin}
                        />
                      </label>
                      <label>
                        Motivo
                        <input
                          minLength={3}
                          onChange={(event) => setApprovalReason(event.target.value)}
                          value={approvalReason}
                        />
                      </label>
                      <label>
                        Desconto em reais
                        <input
                          min={0}
                          onChange={(event) => setDiscountReais(Number(event.target.value))}
                          step="0.01"
                          type="number"
                          value={discountReais}
                        />
                      </label>
                      <div className="dialog-actions">
                        <Button
                          disabled={
                            busy ||
                            !approvalItemId ||
                            approvalPin.length < 4 ||
                            approvalReason.trim().length < 3 ||
                            discountReais <= 0
                          }
                          onClick={() =>
                            void mutate(
                              () =>
                                scope.dispatch(
                                  "pos.item.discount_requested",
                                  pilotMutation("discount-item", {
                                    itemId: approvalItemId,
                                    body: {
                                      discountCents: Math.round(discountReais * 100),
                                      approval: {
                                        approverMembershipId: scope.membershipId,
                                        pin: approvalPin,
                                        reason: approvalReason.trim(),
                                      },
                                    },
                                  }),
                                  (key) =>
                                    api.pilot.discountItem(
                                      scope.organizationId,
                                      scope.unitId,
                                      approvalItemId,
                                      {
                                        discountCents: Math.round(discountReais * 100),
                                        approval: {
                                          approverMembershipId: scope.membershipId,
                                          pin: approvalPin,
                                          reason: approvalReason.trim(),
                                        },
                                      },
                                      key,
                                    ),
                                ),
                              "Desconto aprovado e aplicado.",
                            )
                          }
                          size="sm"
                          variant="secondary"
                        >
                          Aplicar desconto
                        </Button>
                        <Button
                          disabled={
                            busy ||
                            !approvalItemId ||
                            approvalPin.length < 4 ||
                            approvalReason.trim().length < 3
                          }
                          onClick={() =>
                            void mutate(
                              () =>
                                scope.dispatch(
                                  "pos.item.cancel_requested",
                                  pilotMutation("cancel-item", {
                                    itemId: approvalItemId,
                                    approval: {
                                      approverMembershipId: scope.membershipId,
                                      pin: approvalPin,
                                      reason: approvalReason.trim(),
                                    },
                                  }),
                                  (key) =>
                                    api.pilot.cancelItem(
                                      scope.organizationId,
                                      scope.unitId,
                                      approvalItemId,
                                      {
                                        approverMembershipId: scope.membershipId,
                                        pin: approvalPin,
                                        reason: approvalReason.trim(),
                                      },
                                      key,
                                    ),
                                ),
                              "Item cancelado com aprovação.",
                            )
                          }
                          size="sm"
                          variant="danger"
                        >
                          Cancelar item
                        </Button>
                      </div>
                    </form>
                  </div>
                </details>
              </div>
            );
          }}
        </RemoteGate>
      )}
    </RemoteGate>
  );
}

const nextKdsState: Record<
  KdsTicket["status"],
  "preparing" | "ready" | "done" | "canceled" | null
> = {
  pending: "preparing",
  preparing: "ready",
  ready: "done",
  done: null,
  canceled: null,
};

const kdsActionLabel: Partial<Record<KdsTicket["status"], string>> = {
  pending: "Iniciar preparo",
  preparing: "Marcar pronto",
  ready: "Concluir retirada",
};

export function RealKdsPage({ scope }: { scope: PilotScope }) {
  const remote = useRemote(
    scope,
    () => scope.load("kds", undefined, () => api.pilot.kds(scope.organizationId, scope.unitId)),
    parseKds,
  );
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState("");
  return (
    <RemoteGate remote={remote}>
      {(data) => {
        const activeTickets = data.tickets.filter(
          (ticket) => !["done", "canceled"].includes(ticket.status),
        );
        if (activeTickets.length === 0)
          return (
            <EmptyState
              icon="✓"
              title="Produção em dia"
              description="Nenhum ticket ativo foi retornado pelo servidor."
            />
          );
        return (
          <div>
            <div className="kds-summary">
              <Badge tone="warning">
                {activeTickets.filter((ticket) => ticket.status === "pending").length} aguardando
              </Badge>
              <Badge tone="info">
                {activeTickets.filter((ticket) => ticket.status === "preparing").length} em preparo
              </Badge>
              <Badge tone="success">
                {activeTickets.filter((ticket) => ticket.status === "ready").length} prontos
              </Badge>
            </div>
            {feedback && (
              <p className="field-error" role="status">
                {feedback}
              </p>
            )}
            <div className="real-kds-grid">
              {activeTickets.map((ticket) => {
                const items = data.items.filter((row) => row.ticketId === ticket.id);
                const next = nextKdsState[ticket.status];
                return (
                  <Card className={`real-kds-card real-kds-card--${ticket.status}`} key={ticket.id}>
                    <div className="section-title">
                      <strong>Ticket {ticket.id.slice(0, 6)}</strong>
                      <Badge tone={statusTone(ticket.status)}>{ticket.status}</Badge>
                    </div>
                    <small>Estação {ticket.stationId.slice(0, 6)}</small>
                    <ul>
                      {items.map(({ item }) => (
                        <li key={item.id}>
                          <strong>{item.quantity}×</strong> {item.productName}
                          {item.notes && <small>{item.notes}</small>}
                        </li>
                      ))}
                    </ul>
                    {next && (
                      <Button
                        disabled={busyId === ticket.id}
                        onClick={async () => {
                          setBusyId(ticket.id);
                          setFeedback("");
                          try {
                            await scope.dispatch(
                              "pos.kds.transition_requested",
                              pilotMutation("transition-kds", {
                                ticketId: ticket.id,
                                state: next,
                              }),
                              (key) =>
                                api.pilot.transitionKds(
                                  scope.organizationId,
                                  scope.unitId,
                                  ticket.id,
                                  next,
                                  key,
                                ),
                            );
                            remote.retry();
                          } catch (error) {
                            setFeedback(
                              error instanceof Error
                                ? error.message
                                : "A transição não foi confirmada.",
                            );
                          } finally {
                            setBusyId("");
                          }
                        }}
                      >
                        {busyId === ticket.id ? "Confirmando…" : kdsActionLabel[ticket.status]}
                      </Button>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        );
      }}
    </RemoteGate>
  );
}
