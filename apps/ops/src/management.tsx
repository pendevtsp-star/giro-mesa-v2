import { Badge, Button, Card, EmptyState, Icon } from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { ProfileId } from "./domain";
import { formatMoney } from "./rules";
import { UiIcon } from "./ui-icon";

export interface ManagementScope {
  organizationId: string;
  unitId: string;
  profileId: ProfileId;
  refreshToken?: number;
}

type Row = Record<string, unknown>;

interface InventoryItem {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  minimumQuantity: number;
  active: boolean;
}

interface StockLocation {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

interface StockBalance {
  inventoryItemId: string;
  quantity: number;
  averageCostCents: number | null;
}

interface InventoryData {
  locations: StockLocation[];
  items: InventoryItem[];
  balances: StockBalance[];
}

interface RecipeProduct {
  id: string;
  name: string;
  active: boolean;
}

interface RecipeCatalog {
  products: RecipeProduct[];
}

interface RecipeComponent {
  inventoryItemId: string;
  locationId: string;
  quantityMilli: number;
  lossBasisPoints: number;
}

interface RecipeVersion {
  id: string;
  productId: string;
  version: number;
  validFrom: string;
  validUntil: string | null;
  components: RecipeComponent[];
}

interface PurchaseOrder {
  id: string;
  status: string;
  totalCents: number;
  expectedAt: string | null;
  createdAt: string | null;
}

interface PurchasesData {
  orders: PurchaseOrder[];
  receipts: Row[];
}

interface FinancialEntry {
  id: string;
  description: string;
  status: string;
  amountCents: number;
  settledCents: number;
  dueDate: string;
  direction: "payable" | "receivable";
}

interface FinanceData {
  entries: FinancialEntry[];
  reconciliationImports: Row[];
  reconciliationEntries: Row[];
}

interface CashShift {
  id: string;
  status: string;
  openingCents: number;
  expectedCents: number | null;
  countedCents: number | null;
  differenceCents: number | null;
  openedAt: string | null;
  closedAt: string | null;
}

interface CashData {
  shifts: CashShift[];
  movements: Row[];
}

interface Person {
  id: string;
  name: string;
  roleLabel: string;
  active: boolean;
  hourlyRateCents: number | null;
}

interface TimeEntry {
  id: string;
  personId: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  source: string;
}

interface PeopleData {
  people: Person[];
  schedules: Row[];
  timeEntries: TimeEntry[];
}

interface OverviewMetric {
  label: string;
  value: string;
  detail: string;
  href?: string;
}

interface OverviewData {
  metrics: OverviewMetric[];
}

type RemoteState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export class InvalidManagementPayloadError extends Error {
  constructor() {
    super("A API retornou dados gerenciais em formato inesperado.");
    this.name = "InvalidManagementPayloadError";
  }
}

function record(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidManagementPayloadError();
  }
  return value as Row;
}

function rows(value: Row, key: string): Row[] {
  const list = value[key];
  if (!Array.isArray(list)) throw new InvalidManagementPayloadError();
  return list.map(record);
}

function records(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new InvalidManagementPayloadError();
  return value.map(record);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new InvalidManagementPayloadError();
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}

function numeric(value: unknown, nullable = false): number | null {
  if (nullable && (value === null || value === undefined)) return null;
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new InvalidManagementPayloadError();
  return parsed;
}

function integer(value: unknown): number {
  const parsed = numeric(value);
  if (parsed === null || !Number.isInteger(parsed)) throw new InvalidManagementPayloadError();
  return parsed;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InvalidManagementPayloadError();
  return value;
}

export function parseInventory(value: unknown): InventoryData {
  const payload = record(value);
  return {
    locations: rows(payload, "locations").map((location) => ({
      id: requiredString(location.id),
      name: requiredString(location.name),
      code: requiredString(location.code),
      active: boolean(location.active),
    })),
    items: rows(payload, "items").map((item) => ({
      id: requiredString(item.id),
      name: requiredString(item.name),
      sku: optionalString(item.sku),
      unit: requiredString(item.unit),
      minimumQuantity: numeric(item.minimumQuantity) ?? 0,
      active: boolean(item.active),
    })),
    balances: rows(payload, "balances").map((balance) => ({
      inventoryItemId: requiredString(balance.inventoryItemId),
      quantity: numeric(balance.quantity) ?? 0,
      averageCostCents: numeric(balance.averageCostCents, true),
    })),
  };
}

