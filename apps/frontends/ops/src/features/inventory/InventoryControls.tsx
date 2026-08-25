import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  NativeSelect,
  StatCard,
  Toast,
} from "@giromesa/ui";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "../../api";
import {
  dateLabel,
  type InventoryData,
  type ManagementScope,
  operationalKey,
  RemoteGate,
  useRemote,
} from "../../management.shared";
import { formatMoney } from "../../rules";
import { type InventoryControlsData, parseInventoryControls } from "./inventory-controls";
import { printInventoryLabels } from "./inventory-labels";
import {
  clearRejectedInventoryActions,
  enqueueInventoryAction,
  inventoryOfflineStatus,
  replayInventoryQueue,
} from "./inventory-offline";

export function InventoryControls({
  inventory,
  scope,
}: {
  inventory: InventoryData;
  scope: ManagementScope;
}) {
  const remote = useRemote(scope, api.management.inventoryControls, parseInventoryControls);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  const [offline, setOffline] = useState(() => inventoryOfflineStatus(scope));
  const itemById = useMemo(
    () => new Map(inventory.items.map((item) => [item.id, item])),
    [inventory.items],
  );
  const locationById = useMemo(
    () => new Map(inventory.locations.map((location) => [location.id, location])),
    [inventory.locations],
  );

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await remote.retry();
      setMessage({ text: success, tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Não foi possível concluir.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <RemoteGate remote={remote}>
      {(data) => (
        <div className="inventory-workspace">
          <section className="inventory-observability" aria-label="Indicadores de confiabilidade">
            <StatCard
              footer={data.confidence.level === "high" ? "Confiabilidade alta" : "Requer atenção"}
              title="Confiança do saldo"
              value={`${data.confidence.score}%`}
            />
            <StatCard
              title="Acurácia da contagem"
              value={`${data.confidence.countAccuracyPercent}%`}
            />
            <StatCard
              title="Acurácia das transferências"
              value={`${data.confidence.transferAccuracyPercent}%`}
            />
            <StatCard title="Perdas sobre saídas" value={`${data.confidence.lossRatePercent}%`} />
          </section>

          {(offline.pending > 0 || offline.rejected > 0) && (
            <Card className="inventory-system-status" role="status">
              <strong>
                Fila offline: {offline.pending} pendente(s), {offline.rejected} rejeitada(s)
              </strong>
              <div className="inventory-command-bar__actions">
                <Button
                  disabled={busy || !navigator.onLine}
                  onClick={() =>
                    void run(
                      async () => setOffline(await replayInventoryQueue(scope)),
                      "Fila sincronizada.",
                    )
                  }
                  size="sm"
                >
                  Sincronizar
                </Button>
                <Button
                  disabled={!offline.rejected}
                  onClick={() => setOffline(clearRejectedInventoryActions(scope))}
                  size="sm"
                  variant="ghost"
                >
                  Limpar rejeitadas
                </Button>
              </div>
            </Card>
          )}

          <div className="inventory-overview-grid">
            <BlindCountCard
              busy={busy}
              data={data}
              inventory={inventory}
              onRun={run}
              onQueued={(status: ReturnType<typeof inventoryOfflineStatus>) => {
                setOffline(status);
                setMessage({ text: "Contagem guardada para sincronização.", tone: "success" });
              }}
              scope={scope}
            />
            <SectorPolicyCard
              busy={busy}
              data={data}
              inventory={inventory}
              onRun={run}
              scope={scope}
            />
            <TemperatureCard
              busy={busy}
              data={data}
              inventory={inventory}
              onQueued={setOffline}
              onRun={run}
              scope={scope}
            />
            <LotHoldCard busy={busy} data={data} inventory={inventory} onRun={run} scope={scope} />
          </div>

          <div className="inventory-overview-grid">
            <Card>
              <div className="inventory-section-header">
                <div>
                  <p className="eyebrow">Exceções</p>
                  <h2>Anomalias</h2>
                </div>
                <Badge tone={data.anomalies.length ? "warning" : "success"}>
                  {data.anomalies.length}
                </Badge>
              </div>
              {data.anomalies.length ? (
                <div className="inventory-priority-list">
                  {data.anomalies.slice(0, 10).map((anomaly) => (
                    <div key={anomaly.id}>
                      <span>
                        <strong>{anomaly.detail}</strong>
                        <small>{dateLabel(anomaly.occurredAt)}</small>
                      </span>
                      <Badge tone={anomaly.severity === "high" ? "danger" : "warning"}>
                        {anomaly.kind.replaceAll("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Sem anomalias abertas"
                  description="Transferências, temperatura e lotes estão dentro das regras."
                  icon="✓"
                />
              )}
            </Card>
            <Card>
              <div className="inventory-section-header">
                <div>
                  <p className="eyebrow">Compras</p>
                  <h2>Sugestões de reposição</h2>
                </div>
                <Badge>{data.purchaseSuggestions.length}</Badge>
              </div>
              {data.purchaseSuggestions.slice(0, 10).map((suggestion) => (
                <p key={suggestion.inventoryItemId}>
                  <strong>{suggestion.inventoryItemName}</strong>
                  <br />
                  <small>
                    Comprar {suggestion.suggestedPurchaseQuantity.toLocaleString("pt-BR")} · prazo{" "}
                    {suggestion.leadTimeDays} dia(s)
                  </small>
                </p>
              ))}
            </Card>
            <Card>
              <div className="inventory-section-header">
                <div>
                  <p className="eyebrow">Produção</p>
                  <h2>Rendimento real</h2>
                </div>
              </div>
              {data.productionVariances.slice(0, 10).map((variance) => (
                <p key={variance.productionBatchId}>
                  <strong>{itemById.get(variance.inventoryItemId)?.name ?? "Item"}</strong>
                  <br />
                  <small>
                    Planejado {variance.plannedQuantity.toLocaleString("pt-BR")} · variação{" "}
                    {variance.variancePercent?.toLocaleString("pt-BR") ?? "-"}%
                  </small>
                </p>
              ))}
            </Card>
            <DepositCard busy={busy} data={data} onRun={run} scope={scope} />
          </div>

          <Card>
            <div className="inventory-section-header inventory-section-header--wrap">
              <div>
                <p className="eyebrow">Identificação</p>
                <h2>Etiquetas QR</h2>
                <p>Imprime locais, itens e lotes ativos para leitura no celular.</p>
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      printInventoryLabels([
                        ...inventory.locations
                          .filter((location) => location.active)
                          .map((location) => ({
                            title: location.name,
                            detail: "Local de estoque",
                            code: location.id,
                          })),
                        ...inventory.items
                          .filter((item) => item.active)
                          .map((item) => ({
                            title: item.name,
                            detail: item.sku ?? item.unit,
                            code: item.barcode ?? item.sku ?? item.id,
                          })),
                        ...inventory.lots
                          .filter((lot) => lot.quantity > 0)
                          .map((lot) => ({
                            title: itemById.get(lot.inventoryItemId)?.name ?? "Lote",
                            detail: `${lot.batchCode} · ${locationById.get(lot.locationId)?.name ?? "Local"}`,
                            code: lot.batchCode,
                          })),
                      ]),
                    "Etiquetas preparadas para impressão.",
                  )
                }
              >
                Imprimir etiquetas
              </Button>
            </div>
          </Card>
          {message && (
            <Toast message={message.text} onDismiss={() => setMessage(null)} tone={message.tone} />
          )}
        </div>
      )}
    </RemoteGate>
  );
}

type Run = (action: () => Promise<unknown>, success: string) => Promise<void>;

interface ControlCardProps {
  busy: boolean;
  data: InventoryControlsData;
  inventory: InventoryData;
  onRun: Run;
  scope: ManagementScope;
}

function BlindCountCard({
  busy,
  data,
  inventory,
  onRun,
  onQueued,
  scope,
}: ControlCardProps & {
  onQueued: (status: ReturnType<typeof inventoryOfflineStatus>) => void;
}) {
  const [locationId, setLocationId] = useState(inventory.locations[0]?.id ?? "");
  const [scheduleId, setScheduleId] = useState("");
  const [reason, setReason] = useState("Conferência operacional do setor");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const open = data.countSessions.find((session) => session.status === "open");
  const submitted = data.countSessions.find((session) => session.status === "submitted");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (open) {
      const body = {
        lines: open.lines.map((line) => ({
          lineId: line.id,
          countedQuantity: counts[line.id] ?? "0",
        })),
        capturedAt: new Date().toISOString(),
        offline: !navigator.onLine,
      };
      const key = operationalKey("blind-count-submit");
      if (!navigator.onLine)
        return onQueued(
          enqueueInventoryAction(scope, {
            kind: "count",
            sessionId: open.id,
            body,
            idempotencyKey: key,
          }),
        );
      void onRun(
        () =>
          api.management.submitBlindInventoryCount(
            scope.organizationId,
            scope.unitId,
            open.id,
            body,
            key,
          ),
        "Contagem enviada para conferência.",
      );
      return;
    }
    void onRun(
      () =>
        api.management.startBlindInventoryCount(
          scope.organizationId,
          scope.unitId,
          { locationId, reason, scheduleIds: scheduleId ? [scheduleId] : undefined },
          operationalKey("blind-count-start"),
        ),
      "Contagem cega iniciada.",
    );
  };
  return (
    <Card>
      <div className="inventory-section-header">
        <div>
          <p className="eyebrow">Duplo controle</p>
          <h2>Contagem cega</h2>
        </div>
        <Badge tone={submitted ? "warning" : open ? "info" : "success"}>
          {submitted ? "Revisar" : open ? "Em curso" : "Livre"}
        </Badge>
      </div>
      <form className="gm-form-stack" onSubmit={submit}>
        {!open && !submitted && (
          <>
            <Label>
              <span>Setor</span>
              <NativeSelect
                required
                value={locationId}
                onChange={(event) => {
                  setLocationId(event.target.value);
                  setScheduleId("");
                }}
              >
                {inventory.locations
                  .filter((item) => item.active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </NativeSelect>
            </Label>
            <Label>
              <span>Escopo</span>
              <NativeSelect
                value={scheduleId}
                onChange={(event) => setScheduleId(event.target.value)}
              >
                <option value="">Todos os itens do setor</option>
                {inventory.countSchedules
                  .filter((schedule) => schedule.locationId === locationId)
                  .map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      Classe {schedule.classification} ·{" "}
                      {inventory.items.find((item) => item.id === schedule.inventoryItemId)?.name ??
                        "Item"}
                    </option>
                  ))}
              </NativeSelect>
            </Label>
            <Label>
              <span>Motivo</span>
              <Input
                minLength={3}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Label>
            <Button disabled={busy || !locationId} type="submit">
              Iniciar sem exibir saldo
            </Button>
          </>
        )}
        {open && (
          <>
            <p>
              {locationBy(inventory, open.locationId)} · informe todos os itens sem consultar o
              saldo esperado.
            </p>
            {open.lines.map((line) => (
              <Label key={line.id}>
                <span>
                  {itemBy(inventory, line.inventoryItemId)}
                  {line.lotId ? ` · ${lotBy(inventory, line.lotId)}` : ""}
                </span>
                <Input
                  inputMode="decimal"
                  min="0"
                  required
                  step="0.001"
                  value={counts[line.id] ?? ""}
                  onChange={(event) =>
                    setCounts((current) => ({ ...current, [line.id]: event.target.value }))
                  }
                />
              </Label>
            ))}
            <Button disabled={busy || open.lines.some((line) => !counts[line.id])} type="submit">
              Enviar conferência
            </Button>
          </>
        )}
        {submitted && (
          <>
            <p>
              {locationBy(inventory, submitted.locationId)} · divergências agora estão visíveis ao
              autorizador.
            </p>
            {submitted.lines.map((line) => (
              <p key={line.id}>
                <strong>{itemBy(inventory, line.inventoryItemId)}</strong> · esperado{" "}
                {line.expectedQuantity} · contado {line.countedQuantity} · diferença{" "}
                {line.differenceQuantity}
              </p>
            ))}
            <div className="inventory-command-bar__actions">
              <Button
                disabled={busy || !data.capabilities.canReviewCount}
                onClick={() => reviewCount(onRun, scope, submitted.id, "approved")}
              >
                Aprovar e aplicar
              </Button>
              <Button
                disabled={busy || !data.capabilities.canReviewCount}
                onClick={() => reviewCount(onRun, scope, submitted.id, "rejected")}
                variant="secondary"
              >
                Rejeitar
              </Button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
}

function reviewCount(
  onRun: Run,
  scope: ManagementScope,
  sessionId: string,
  decision: "approved" | "rejected",
) {
  const note = window.prompt("Justificativa da decisão (mínimo 5 caracteres):")?.trim();
  if (!note || note.length < 5) return;
  void onRun(
    () =>
      api.management.reviewBlindInventoryCount(
        scope.organizationId,
        scope.unitId,
        sessionId,
        { decision, note },
        operationalKey("blind-count-review"),
      ),
    decision === "approved" ? "Contagem aprovada e saldo ajustado." : "Contagem rejeitada.",
  );
}

function SectorPolicyCard({ busy, data, inventory, onRun, scope }: ControlCardProps) {
  const [locationId, setLocationId] = useState(inventory.locations[0]?.id ?? "");
  const current = data.policies.find((item) => item.locationId === locationId);
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  return (
    <Card>
      <div className="inventory-section-header">
        <div>
          <p className="eyebrow">Política do setor</p>
          <h2>Conferência e frio</h2>
        </div>
      </div>
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onRun(
            () =>
              api.management.configureInventorySectorPolicy(
                scope.organizationId,
                scope.unitId,
                locationId,
                {
                  blindCountRequired: true,
                  requireDistinctCountReviewer: true,
                  scanRequired: true,
                  offlineAllowed: true,
                  temperatureMinimumCelsius: minimum === "" ? null : Number(minimum),
                  temperatureMaximumCelsius: maximum === "" ? null : Number(maximum),
                },
              ),
            "Política atualizada.",
          );
        }}
      >
        <Label>
          <span>Setor</span>
          <NativeSelect
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setMinimum("");
              setMaximum("");
            }}
          >
            {inventory.locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <div className="gm-form-grid">
          <Label>
            <span>Mínima °C</span>
            <Input
              inputMode="decimal"
              placeholder={
                current?.temperatureMinMilli == null
                  ? "Sem controle"
                  : String(current.temperatureMinMilli / 1000)
              }
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
            />
          </Label>
          <Label>
            <span>Máxima °C</span>
            <Input
              inputMode="decimal"
              placeholder={
                current?.temperatureMaxMilli == null
                  ? "Sem controle"
                  : String(current.temperatureMaxMilli / 1000)
              }
              value={maximum}
              onChange={(event) => setMaximum(event.target.value)}
            />
          </Label>
        </div>
        <p>Contagem cega, revisor distinto, leitura QR e fila offline permanecem obrigatórios.</p>
        <Button
          disabled={busy || !locationId || (minimum === "") !== (maximum === "")}
          type="submit"
        >
          Salvar política
        </Button>
      </form>
    </Card>
  );
}

function TemperatureCard({
  busy,
  data,
  inventory,
  onQueued,
  onRun,
  scope,
}: ControlCardProps & {
  onQueued: (status: ReturnType<typeof inventoryOfflineStatus>) => void;
}) {
  const [locationId, setLocationId] = useState(inventory.locations[0]?.id ?? "");
  const [celsius, setCelsius] = useState("");
  const latest = data.temperatureReadings.slice(0, 5);
  return (
    <Card>
      <div className="inventory-section-header">
        <div>
          <p className="eyebrow">Cadeia fria</p>
          <h2>Temperatura</h2>
        </div>
      </div>
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          const body = {
            locationId,
            celsius: Number(celsius),
            source: "manual" as const,
            occurredAt: new Date().toISOString(),
          };
          const key = operationalKey("inventory-temperature");
          if (!navigator.onLine) {
            onQueued(
              enqueueInventoryAction(scope, { kind: "temperature", body, idempotencyKey: key }),
            );
            return;
          }
          void onRun(
            () =>
              api.management.recordInventoryTemperature(
                scope.organizationId,
                scope.unitId,
                body,
                key,
              ),
            "Temperatura registrada.",
          );
        }}
      >
        <Label>
          <span>Setor</span>
          <NativeSelect value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {inventory.locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label>
          <span>Temperatura °C</span>
          <Input
            inputMode="decimal"
            max="100"
            min="-100"
            required
            step="0.1"
            value={celsius}
            onChange={(event) => setCelsius(event.target.value)}
          />
        </Label>
        <Button disabled={busy || !celsius} type="submit">
          Registrar leitura
        </Button>
        {latest.map((reading) => (
          <p key={reading.id}>
            <Badge
              tone={
                reading.status === "critical"
                  ? "danger"
                  : reading.status === "warning"
                    ? "warning"
                    : "success"
              }
            >
              {reading.status}
            </Badge>{" "}
            {locationBy(inventory, reading.locationId)} ·{" "}
            {(reading.celsiusMilli / 1000).toLocaleString("pt-BR")} °C
          </p>
        ))}
      </form>
    </Card>
  );
}

function LotHoldCard({ busy, data, inventory, onRun, scope }: ControlCardProps) {
  const [lotId, setLotId] = useState(inventory.lots[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const active = data.lotHolds.filter((item) => item.status === "active");
  return (
    <Card>
      <div className="inventory-section-header">
        <div>
          <p className="eyebrow">Segurança</p>
          <h2>Quarentena de lote</h2>
        </div>
        <Badge tone={active.length ? "warning" : "success"}>{active.length}</Badge>
      </div>
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onRun(
            () =>
              api.management.holdInventoryLot(
                scope.organizationId,
                scope.unitId,
                lotId,
                { reason },
                operationalKey("inventory-lot-hold"),
              ),
            "Lote bloqueado para consumo.",
          );
        }}
      >
        <Label>
          <span>Lote</span>
          <NativeSelect value={lotId} onChange={(event) => setLotId(event.target.value)}>
            {inventory.lots
              .filter((item) => item.quantity > 0)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {itemBy(inventory, item.inventoryItemId)} · {item.batchCode}
                </option>
              ))}
          </NativeSelect>
        </Label>
        <Label>
          <span>Motivo</span>
          <Input
            minLength={5}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Label>
        <Button disabled={busy || !lotId || reason.trim().length < 5} type="submit">
          Colocar em quarentena
        </Button>
        {active.map((hold) => (
          <div key={hold.id}>
            <strong>{lotBy(inventory, hold.lotId)}</strong>
            <p>{hold.reason}</p>
            <Button
              disabled={busy || !data.capabilities.canReleaseLot}
              onClick={() => {
                const releaseReason = window.prompt("Motivo da liberação:")?.trim();
                if (releaseReason && releaseReason.length >= 5)
                  void onRun(
                    () =>
                      api.management.releaseInventoryLot(
                        scope.organizationId,
                        scope.unitId,
                        hold.lotId,
                        hold.id,
                        { reason: releaseReason },
                        operationalKey("inventory-lot-release"),
                      ),
                    "Lote liberado.",
                  );
              }}
              size="sm"
              variant="secondary"
            >
              Liberar
            </Button>
          </div>
        ))}
      </form>
    </Card>
  );
}

