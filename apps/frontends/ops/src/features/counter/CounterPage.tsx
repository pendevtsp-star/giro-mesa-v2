import { Badge, Button, Card, EmptyState, Toast } from "@giromesa/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api";
import { pilotMutation } from "../../operational-dispatch";
import {
  type PilotScope,
  parsePilotFloor,
  parseTab,
  parseTabs,
  RemoteGate,
  record,
  useRemote,
} from "../../operations.shared";
import { formatMoney } from "../../rules";

import { TabWorkspace } from "./CounterWorkspace";
import { promisedAtToIso } from "./promisedAt";

export type CounterQueueStage =
  | "all"
  | "new"
  | "production"
  | "ready"
  | "waiting"
  | "delivered"
  | "late";

export function counterQueueStage(
  tab: {
    status: string;
    totalCents: number;
    promisedAt: string | null;
    readyNotifiedAt: string | null;
  },
  now = Date.now(),
): Exclude<CounterQueueStage, "all"> {
  if (tab.status !== "open") return "delivered";
  if (tab.promisedAt && !tab.readyNotifiedAt && new Date(tab.promisedAt).getTime() < now)
    return "late";
  if (tab.readyNotifiedAt)
    // ponytail: a listagem ainda não expõe o status da produção; troque pela etapa explícita quando o resumo da API a incluir.
    return now - new Date(tab.readyNotifiedAt).getTime() < 2 * 60_000 ? "ready" : "waiting";
  return tab.totalCents > 0 ? "production" : "new";
}

const counterQueueLabels: Record<CounterQueueStage, string> = {
  all: "Em andamento",
  new: "Novos",
  production: "Em produção",
  ready: "Prontos",
  waiting: "Aguardando",
  delivered: "Entregues",
  late: "Atrasados",
};

const counterQueuePriority: Record<Exclude<CounterQueueStage, "all">, number> = {
  late: 0,
  ready: 1,
  waiting: 2,
  new: 3,
  production: 4,
  delivered: 5,
};

export function sortCounterQueue<
  T extends {
    status: string;
    totalCents: number;
    promisedAt: string | null;
    readyNotifiedAt: string | null;
    openedAt?: string | null;
  },
>(tabs: T[], now = Date.now()) {
  return [...tabs].sort((left, right) => {
    const stageDifference =
      counterQueuePriority[counterQueueStage(left, now)] -
      counterQueuePriority[counterQueueStage(right, now)];
    if (stageDifference !== 0) return stageDifference;
    const leftTime = new Date(left.promisedAt ?? left.openedAt ?? 0).getTime();
    const rightTime = new Date(right.promisedAt ?? right.openedAt ?? 0).getTime();
    return leftTime - rightTime;
  });
}