export function parseRecipeCatalog(value: unknown): RecipeCatalog {
  const payload = record(value);
  return {
    products: rows(payload, "products").map((product) => ({
      id: requiredString(product.id),
      name: requiredString(product.name),
      active: boolean(product.active),
    })),
  };
}

export function parseRecipes(value: unknown): RecipeVersion[] {
  return records(value).map((recipe) => ({
    id: requiredString(recipe.id),
    productId: requiredString(recipe.productId),
    version: integer(recipe.version),
    validFrom: requiredString(recipe.validFrom),
    validUntil: optionalString(recipe.validUntil),
    components: records(recipe.components).map((component) => ({
      inventoryItemId: requiredString(component.inventoryItemId),
      locationId: requiredString(component.locationId),
      quantityMilli: integer(component.quantityMilli),
      lossBasisPoints: integer(component.lossBasisPoints),
    })),
  }));
}

export function recipeQuantityToMilli(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) {
    throw new Error("Informe uma quantidade com até três casas decimais.");
  }
  const quantityMilli = Math.round(Number(normalized) * 1_000);
  if (quantityMilli < 1 || quantityMilli > 1_000_000_000) {
    throw new Error("A quantidade deve ser maior que zero e respeitar o limite operacional.");
  }
  return quantityMilli;
}

export function recipeLossToBasisPoints(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Informe a perda percentual com até duas casas decimais.");
  }
  const lossBasisPoints = Math.round(Number(normalized) * 100);
  if (lossBasisPoints < 0 || lossBasisPoints > 9_999) {
    throw new Error("A perda deve estar entre 0% e 99,99%.");
  }
  return lossBasisPoints;
}

export function parsePurchases(value: unknown): PurchasesData {
  const payload = record(value);
  return {
    orders: rows(payload, "orders").map((order) => ({
      id: requiredString(order.id),
      status: requiredString(order.status),
      totalCents: numeric(order.totalCents) ?? 0,
      expectedAt: optionalString(order.expectedAt),
      createdAt: optionalString(order.createdAt),
    })),
    receipts: rows(payload, "receipts"),
  };
}

export function parseFinance(value: unknown): FinanceData {
  const payload = record(value);
  const payables = rows(payload, "payables").map(
    (entry): FinancialEntry => ({
      id: requiredString(entry.id),
      description: requiredString(entry.description),
      status: requiredString(entry.status),
      amountCents: numeric(entry.amountCents) ?? 0,
      settledCents: numeric(entry.paidCents) ?? 0,
      dueDate: requiredString(entry.dueDate),
      direction: "payable",
    }),
  );
  const receivables = rows(payload, "receivables").map(
    (entry): FinancialEntry => ({
      id: requiredString(entry.id),
      description: requiredString(entry.description),
      status: requiredString(entry.status),
      amountCents: numeric(entry.amountCents) ?? 0,
      settledCents: numeric(entry.receivedCents) ?? 0,
      dueDate: requiredString(entry.dueDate),
      direction: "receivable",
    }),
  );
  return {
    entries: [...payables, ...receivables].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    reconciliationImports: rows(payload, "reconciliationImports"),
    reconciliationEntries: rows(payload, "reconciliationEntries"),
  };
}

export function parseCash(value: unknown): CashData {
  const payload = record(value);
  return {
    shifts: rows(payload, "shifts").map((shift) => ({
      id: requiredString(shift.id),
      status: requiredString(shift.status),
      openingCents: numeric(shift.openingCents) ?? 0,
      expectedCents: numeric(shift.expectedCents, true),
      countedCents: numeric(shift.countedCents, true),
      differenceCents: numeric(shift.differenceCents, true),
      openedAt: optionalString(shift.openedAt),
      closedAt: optionalString(shift.closedAt),
    })),
    movements: rows(payload, "movements"),
  };
}

export function parsePeople(value: unknown): PeopleData {
  const payload = record(value);
  return {
    people: rows(payload, "people").map((person) => ({
      id: requiredString(person.id),
      name: requiredString(person.name),
      roleLabel: requiredString(person.roleLabel),
      active: boolean(person.active),
      hourlyRateCents: numeric(person.hourlyRateCents, true),
    })),
    schedules: rows(payload, "schedules"),
    timeEntries: rows(payload, "timeEntries").map((entry) => ({
      id: requiredString(entry.id),
      personId: requiredString(entry.personId),
      clockedInAt: requiredString(entry.clockedInAt),
      clockedOutAt: optionalString(entry.clockedOutAt),
      source: requiredString(entry.source),
    })),
  };
}