function DepositCard({ busy, data, onRun, scope }: Omit<ControlCardProps, "inventory">) {
  return (
    <Card>
      <div className="inventory-section-header">
        <div>
          <p className="eyebrow">Vasilhames</p>
          <h2>Cauções pendentes</h2>
        </div>
        <Badge tone={data.returnableDepositMode === "manual" ? "neutral" : "success"}>
          {data.returnableDepositMode === "manual"
            ? data.returnableDepositExposures.length
            : "Desligada"}
        </Badge>
      </div>
      {data.returnableDepositExposures.length ? (
        data.returnableDepositExposures.map((exposure) => (
          <div key={exposure.orderId}>
            <p>
              <strong>Pedido {exposure.orderId.slice(0, 8)}</strong>
              <br />
              <small>
                {exposure.quantity.toLocaleString("pt-BR")} vasilhame(s) ·{" "}
                {formatMoney(exposure.amountCents)}
              </small>
            </p>
            {exposure.charge ? (
              <div className="inventory-command-bar__actions">
                <Badge tone="success">Caução lançada</Badge>
                <Button
                  disabled={busy || !data.capabilities.canChargeDeposit}
                  onClick={() => {
                    const reason = window.prompt("Motivo da reconciliação da caução:")?.trim();
                    if (!reason || reason.length < 5) return;
                    void onRun(
                      () =>
                        api.management.reconcileReturnableDepositCharge(
                          scope.organizationId,
                          scope.unitId,
                          exposure.charge?.id ?? "",
                          { reason },
                          operationalKey("returnable-deposit-reconcile"),
                        ),
                      "Reconciliação registrada. Se a caução já foi recebida, conclua o estorno no Financeiro.",
                    );
                  }}
                  size="sm"
                  variant="secondary"
                >
                  Reconciliar retorno
                </Button>
                <Button
                  disabled={busy || !data.capabilities.canChargeDeposit}
                  onClick={() => {
                    const reason = window.prompt("Motivo do cancelamento da caução:")?.trim();
                    if (!reason || reason.length < 5) return;
                    void onRun(
                      () =>
                        api.management.cancelReturnableDepositCharge(
                          scope.organizationId,
                          scope.unitId,
                          exposure.charge?.id ?? "",
                          { reason },
                          operationalKey("returnable-deposit-cancel"),
                        ),
                      "Caução cancelada.",
                    );
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button
                disabled={
                  busy ||
                  !data.capabilities.canChargeDeposit ||
                  data.returnableDepositMode !== "manual"
                }
                onClick={() =>
                  void onRun(
                    () =>
                      api.management.chargeReturnableDeposit(
                        scope.organizationId,
                        scope.unitId,
                        {
                          orderId: exposure.orderId,
                          dueDate: new Date().toISOString().slice(0, 10),
                        },
                        operationalKey("returnable-deposit"),
                      ),
                    "Caução lançada no financeiro.",
                  )
                }
                size="sm"
              >
                Lançar caução
              </Button>
            )}
          </div>
        ))
      ) : (
        <EmptyState
          title="Sem cauções pendentes"
          description={
            data.returnableDepositMode === "manual"
              ? "Nenhum pedido possui vasilhame aberto com valor configurado."
              : "A caução está desligada para esta unidade. O controle de retorno continua ativo."
          }
          icon="✓"
        />
      )}
    </Card>
  );
}

const itemBy = (inventory: InventoryData, id: string) =>
  inventory.items.find((item) => item.id === id)?.name ?? "Item";
const locationBy = (inventory: InventoryData, id: string) =>
  inventory.locations.find((item) => item.id === id)?.name ?? "Setor";
const lotBy = (inventory: InventoryData, id: string) =>
  inventory.lots.find((item) => item.id === id)?.batchCode ?? "Lote";