export function RealCounterPage({
  scope,
  embedded = false,
}: {
  scope: PilotScope;
  embedded?: boolean;
}) {
  const tabs = useRemote(
    scope,
    () => scope.load("tabs", undefined, () => api.pilot.tabs(scope.organizationId, scope.unitId)),
    parseTabs,
  );
  const floor = useRemote(
    scope,
    () => scope.load("floor", undefined, () => api.pilot.floor(scope.organizationId, scope.unitId)),
    parsePilotFloor,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [readyNotificationConsent, setReadyNotificationConsent] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<"dine_in" | "pickup" | "delivery">(
    "pickup",
  );
  const [promisedDate, setPromisedDate] = useState("");
  const [promisedTime, setPromisedTime] = useState("");
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<"all" | "dine_in" | "pickup" | "delivery">(
    "all",
  );
  const [stageFilter, setStageFilter] = useState<CounterQueueStage>("all");
  const [guests, setGuests] = useState(1);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  return (
    <RemoteGate remote={tabs}>
      {(allTabs) => {
        const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
        const counterCandidates = allTabs.filter(
          (tab) =>
            tab.tableId === null &&
            (tab.status === "open" || tab.status === "closed") &&
            (channelFilter === "all" || tab.fulfillmentType === channelFilter) &&
            (!normalizedQuery ||
              `${tab.label ?? ""} ${tab.customerName ?? ""} ${tab.customerPhone ?? ""}`
                .toLocaleLowerCase("pt-BR")
                .includes(normalizedQuery)),
        );
        const stageCounts = counterCandidates.reduce<Record<CounterQueueStage, number>>(
          (counts, tab) => {
            if (tab.status === "open") counts.all += 1;
            counts[counterQueueStage(tab)] += 1;
            return counts;
          },
          { all: 0, new: 0, production: 0, ready: 0, waiting: 0, delivered: 0, late: 0 },
        );
        const counterTabs = sortCounterQueue(
          counterCandidates.filter((tab) =>
            stageFilter === "all" ? tab.status === "open" : counterQueueStage(tab) === stageFilter,
          ),
        );
        async function open(event: FormEvent) {
          event.preventDefault();
          setBusy(true);
          setFeedback("");
          try {
            const body = {
              label: label.trim() || undefined,
              guestCount: guests,
              customerName: customerName.trim() || undefined,
              customerPhone: customerPhone.trim() || undefined,
              readyNotificationConsent: Boolean(customerPhone.trim()) && readyNotificationConsent,
              deliveryAddress:
                fulfillmentType === "delivery" ? deliveryAddress.trim() || undefined : undefined,
              fulfillmentType,
              promisedAt: promisedAtToIso(promisedDate, promisedTime) ?? undefined,
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
            setCustomerName("");
            setCustomerPhone("");
            setReadyNotificationConsent(false);
            setDeliveryAddress("");
            setPromisedDate("");
            setPromisedTime("");
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
          <div
            className={`ops-layout counter-operation ${embedded ? "counter-page--embedded" : ""}`}
          >
            <section className="ops-board">
              <Card>
                <p className="eyebrow">Balcão e retirada</p>
                <h2>Nova comanda rápida</h2>
                <form
                  className="inline-form counter-open-form"
                  onSubmit={(event) => void open(event)}
                >
                  <label>
                    Atendimento
                    <select
                      onChange={(event) =>
                        setFulfillmentType(event.target.value as typeof fulfillmentType)
                      }
                      value={fulfillmentType}
                    >
                      <option value="pickup">Retirada</option>
                      <option value="dine_in">Consumo no local</option>
                      <option value="delivery">Delivery</option>
                    </select>
                  </label>
                  <label>
                    Nome do cliente
                    <input
                      onChange={(event) => setCustomerName(event.target.value)}
                      placeholder="Opcional: gera número automático"
                      value={customerName}
                    />
                  </label>
                  <details className="counter-open-advanced" open={fulfillmentType === "delivery"}>
                    <summary>Prazo e identificação</summary>
                    <div>
                      <label>
                        Telefone
                        <input
                          inputMode="tel"
                          onChange={(event) => setCustomerPhone(event.target.value)}
                          value={customerPhone}
                        />
                      </label>
                      <label>
                        <input
                          checked={readyNotificationConsent}
                          disabled={!customerPhone.trim()}
                          onChange={(event) => setReadyNotificationConsent(event.target.checked)}
                          type="checkbox"
                        />
                        Cliente autorizou receber o aviso de pedido pronto
                      </label>
                      {fulfillmentType !== "dine_in" && (
                        <fieldset className="promised-at-field">
                          <legend>Prometido para</legend>
                          <label>
                            <span>Data</span>
                            <input
                              onChange={(event) => setPromisedDate(event.target.value)}
                              type="date"
                              value={promisedDate}
                            />
                          </label>
                          <label>
                            <span>Hora</span>
                            <input
                              lang="pt-BR"
                              onChange={(event) => setPromisedTime(event.target.value)}
                              type="time"
                              value={promisedTime}
                            />
                          </label>
                        </fieldset>
                      )}
                      {fulfillmentType === "delivery" && (
                        <label className="inline-form__wide">
                          Endereço
                          <input
                            onChange={(event) => setDeliveryAddress(event.target.value)}
                            required
                            value={deliveryAddress}
                          />
                        </label>
                      )}
                      <label>
                        Referência interna
                        <input
                          onChange={(event) => setLabel(event.target.value)}
                          placeholder="Opcional"
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
                    </div>
                  </details>
                  <Button disabled={busy || guests < 1} type="submit">
                    {busy ? "Abrindo…" : "Abrir e pedir"}
                  </Button>
                </form>
                {feedback && (
                  <Toast
                    message={feedback}
                    onDismiss={() => setFeedback("")}
                    title="Balcão"
                    tone="danger"
                  />
                )}
              </Card>
              <Card className="counter-queue-tools">
                <div
                  aria-live={tabs.refreshError ? "assertive" : "off"}
                  className="gm-observability-row counter-sync-status"
                  role={tabs.refreshError ? "alert" : "status"}
                >
                  <span>
                    <Badge tone={tabs.refreshError ? "warning" : "success"}>
                      {tabs.refreshError ? "Dados desatualizados" : "Operação atualizada"}
                    </Badge>
                    <small>
                      {tabs.refreshError ??
                        (tabs.lastSuccessfulAt
                          ? `Última confirmação às ${new Date(tabs.lastSuccessfulAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                          : "Aguardando primeira confirmação")}
                    </small>
                  </span>
                  <Button
                    disabled={tabs.refreshing}
                    onClick={() => void tabs.refresh()}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {tabs.refreshing ? "Atualizando…" : "Atualizar"}
                  </Button>
                </div>
                <label className="search-field">
                  <span aria-hidden="true">⌕</span>
                  <input
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar cliente, número ou telefone"
                    value={query}
                  />
                </label>
                <fieldset className="counter-stage-filter">
                  <legend className="gm-sr-only">Etapas do balcão</legend>
                  {(Object.keys(counterQueueLabels) as CounterQueueStage[]).map((stage) => (
                    <button
                      aria-pressed={stageFilter === stage}
                      key={stage}
                      onClick={() => setStageFilter(stage)}
                      type="button"
                    >
                      <span>{counterQueueLabels[stage]}</span>
                      <small>{stageCounts[stage]}</small>
                    </button>
                  ))}
                </fieldset>
                <div className="segmented segmented--scroll">
                  {(["all", "pickup", "dine_in", "delivery"] as const).map((channel) => (
                    <button
                      aria-pressed={channelFilter === channel}
                      key={channel}
                      onClick={() => setChannelFilter(channel)}
                      type="button"
                    >
                      {channel === "all"
                        ? "Todos"
                        : channel === "pickup"
                          ? "Retirada"
                          : channel === "delivery"
                            ? "Delivery"
                            : "Local"}
                    </button>
                  ))}
                </div>
              </Card>
              <div className="data-list ops-tab-list">
                {counterTabs.map((tab) => {
                  const stage = counterQueueStage(tab);
                  return (
                    <button
                      className={selected === tab.id ? "data-row data-row--selected" : "data-row"}
                      key={tab.id}
                      onClick={() => setSelected(tab.id)}
                      type="button"
                    >
                      <div>
                        <strong>
                          {tab.label ??
                            (tab.displayNumber
                              ? `Balcão ${tab.displayNumber}`
                              : "Atendimento do balcão")}
                        </strong>
                        <small>{tab.customerName ?? `${tab.guestCount} pessoa(s)`}</small>
                        {tab.promisedAt && (
                          <small>
                            {new Date(tab.promisedAt).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </small>
                        )}
                        <span className="counter-row__badges">
                          <Badge
                            tone={
                              stage === "late"
                                ? "danger"
                                : stage === "ready" || stage === "delivered"
                                  ? "success"
                                  : stage === "production"
                                    ? "info"
                                    : "neutral"
                            }
                          >
                            {counterQueueLabels[stage]}
                          </Badge>
                          <small>
                            {tab.fulfillmentType === "pickup"
                              ? "Retirada"
                              : tab.fulfillmentType === "delivery"
                                ? "Delivery"
                                : "Local"}
                          </small>
                        </span>
                      </div>
                      <strong>{formatMoney(tab.totalCents)}</strong>
                    </button>
                  );
                })}
              </div>
            </section>
            <aside className={selected ? "ops-panel counter-ops-panel--active" : "ops-panel"}>
              {selected ? (
                <>
                  <button
                    className="counter-workspace-close"
                    onClick={() => setSelected(null)}
                    type="button"
                  >
                    ← Voltar para a fila
                  </button>
                  <TabWorkspace
                    key={selected}
                    scope={scope}
                    tabId={selected}
                    floor={floor.state.status === "ready" ? floor.state.data : undefined}
                    onChanged={tabs.retry}
                  />
                </>
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