function useRemote<T>(
  scope: ManagementScope,
  loader: (organizationId: string, unitId: string) => Promise<unknown>,
  parser: (value: unknown) => T,
) {
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  useEffect(() => {
    void refresh;
    void scope.refreshToken;
    let active = true;
    setState({ status: "loading" });
    loader(scope.organizationId, scope.unitId)
      .then(parser)
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
  }, [loader, parser, refresh, scope.organizationId, scope.refreshToken, scope.unitId]);
  return { state, retry: () => setRefresh((value) => value + 1) };
}

function RemoteGate<T>({
  remote,
  children,
}: {
  remote: { state: RemoteState<T>; retry: () => void };
  children: (data: T) => React.ReactNode;
}) {
  if (remote.state.status === "loading") {
    return (
      <Card className="remote-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Carregando dados da unidade…</strong>
        <p>Aguarde a resposta segura do servidor.</p>
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

function dateLabel(value: string | null): string {
  if (!value) return "Não informado";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "Data inválida";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: value.length > 10 ? "short" : undefined,
  }).format(date);
}

async function loadOverview(scope: ManagementScope): Promise<OverviewData> {
  const loaders: Promise<OverviewMetric[]>[] = [];
  if (["owner", "manager", "inventory"].includes(scope.profileId)) {
    loaders.push(
      api.management
        .inventory(scope.organizationId, scope.unitId)
        .then(parseInventory)
        .then((data) => {
          const quantities = new Map<string, number>();
          for (const balance of data.balances) {
            quantities.set(
              balance.inventoryItemId,
              (quantities.get(balance.inventoryItemId) ?? 0) + balance.quantity,
            );
          }
          const low = data.items.filter(
            (item) => item.active && (quantities.get(item.id) ?? 0) <= item.minimumQuantity,
          ).length;
          return [
            {
              label: "Estoque crítico",
              value: String(low),
              detail: `${data.items.length} insumo(s) cadastrados`,
              href: "#/inventory",
            },
          ];
        }),
    );
  }
  if (["owner", "manager", "inventory", "finance"].includes(scope.profileId)) {
    loaders.push(
      api.management
        .purchases(scope.organizationId, scope.unitId)
        .then(parsePurchases)
        .then((data) => [
          {
            label: "Compras em andamento",
            value: String(
              data.orders.filter((order) => !["received", "canceled"].includes(order.status))
                .length,
            ),
            detail: `${data.receipts.length} recebimento(s) registrado(s)`,
            href: "#/purchases",
          },
        ]),
    );
  }
  if (["owner", "manager", "finance", "cashier"].includes(scope.profileId)) {
    loaders.push(
      api.management
        .finance(scope.organizationId, scope.unitId)
        .then(parseFinance)
        .then((data) => {
          const outstanding = data.entries.reduce(
            (total, entry) => total + Math.max(0, entry.amountCents - entry.settledCents),
            0,
          );
          return [
            {
              label: "Movimento financeiro",
              value: formatMoney(outstanding),
              detail: `${data.entries.length} lançamento(s)`,
              href: "#/finance",
            },
          ];
        }),
      api.management
        .cashShifts(scope.organizationId, scope.unitId)
        .then(parseCash)
        .then((data) => [
          {
            label: "Caixa",
            value: data.shifts.some((shift) => shift.status === "open") ? "Aberto" : "Fechado",
            detail: `${data.movements.length} movimento(s) registrado(s)`,
            href: "#/cash",
          },
        ]),
    );
  }
  if (["owner", "manager"].includes(scope.profileId)) {
    loaders.push(
      api.management
        .people(scope.organizationId, scope.unitId)
        .then(parsePeople)
        .then((data) => [
          {
            label: "Equipe ativa",
            value: String(data.people.filter((person) => person.active).length),
            detail: `${data.timeEntries.filter((entry) => !entry.clockedOutAt).length} pessoa(s) em turno`,
            href: "#/people",
          },
        ]),
    );
  }
  if (!loaders.length) return { metrics: [] };
  return { metrics: (await Promise.all(loaders)).flat() };
}

function identityOverview(value: unknown): OverviewData {
  return value as OverviewData;
}

export function RealDashboard({ scope }: { scope: ManagementScope }) {
  const { organizationId, unitId, profileId } = scope;
  const loader = useCallback(
    () => loadOverview({ organizationId, unitId, profileId }),
    [organizationId, unitId, profileId],
  );
  const remote = useRemote(scope, loader, identityOverview);
  return (
    <RemoteGate remote={remote}>
      {(data) =>
        data.metrics.length ? (
          <div className="metrics-grid">
            {data.metrics.map((metric, index) => (
              <Card className="metric-card" key={metric.label}>
                <span className={`metric-card__spark metric-card__spark--${(index % 4) + 1}`} />
                <p>{metric.label}</p>
                <strong>{metric.value}</strong>
                <small>{metric.detail}</small>
                {metric.href && (
                  <a href={metric.href}>
                    Abrir área <Icon name="arrow-right" />
                  </a>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              description="Este perfil não possui indicadores gerenciais disponíveis no backend. Os módulos operacionais continuam acessíveis conforme as permissões."
              icon={<UiIcon name="info" />}
              title="Sem indicadores gerenciais para este perfil"
            />
          </Card>
        )
      }
    </RemoteGate>
  );
}

function recipeQuantityLabel(quantityMilli: number): string {
  return (quantityMilli / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function RecipeManager({ scope, inventory }: { scope: ManagementScope; inventory: InventoryData }) {
  const recipesRemote = useRemote(scope, api.management.recipes, parseRecipes);
  const catalogRemote = useRemote(scope, api.pilot.catalog, parseRecipeCatalog);
  const [productId, setProductId] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lossPercent, setLossPercent] = useState("0");
  const [components, setComponents] = useState<RecipeComponent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [success, setSuccess] = useState("");
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

  function addComponent() {
    setFeedback("");
    setSuccess("");
    try {
      if (
        !activeItems.some((item) => item.id === inventoryItemId) ||
        !activeLocations.some((location) => location.id === locationId)
      ) {
        throw new Error("Selecione um insumo e o local de baixa.");
      }
      if (
        components.some(
          (component) =>
            component.inventoryItemId === inventoryItemId && component.locationId === locationId,
        )
      ) {
        throw new Error("Este insumo já foi incluído para o local selecionado.");
      }
      setComponents((current) => [
        ...current,
        {
          inventoryItemId,
          locationId,
          quantityMilli: recipeQuantityToMilli(quantity),
          lossBasisPoints: recipeLossToBasisPoints(lossPercent),
        },
      ]);
      setInventoryItemId("");
      setQuantity("");
      setLossPercent("0");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível incluir o componente.",
      );
    }
  }

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    setSuccess("");
    if (!productId) {
      setFeedback("Selecione o produto vendido por esta ficha técnica.");
      return;
    }
    if (
      catalogRemote.state.status !== "ready" ||
      !catalogRemote.state.data.products.some(
        (product) => product.id === productId && product.active,
      )
    ) {
      setFeedback("O produto selecionado não está mais ativo no catálogo.");
      return;
    }
    if (!components.length) {
      setFeedback("Inclua ao menos um componente antes de salvar.");
      return;
    }
    const body = { productId, components };
    const fingerprint = JSON.stringify(body);
    const currentAttempt =
      attempt?.fingerprint === fingerprint ? attempt : { fingerprint, key: crypto.randomUUID() };
    setAttempt(currentAttempt);
    setSubmitting(true);
    try {
      await api.management.configureRecipe(
        scope.organizationId,
        scope.unitId,
        body,
        currentAttempt.key,
      );
      setComponents([]);
      setAttempt(null);
      setSuccess("Nova versão ativa criada. A versão anterior foi preservada no histórico.");
      recipesRemote.retry();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível salvar a ficha técnica.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const activeItems = inventory.items.filter((item) => item.active);
  const activeLocations = inventory.locations.filter((location) => location.active);
  const itemById = new Map(inventory.items.map((item) => [item.id, item]));
  const locationById = new Map(inventory.locations.map((location) => [location.id, location]));

  return (
    <RemoteGate remote={catalogRemote}>
      {(catalog) => (
        <RemoteGate remote={recipesRemote}>
          {(recipes) => {
            const activeProducts = catalog.products.filter((product) => product.active);
            const productById = new Map(catalog.products.map((product) => [product.id, product]));
            const prerequisitesReady =
              activeProducts.length > 0 && activeItems.length > 0 && activeLocations.length > 0;
            const orderedRecipes = [...recipes].sort((a, b) =>
              (productById.get(a.productId)?.name ?? a.productId).localeCompare(
                productById.get(b.productId)?.name ?? b.productId,
                "pt-BR",
              ),
            );
            return (
              <Card className="recipe-card">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Produção e custo</p>
                    <h2>Fichas técnicas versionadas</h2>
                  </div>
                  <Badge tone="info">{recipes.length} ativa(s)</Badge>
                </div>
                <p className="recipe-card__intro">
                  Defina o consumo real de cada venda. Toda alteração cria uma nova versão, sem
                  reescrever o histórico operacional.
                </p>
                {!prerequisitesReady && (
                  <p className="auth-message auth-message--error" role="alert">
                    {!activeProducts.length
                      ? "Cadastre ao menos um produto ativo no catálogo. "
                      : ""}
                    {!activeItems.length ? "Cadastre ao menos um insumo ativo. " : ""}
                    {!activeLocations.length ? "Cadastre ao menos um local de estoque ativo." : ""}
                  </p>
                )}
                <div className="recipe-layout">
                  <form className="recipe-form" onSubmit={saveRecipe}>
                    <label className="compact-field">
                      Produto vendido
                      <select
                        disabled={!activeProducts.length || submitting}
                        onChange={(event) => {
                          setProductId(event.target.value);
                          setSuccess("");
                        }}
                        value={productId}
                      >
                        <option value="">Selecione o produto</option>
                        {activeProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset
                      className="recipe-component-builder"
                      disabled={!prerequisitesReady || submitting}
                    >
                      <legend>Adicionar componente</legend>
                      <label className="compact-field">
                        Insumo
                        <select
                          onChange={(event) => setInventoryItemId(event.target.value)}
                          value={inventoryItemId}
                        >
                          <option value="">Selecione o insumo</option>
                          {activeItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.unit})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="compact-field">
                        Local de baixa
                        <select
                          onChange={(event) => setLocationId(event.target.value)}
                          value={locationId}
                        >
                          <option value="">Selecione o local</option>
                          {activeLocations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name} ({location.code})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="compact-field">
                        Quantidade por venda
                        <input
                          inputMode="decimal"
                          onChange={(event) => setQuantity(event.target.value)}
                          placeholder="Ex.: 0,250"
                          value={quantity}
                        />
                      </label>
                      <label className="compact-field">
                        Perda prevista (%)
                        <input
                          inputMode="decimal"
                          onChange={(event) => setLossPercent(event.target.value)}
                          placeholder="Ex.: 2,50"
                          value={lossPercent}
                        />
                      </label>
                      <Button onClick={addComponent} size="sm" variant="secondary">
                        Adicionar componente
                      </Button>
                    </fieldset>
                    {components.length > 0 && (
                      <ul className="recipe-draft" aria-label="Componentes da nova versão">
                        {components.map((component) => {
                          const item = itemById.get(component.inventoryItemId);
                          const location = locationById.get(component.locationId);
                          return (
                            <li
                              className="recipe-component-row"
                              key={`${component.inventoryItemId}:${component.locationId}`}
                            >
                              <span>
                                <strong>{item?.name ?? "Insumo indisponível"}</strong>
                                <small>{location?.name ?? "Local indisponível"}</small>
                              </span>
                              <span>
                                {recipeQuantityLabel(component.quantityMilli)} {item?.unit ?? "un."}
                                {component.lossBasisPoints > 0
                                  ? ` + ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(component.lossBasisPoints / 100)}% de perda`
                                  : ""}
                              </span>
                              <Button
                                aria-label={`Remover ${item?.name ?? "componente"}`}
                                onClick={() =>
                                  setComponents((current) =>
                                    current.filter((candidate) => candidate !== component),
                                  )
                                }
                                size="sm"
                                variant="ghost"
                              >
                                Remover
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {feedback && (
                      <p className="auth-message auth-message--error" role="alert">
                        {feedback}
                      </p>
                    )}
                    {success && (
                      <p className="auth-message" role="status">
                        {success}
                      </p>
                    )}
                    <Button disabled={!prerequisitesReady || submitting} type="submit">
                      {submitting ? "Salvando versão…" : "Salvar nova versão"}
                    </Button>
                  </form>
                  <section className="recipe-versions" aria-labelledby="active-recipes-title">
                    <div className="recipe-versions__header">
                      <h3 id="active-recipes-title">Versões ativas</h3>
                      <small>Apenas a configuração vigente de cada produto</small>
                    </div>
                    {orderedRecipes.length ? (
                      <div className="recipe-version-list">
                        {orderedRecipes.map((recipe) => (
                          <article className="recipe-version" key={recipe.id}>
                            <div>
                              <strong>
                                {productById.get(recipe.productId)?.name ?? "Produto indisponível"}
                              </strong>
                              <small>Vigente desde {dateLabel(recipe.validFrom)}</small>
                            </div>
                            <Badge tone="success">Versão {recipe.version}</Badge>
                            <ul>
                              {recipe.components.map((component) => {
                                const item = itemById.get(component.inventoryItemId);
                                const location = locationById.get(component.locationId);
                                return (
                                  <li key={`${component.inventoryItemId}:${component.locationId}`}>
                                    <span>
                                      {item?.name ?? "Insumo indisponível"} ·{" "}
                                      {location?.name ?? "Local indisponível"}
                                    </span>
                                    <strong>
                                      {recipeQuantityLabel(component.quantityMilli)}{" "}
                                      {item?.unit ?? "un."}
                                      {component.lossBasisPoints > 0
                                        ? ` + ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(component.lossBasisPoints / 100)}%`
                                        : ""}
                                    </strong>
                                  </li>
                                );
                              })}
                            </ul>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        description="Selecione um produto, adicione os insumos consumidos e salve a primeira versão."
                        icon={<UiIcon name="list" />}
                        title="Nenhuma ficha técnica ativa"
                      />
                    )}
                  </section>
                </div>
              </Card>
            );
          }}
        </RemoteGate>
      )}
    </RemoteGate>
  );
}

export function RealInventoryPage({ scope }: { scope: ManagementScope }) {
  const remote = useRemote(scope, api.management.inventory, parseInventory);
  const [query, setQuery] = useState("");
  return (
    <RemoteGate remote={remote}>
      {(data) => {
        const quantities = new Map<string, number>();
        const costs = new Map<string, number | null>();
        for (const balance of data.balances) {
          quantities.set(
            balance.inventoryItemId,
            (quantities.get(balance.inventoryItemId) ?? 0) + balance.quantity,
          );
          costs.set(balance.inventoryItemId, balance.averageCostCents);
        }
        const visible = data.items.filter((item) =>
          item.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")),
        );
        return (
          <div className="inventory-management">
            <RecipeManager
              inventory={data}
              key={`${scope.organizationId}:${scope.unitId}`}
              scope={scope}
            />
            {!data.items.length ? (
              <Card>
                <EmptyState
                  description="Cadastre locais e insumos para iniciar o controle desta unidade."
                  icon={<UiIcon name="inventory" />}
                  title="Estoque ainda não configurado"
                />
              </Card>
            ) : (
              <Card className="inventory-table-card">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Dados da unidade</p>
                    <h2>Itens de estoque</h2>
                  </div>
                  <input
                    aria-label="Buscar insumo"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar insumo"
                    value={query}
                  />
                </div>
                <table className="data-table">
                  <caption className="gm-sr-only">Estoque atual da unidade</caption>
                  <thead>
                    <tr className="data-table__head">
                      <th>Insumo</th>
                      <th>Quantidade</th>
                      <th>Mínimo</th>
                      <th>Custo médio</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => {
                      const quantity = quantities.get(item.id) ?? 0;
                      const low = quantity <= item.minimumQuantity;
                      const cost = costs.get(item.id);
                      return (
                        <tr className="data-table__row" key={item.id}>
                          <td>
                            <strong>{item.name}</strong>
                            <small>{item.sku ?? "Sem SKU"}</small>
                          </td>
                          <td>
                            <strong>
                              {quantity.toLocaleString("pt-BR")} {item.unit}
                            </strong>
                          </td>
                          <td>
                            {item.minimumQuantity.toLocaleString("pt-BR")} {item.unit}
                          </td>
                          <td>
                            {cost === null || cost === undefined
                              ? "Não informado"
                              : `${formatMoney(cost)}/${item.unit}`}
                          </td>
                          <td>
                            <Badge
                              tone={
                                !item.active
                                  ? "neutral"
                                  : quantity === 0
                                    ? "danger"
                                    : low
                                      ? "warning"
                                      : "success"
                              }
                            >
                              {!item.active
                                ? "Inativo"
                                : quantity === 0
                                  ? "Zerado"
                                  : low
                                    ? "Repor"
                                    : "Normal"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!visible.length && (
                  <p className="table-empty">Nenhum insumo corresponde à busca.</p>
                )}
              </Card>
            )}
          </div>
        );
      }}
    </RemoteGate>
  );
}

export function RealPurchasesPage({ scope }: { scope: ManagementScope }) {
  const remote = useRemote(scope, api.management.purchases, parsePurchases);
  const [actionId, setActionId] = useState("");
  const [actionError, setActionError] = useState("");
  async function approve(orderId: string) {
    setActionId(orderId);
    setActionError("");
    try {
      await api.management.approvePurchase(scope.organizationId, scope.unitId, orderId);
      remote.retry();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível aprovar a compra.");
    } finally {
      setActionId("");
    }
  }
  return (
    <RemoteGate remote={remote}>
      {(data) =>
        data.orders.length ? (
          <Card>
            <div className="card-header">
              <div>
                <p className="eyebrow">Suprimentos</p>
                <h2>Pedidos de compra</h2>
              </div>
              <Badge>{data.receipts.length} recebimento(s)</Badge>
            </div>
            {actionError && (
              <p className="auth-message auth-message--error" role="alert">
                {actionError}
              </p>
            )}
            <div className="management-list">
              {data.orders.map((order) => (
                <div className="management-row" key={order.id}>
                  <span>
                    <strong>Pedido {order.id.slice(0, 8)}</strong>
                    <small>
                      Criado em {dateLabel(order.createdAt)} · previsão{" "}
                      {dateLabel(order.expectedAt)}
                    </small>
                  </span>
                  <strong>{formatMoney(order.totalCents)}</strong>
                  <Badge
                    tone={
                      order.status === "draft"
                        ? "warning"
                        : order.status === "received"
                          ? "success"
                          : "info"
                    }
                  >
                    {order.status}
                  </Badge>
                  {order.status === "draft" && (
                    <Button
                      disabled={actionId === order.id}
                      onClick={() => void approve(order.id)}
                      size="sm"
                    >
                      {actionId === order.id ? "Aprovando…" : "Aprovar"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <Card>
            <EmptyState
              description="Nenhum pedido foi criado para esta unidade."
              icon={<UiIcon name="plus" />}
              title="Sem pedidos de compra"
            />
          </Card>
        )
      }
    </RemoteGate>
  );
}

export function RealFinancePage({ scope }: { scope: ManagementScope }) {
  const remote = useRemote(scope, api.management.finance, parseFinance);
  return (
    <RemoteGate remote={remote}>
      {(data) => {
        const payable = data.entries
          .filter((entry) => entry.direction === "payable")
          .reduce((sum, entry) => sum + Math.max(0, entry.amountCents - entry.settledCents), 0);
        const receivable = data.entries
          .filter((entry) => entry.direction === "receivable")
          .reduce((sum, entry) => sum + Math.max(0, entry.amountCents - entry.settledCents), 0);
        return (
          <div>
            <div className="metrics-grid metrics-grid--three">
              <Card className="metric-card">
                <p>A pagar</p>
                <strong>{formatMoney(payable)}</strong>
                <small>Saldo pendente real</small>
              </Card>
              <Card className="metric-card">
                <p>A receber</p>
                <strong>{formatMoney(receivable)}</strong>
                <small>Saldo pendente real</small>
              </Card>
              <Card className="metric-card">
                <p>Conciliações</p>
                <strong>{data.reconciliationEntries.length}</strong>
                <small>{data.reconciliationImports.length} importação(ões)</small>
              </Card>
            </div>
            <Card className="finance-entries">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Agenda</p>
                  <h2>Lançamentos</h2>
                </div>
              </div>
              {data.entries.length ? (
                data.entries.map((entry) => (
                  <div className="finance-row" key={`${entry.direction}-${entry.id}`}>
                    <Icon
                      className={`action-icon ${entry.direction === "payable" ? "action-icon--warning" : ""}`}
                      name={entry.direction === "payable" ? "arrow-down" : "arrow-up"}
                    />
                    <span>
                      <strong>{entry.description}</strong>
                      <small>
                        Vencimento {dateLabel(entry.dueDate)} · {entry.status}
                      </small>
                    </span>
                    <strong className={entry.direction === "payable" ? "negative" : "positive"}>
                      {entry.direction === "payable" ? "−" : "+"}
                      {formatMoney(entry.amountCents - entry.settledCents)}
                    </strong>
                  </div>
                ))
              ) : (
                <EmptyState
                  description="Não há contas a pagar ou receber nesta unidade."
                  icon={<UiIcon name="cash" />}
                  title="Financeiro sem lançamentos"
                />
              )}
            </Card>
          </div>
        );
      }}
    </RemoteGate>
  );
}

export function RealCashPage({ scope }: { scope: ManagementScope }) {
  const remote = useRemote(scope, api.management.cashShifts, parseCash);
  const [opening, setOpening] = useState("");
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function openShift(event: FormEvent) {
    event.preventDefault();
    const cents = Math.round(Number(opening.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setActionError("Informe um fundo de caixa válido.");
      return;
    }
    setSubmitting(true);
    setActionError("");
    try {
      await api.management.openCashShift(scope.organizationId, scope.unitId, cents);
      setOpening("");
      remote.retry();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível abrir o caixa.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <RemoteGate remote={remote}>
      {(data) => {
        const open = data.shifts.find((shift) => shift.status === "open");
        if (!open) {
          return (
            <Card className="remote-state">
              <strong>Nenhum turno de caixa aberto</strong>
              <p>Informe o fundo inicial para abrir o caixa desta unidade.</p>
              <form className="inline-action-form" onSubmit={openShift}>
                <label>
                  Fundo de caixa (R$)
                  <input
                    inputMode="decimal"
                    onChange={(event) => setOpening(event.target.value)}
                    placeholder="0,00"
                    required
                    value={opening}
                  />
                </label>
                {actionError && (
                  <p className="auth-message auth-message--error" role="alert">
                    {actionError}
                  </p>
                )}
                <Button disabled={submitting} type="submit">
                  {submitting ? "Abrindo…" : "Abrir caixa"}
                </Button>
              </form>
            </Card>
          );
        }
        return (
          <div className="metrics-grid metrics-grid--three">
            <Card className="metric-card">
              <p>Status</p>
              <strong>Aberto</strong>
              <small>Desde {dateLabel(open.openedAt)}</small>
            </Card>
            <Card className="metric-card">
              <p>Fundo inicial</p>
              <strong>{formatMoney(open.openingCents)}</strong>
              <small>Valor informado na abertura</small>
            </Card>
            <Card className="metric-card">
              <p>Movimentos</p>
              <strong>{data.movements.length}</strong>
              <small>Suprimentos e sangrias registrados</small>
            </Card>
          </div>
        );
      }}
    </RemoteGate>
  );
}

export function RealPeoplePage({ scope }: { scope: ManagementScope }) {
  const remote = useRemote(scope, api.management.people, parsePeople);
  const [actionId, setActionId] = useState("");
  const [actionError, setActionError] = useState("");
  const personById = useMemo(() => {
    if (remote.state.status !== "ready") return new Map<string, Person>();
    return new Map(remote.state.data.people.map((person) => [person.id, person]));
  }, [remote.state]);
  async function clockOut(entryId: string) {
    setActionId(entryId);
    setActionError("");
    try {
      await api.management.clockOut(
        scope.organizationId,
        scope.unitId,
        entryId,
        new Date().toISOString(),
      );
      remote.retry();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível registrar a saída.",
      );
    } finally {
      setActionId("");
    }
  }
  return (
    <RemoteGate remote={remote}>
      {(data) =>
        data.people.length ? (
          <div className="people-grid">
            <Card>
              <div className="card-header">
                <div>
                  <p className="eyebrow">Equipe</p>
                  <h2>Pessoas da unidade</h2>
                </div>
                <Badge tone="success">
                  {data.people.filter((person) => person.active).length} ativas
                </Badge>
              </div>
              <div className="management-list">
                {data.people.map((person) => (
                  <div className="management-row" key={person.id}>
                    <span>
                      <strong>{person.name}</strong>
                      <small>{person.roleLabel}</small>
                    </span>
                    <Badge tone={person.active ? "success" : "neutral"}>
                      {person.active ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <div className="card-header">
                <div>
                  <p className="eyebrow">Ponto</p>
                  <h2>Turnos em andamento</h2>
                </div>
              </div>
              {actionError && (
                <p className="auth-message auth-message--error" role="alert">
                  {actionError}
                </p>
              )}
              <div className="management-list">
                {data.timeEntries
                  .filter((entry) => !entry.clockedOutAt)
                  .map((entry) => (
                    <div className="management-row" key={entry.id}>
                      <span>
                        <strong>
                          {personById.get(entry.personId)?.name ?? "Pessoa não encontrada"}
                        </strong>
                        <small>
                          Entrada {dateLabel(entry.clockedInAt)} · {entry.source}
                        </small>
                      </span>
                      <Button
                        disabled={actionId === entry.id}
                        onClick={() => void clockOut(entry.id)}
                        size="sm"
                        variant="secondary"
                      >
                        {actionId === entry.id ? "Registrando…" : "Registrar saída"}
                      </Button>
                    </div>
                  ))}
                {!data.timeEntries.some((entry) => !entry.clockedOutAt) && (
                  <EmptyState
                    description="Não há marcações de ponto abertas."
                    icon={<UiIcon name="clock" />}
                    title="Nenhum turno em andamento"
                  />
                )}
              </div>
            </Card>
          </div>
        ) : (
          <Card>
            <EmptyState
              description="Cadastre pessoas para administrar escalas, ponto e comissões."
              icon={<UiIcon name="plus" />}
              title="Equipe ainda não cadastrada"
            />
          </Card>
        )
      }
    </RemoteGate>
  );
}
