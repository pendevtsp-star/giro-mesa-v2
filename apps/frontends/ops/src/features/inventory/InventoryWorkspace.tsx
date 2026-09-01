import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  NativeSelect,
  SearchField,
  SegmentedTabs,
  StatCard,
} from "@giromesa/ui";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  InventoryData,
  InventoryItem,
  InventoryItemKind,
  InventoryPendingAction,
  StockLocation,
} from "../../management.shared";
import { dateLabel } from "../../management.shared";
import { formatMoney } from "../../rules";

export type InventoryView =
  | "overview"
  | "pending"
  | "planning"
  | "balances"
  | "counts"
  | "movements"
  | "lots"
  | "transfers"
  | "returnables"
  | "assets"
  | "controls"
  | "recipes"
  | "settings";

export type InventoryDialog =
  | "location"
  | "item"
  | "event"
  | "transfer"
  | "lot"
  | "returnable-conference"
  | "returnable-incident"
  | "returnable-review"
  | "returnable-supplier-exchange"
  | "returnable-supplier-resolution"
  | "inventory-review"
  | "transfer-resolution"
  | "asset"
  | "scan"
  | "reservation"
  | "reservation-resolution"
  | "production"
  | "production-complete"
  | "interunit-transfer"
  | "interunit-receive"
  | "closing"
  | "location-item-setting"
  | "issue-route";

const kindLabels: Record<InventoryItemKind, string> = {
  ingredient: "Insumo",
  prepared: "Preparado",
  resale: "Revenda",
  reusable: "Utensílio/mobiliário",
  returnable_container: "Vasilhame",
};

function itemKind(item: InventoryItem): InventoryItemKind {
  return item.kind ?? "ingredient";
}

interface ItemSummary {
  item: InventoryItem;
  quantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
  inTransitQuantity: number;
  availableQuantity: number;
  valueCents: number;
  averageCostCents: number | null;
  low: boolean;
  zero: boolean;
}

function movementLabel(type: string): string {
  const labels: Record<string, string> = {
    count: "Contagem",
    loss: "Perda",
    adjustment: "Ajuste",
    transfer_in: "Transferência recebida",
    transfer_out: "Transferência enviada",
    purchase_receipt: "Recebimento de compra",
    order_consumption: "Baixa por venda",
    lot_receipt: "Entrada de lote",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

function movementTone(delta: number): "success" | "danger" | "info" {
  if (delta > 0) return "success";
  if (delta < 0) return "danger";
  return "info";
}

function expiryState(expiresAt: string | null): {
  label: string;
  tone: "danger" | "warning" | "info";
} {
  if (!expiresAt) return { label: "Sem validade", tone: "info" };
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: "Vencido", tone: "danger" };
  if (days <= 7) return { label: `Vence em ${days} dia(s)`, tone: "warning" };
  return { label: `Vence em ${days} dias`, tone: "info" };
}

export function InventoryWorkspace({
  data,
  currentUnitId,
  view,
  onViewChange,
  onOpen,
  onEditItem,
  onEditLocation,
  onArchiveItem,
  onArchiveLocation,
  canApproveInventoryRisk,
  canResolveTransfers,
  canManageAssets,
  onReviewReturnableIncident,
  onResolveSupplierExchange,
  onReviewInventoryRequest,
  onResolveTransfer,
  onEditAsset,
  onResolveReservation,
  onCompleteProduction,
  onCancelProduction,
  onReceiveInterunitTransfer,
  onCancelInterunitTransfer,
  onGenerateCyclePlan,
  scannedCode,
  controls,
  returnablesPanel,
  recipes,
  realtimeStatus,
}: {
  data: InventoryData;
  currentUnitId: string;
  view: InventoryView;
  onViewChange: (view: InventoryView) => void;
  onOpen: (dialog: InventoryDialog) => void;
  onEditItem: (item: InventoryItem) => void;
  onEditLocation: (location: StockLocation) => void;
  onArchiveItem: (item: InventoryItem) => void;
  onArchiveLocation: (location: StockLocation) => void;
  canApproveInventoryRisk: boolean;
  canResolveTransfers: boolean;
  canManageAssets: boolean;
  onReviewReturnableIncident: (incidentId: string) => void;
  onResolveSupplierExchange: (exchangeId: string) => void;
  onReviewInventoryRequest: (requestId: string) => void;
  onResolveTransfer: (transferId: string) => void;
  onEditAsset: (assetId: string) => void;
  onResolveReservation: (reservationId: string) => void;
  onCompleteProduction: (batchId: string) => void;
  onCancelProduction: (batchId: string) => void;
  onReceiveInterunitTransfer: (transferId: string) => void;
  onCancelInterunitTransfer: (transferId: string) => void;
  onGenerateCyclePlan: () => void;
  scannedCode?: string;
  controls: ReactNode;
  returnablesPanel: ReactNode;
  recipes: ReactNode;
  realtimeStatus: "connecting" | "live" | "polling";
}) {
  const [query, setQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState<"all" | InventoryItemKind>("all");
  useEffect(() => {
    if (!scannedCode) return;
    setQuery(scannedCode);
    onViewChange("balances");
  }, [onViewChange, scannedCode]);
  const returnableIncidents = data.returnableIncidents ?? [];
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);
  const locationById = useMemo(
    () => new Map(data.locations.map((location) => [location.id, location])),
    [data.locations],
  );
  const returnableSectorPositions = [
    ...new Set(
      [
        ...(data.physicalByLocation ?? []),
        ...(data.custodyByLocation ?? []),
        ...(data.fullContainersByLocation ?? []),
      ].map((position) => `${position.inventoryItemId}:${position.locationId}`),
    ),
  ].map((key) => {
    const [inventoryItemId, locationId] = key.split(":");
    return { inventoryItemId: inventoryItemId ?? "", locationId: locationId ?? "" };
  });
  const summaries = useMemo<ItemSummary[]>(
    () =>
      data.items.map((item) => {
        const balances = data.balances.filter((balance) => balance.inventoryItemId === item.id);
        const quantity = balances.reduce((sum, balance) => sum + balance.quantity, 0);
        const reservedQuantity = balances.reduce(
          (sum, balance) => sum + balance.reservedQuantity,
          0,
        );
        const blockedQuantity = balances.reduce((sum, balance) => sum + balance.blockedQuantity, 0);
        const availableQuantity = balances.reduce(
          (sum, balance) => sum + balance.availableQuantity,
          0,
        );
        const inTransitQuantity = data.inTransitBalances
          .filter((balance) => balance.inventoryItemId === item.id)
          .reduce((sum, balance) => sum + balance.quantity, 0);
        const valueCents = balances.reduce(
          (sum, balance) => sum + balance.quantity * (balance.averageCostCents ?? 0),
          0,
        );
        return {
          item,
          quantity,
          reservedQuantity,
          blockedQuantity,
          inTransitQuantity,
          availableQuantity,
          valueCents,
          averageCostCents: quantity > 0 ? Math.round(valueCents / quantity) : null,
          low: item.active && availableQuantity > 0 && availableQuantity <= item.minimumQuantity,
          zero: item.active && availableQuantity <= 0,
        };
      }),
    [data.balances, data.inTransitBalances, data.items],
  );
  const lowCount = summaries.filter((summary) => summary.low).length;
  const zeroCount = summaries.filter((summary) => summary.zero).length;
  const stockValue = summaries.reduce((sum, summary) => sum + summary.valueCents, 0);
  const expiringLots = data.lots.filter((lot) => {
    if (!lot.expiresAt || lot.quantity <= 0) return false;
    const days = (new Date(lot.expiresAt).getTime() - Date.now()) / 86_400_000;
    return days <= 7;
  });
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const visibleSummaries = summaries.filter((summary) => {
    const statusMatches =
      statusFilter === "all" ||
      (statusFilter === "zero" && summary.zero) ||
      (statusFilter === "low" && summary.low) ||
      (statusFilter === "normal" && !summary.low && !summary.zero && summary.item.active) ||
      (statusFilter === "inactive" && !summary.item.active);
    const locationMatches =
      locationFilter === "all" ||
      data.balances.some(
        (balance) =>
          balance.inventoryItemId === summary.item.id && balance.locationId === locationFilter,
      );
    return (
      statusMatches &&
      (kindFilter === "all" || itemKind(summary.item) === kindFilter) &&
      locationMatches &&
      (!normalizedQuery ||
        summary.item.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        summary.item.sku?.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        summary.item.barcode?.includes(normalizedQuery))
    );
  });
  const latestCount = data.recentMovements.find((movement) => movement.type === "count");

  return (
    <div className="inventory-workspace">
      <section className="inventory-observability" aria-label="Resumo do estoque">
        <StatCard
          title="Valor em estoque"
          value={formatMoney(Math.round(stockValue))}
          icon="finance"
          footer={`${summaries.length} item(ns)`}
        />
        <StatCard
          title="Itens zerados"
          value={zeroCount}
          icon="alert-circle"
          footer={zeroCount ? "Ação imediata" : "Operação normal"}
        />
        <StatCard
          title="Abaixo do mínimo"
          value={lowCount}
          icon="arrow-down"
          footer={lowCount ? "Revisar reposição" : "Sem rupturas previstas"}
        />
        <StatCard
          title="Validades críticas"
          value={expiringLots.length}
          icon="clock"
          footer="Próximos 7 dias"
        />
      </section>

      <div className="inventory-command-bar gm-toolbar">
        <Badge tone={realtimeStatus === "live" ? "success" : "warning"}>
          {realtimeStatus === "live"
            ? "Saldo ao vivo"
            : realtimeStatus === "polling"
              ? "Atualização periódica"
              : "Conectando"}
        </Badge>
        <SegmentedTabs
          active={view}
          items={[
            { id: "overview", label: "Visão geral" },
            {
              id: "returnables",
              label: "Vasilhames",
              count:
                (data.openCustodies?.length ?? 0) +
                returnableIncidents.filter((incident) => incident.status === "pending").length,
            },
            { id: "pending", label: "Pendências", count: data.pendingActions.length },
            {
              id: "planning",
              label: "Planejamento",
              count:
                data.reservations.filter((item) => item.status === "active").length +
                data.productionBatches.filter((item) => item.status === "planned").length,
            },
            { id: "balances", label: "Saldos", count: summaries.length },
            { id: "counts", label: "Contagem" },
            { id: "movements", label: "Movimentações", count: data.recentMovements.length },
            { id: "lots", label: "Lotes", count: data.lots.length },
            {
              id: "transfers",
              label: "Transferências",
              count: data.transfers.filter((transfer) => transfer.status === "in_transit").length,
            },
            { id: "assets", label: "Ativos", count: data.assets.length },
            { id: "controls", label: "Controles", count: data.pendingActions.length },
            { id: "recipes", label: "Fichas técnicas" },
            { id: "settings", label: "Configurações" },
          ]}
          label="Seções do estoque"
          onChange={onViewChange}
        />
        <div className="inventory-command-bar__actions">
          <Button onClick={() => onOpen("event")} size="sm">
            <Icon name="check" size={15} /> Contar / ajustar
          </Button>
          <Button onClick={() => onOpen("transfer")} size="sm" variant="secondary">
            <Icon name="refresh" size={15} /> Transferir
          </Button>
          <Button onClick={() => onOpen("item")} size="sm" variant="secondary">
            <Icon name="plus" size={15} /> Novo item
          </Button>
          <Button onClick={() => onOpen("scan")} size="sm" variant="ghost">
            Ler código
          </Button>
        </div>
      </div>

      {data.automation.failed > 0 ? (
        <div className="inventory-system-status inventory-system-status--danger" role="alert">
          <Icon name="alert-circle" size={18} />
          <span>
            <strong>Baixa automática requer atenção</strong>
            <small>{data.automation.failed} evento(s) aguardando correção do processamento.</small>
          </span>
        </div>
      ) : (
        <div className="inventory-system-status" role="status">
          <Icon name="check" size={18} />
          <span>
            <strong>Baixa automática operacional</strong>
            <small>
              {data.automation.pending
                ? `${data.automation.pending} evento(s) na fila.`
                : "Fila processada."}{" "}
              {data.automation.lastProcessedAt
                ? `Última execução ${dateLabel(data.automation.lastProcessedAt)}.`
                : ""}
            </small>
          </span>
        </div>
      )}

      {(!data.locations.length || !data.items.length || !data.balances.length) && (
        <Card className="inventory-onboarding">
          <div>
            <p className="eyebrow">Configuração inicial</p>
            <h2>Prepare o estoque em três passos</h2>
            <p>Conclua a base operacional antes de configurar as fichas técnicas.</p>
          </div>
          <ol>
            <li data-complete={data.locations.length > 0}>
              <span>1</span>
              <strong>Criar locais</strong>
              <small>Depósito, cozinha e bar.</small>
              <Button onClick={() => onOpen("location")} size="sm" variant="secondary">
                {data.locations.length ? "Adicionar outro" : "Criar local"}
              </Button>
            </li>
            <li data-complete={data.items.length > 0}>
              <span>2</span>
              <strong>Cadastrar itens</strong>
              <small>Unidades, mínimos e fornecedores.</small>
              <Button
                disabled={!data.locations.length}
                onClick={() => onOpen("item")}
                size="sm"
                variant="secondary"
              >
                {data.items.length ? "Adicionar outro" : "Cadastrar item"}
              </Button>
            </li>
            <li data-complete={data.balances.length > 0}>
              <span>3</span>
              <strong>Lançar saldo inicial</strong>
              <small>Conte vários itens de uma vez.</small>
              <Button
                disabled={!data.locations.length || !data.items.length}
                onClick={() => onOpen("event")}
                size="sm"
                variant="secondary"
              >
                Iniciar contagem
              </Button>
            </li>
          </ol>
        </Card>
      )}

      {view === "overview" && (
        <div className="inventory-overview-grid">
          <Card className="inventory-priority-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Central operacional</p>
                <h2>Pendências prioritárias</h2>
              </div>
              <Badge tone={data.pendingActions.length ? "warning" : "success"}>
                {data.pendingActions.length}
              </Badge>
            </div>
            <PendingActionList
              actions={data.pendingActions}
              canApproveInventoryRisk={canApproveInventoryRisk}
              canResolveTransfers={canResolveTransfers}
              limit={5}
              onOpenPurchases={() => {
                window.location.hash = "/purchases";
              }}
              onReviewInventoryRequest={onReviewInventoryRequest}
              onReviewReturnableIncident={onReviewReturnableIncident}
              onResolveTransfer={onResolveTransfer}
            />
          </Card>
          <Card className="inventory-priority-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Próxima ação</p>
                <h2>Reposição prioritária</h2>
              </div>
              <Badge tone={zeroCount ? "danger" : lowCount ? "warning" : "success"}>
                {zeroCount + lowCount} item(ns)
              </Badge>
            </div>
            {summaries.filter((summary) => summary.zero || summary.low).length ? (
              <div className="inventory-priority-list">
                {summaries
                  .filter((summary) => summary.zero || summary.low)
                  .slice(0, 8)
                  .map((summary) => (
                    <Button
                      key={summary.item.id}
                      onClick={() => {
                        setStatusFilter(summary.zero ? "zero" : "low");
                        onViewChange("balances");
                      }}
                      type="button"
                    >
                      <span>
                        <strong>{summary.item.name}</strong>
                        <small>
                          Mínimo {summary.item.minimumQuantity} {summary.item.unit}
                        </small>
                      </span>
                      <span>
                        <Badge tone={summary.zero ? "danger" : "warning"}>
                          {summary.zero ? "Zerado" : "Repor"}
                        </Badge>
                        <strong>
                          {summary.quantity.toLocaleString("pt-BR")} {summary.item.unit}
                        </strong>
                      </span>
                    </Button>
                  ))}
              </div>
            ) : (
              <EmptyState
                title="Estoque dentro dos limites"
                description="Nenhum item ativo está zerado ou abaixo do mínimo."
                icon="✓"
              />
            )}
          </Card>
          <Card className="inventory-priority-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Rastreabilidade</p>
                <h2>Lotes e validades</h2>
              </div>
              <Button onClick={() => onOpen("lot")} size="sm" variant="secondary">
                Registrar lote
              </Button>
            </div>
            {expiringLots.length ? (
              <div className="inventory-priority-list">
                {expiringLots.slice(0, 8).map((lot) => {
                  const state = expiryState(lot.expiresAt);
                  return (
                    <Button key={lot.id} onClick={() => onViewChange("lots")} type="button">
                      <span>
                        <strong>{itemById.get(lot.inventoryItemId)?.name ?? "Item"}</strong>
                        <small>
                          {lot.batchCode} · {locationById.get(lot.locationId)?.name}
                        </small>
                      </span>
                      <span>
                        <Badge tone={state.tone}>{state.label}</Badge>
                        <strong>{lot.quantity.toLocaleString("pt-BR")}</strong>
                      </span>
                    </Button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="Sem vencimentos críticos"
                description="Nenhum lote vence nos próximos sete dias."
                icon="◇"
              />
            )}
          </Card>
          <Card className="inventory-recent-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Auditoria</p>
                <h2>Movimentações recentes</h2>
              </div>
              <Button onClick={() => onViewChange("movements")} size="sm" variant="ghost">
                Ver histórico
              </Button>
            </div>
            <MovementList data={data} limit={6} />
          </Card>
          <Card className="inventory-data-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Fluxo físico por setor</p>
                <h2>Cheios, vazios e fornecedor</h2>
              </div>
            </div>
            <div className="inventory-settings-list">
              {returnableSectorPositions.map((position) => {
                const physical =
                  (data.physicalByLocation ?? []).find(
                    (value) =>
                      value.inventoryItemId === position.inventoryItemId &&
                      value.locationId === position.locationId,
                  )?.physicalQuantity ?? 0;
                const full =
                  (data.fullContainersByLocation ?? []).find(
                    (value) =>
                      value.inventoryItemId === position.inventoryItemId &&
                      value.locationId === position.locationId,
                  )?.quantity ?? 0;
                const expected =
                  (data.custodyByLocation ?? []).find(
                    (value) =>
                      value.inventoryItemId === position.inventoryItemId &&
                      value.locationId === position.locationId,
                  )?.expectedQuantity ?? 0;
                return (
                  <div key={`${position.inventoryItemId}:${position.locationId}`}>
                    <span>
                      <strong>{itemById.get(position.inventoryItemId)?.name ?? "Vasilhame"}</strong>
                      <small>{locationById.get(position.locationId)?.name ?? "Setor"}</small>
                    </span>
                    <span>
                      <small>Cheios equivalentes {full.toLocaleString("pt-BR")}</small>
                      <small>Retorno previsto {expected.toLocaleString("pt-BR")}</small>
                      <strong>Vazios {physical.toLocaleString("pt-BR")}</strong>
                    </span>
                  </div>
                );
              })}
              {(data.supplierExchanges ?? [])
                .filter((exchange) => exchange.status === "in_transit")
                .map((exchange) => (
                  <div key={exchange.id}>
                    <span>
                      <strong>
                        Fornecedor · {itemById.get(exchange.inventoryItemId)?.name ?? "Vasilhame"}
                      </strong>
                      <small>
                        {exchange.quantity.toLocaleString("pt-BR")} em trânsito desde{" "}
                        {dateLabel(exchange.sentAt)}
                      </small>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onResolveSupplierExchange(exchange.id)}
                    >
                      Conferir retorno
                    </Button>
                  </div>
                ))}
              {(data.lossIndicators ?? []).map((indicator) => (
                <div key={`${indicator.kind}:${indicator.locationId ?? "all"}`}>
                  <span>
                    <strong>{indicator.kind.replaceAll("_", " ")}</strong>
                    <small>
                      {locationById.get(indicator.locationId ?? "")?.name ?? "Todos os setores"} ·{" "}
                      {indicator.incidentCount} ocorrência(s)
                    </small>
                  </span>
                  <Badge tone="danger">
                    {indicator.quantity.toLocaleString("pt-BR")} ·{" "}
                    {formatMoney(indicator.estimatedCostCents)}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
          <Card className="inventory-priority-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Mínimo por setor</p>
                <h2>Reposição interna sugerida</h2>
              </div>
              <Badge tone={data.sectorReplenishmentSuggestions.length ? "warning" : "success"}>
                {data.sectorReplenishmentSuggestions.length}
              </Badge>
            </div>
            {data.sectorReplenishmentSuggestions.length ? (
              <div className="inventory-priority-list">
                {data.sectorReplenishmentSuggestions.map((suggestion) => (
                  <article
                    key={`${suggestion.inventoryItemId}:${suggestion.destinationLocationId}`}
                  >
                    <span>
                      <strong>{itemById.get(suggestion.inventoryItemId)?.name ?? "Item"}</strong>
                      <small>
                        {locationById.get(suggestion.sourceLocationId)?.name ?? "Origem"} →{" "}
                        {locationById.get(suggestion.destinationLocationId)?.name ?? "Destino"}
                      </small>
                    </span>
                    <strong>
                      {suggestion.suggestedQuantity.toLocaleString("pt-BR")}{" "}
                      {suggestion.transferUnitLabel ?? "un"}
                    </strong>
                    <Button size="sm" variant="secondary" onClick={() => onOpen("transfer")}>
                      Transferir
                    </Button>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Setores abastecidos"
                description="Nenhum setor está abaixo do mínimo configurado."
                icon="✓"
              />
            )}
          </Card>
        </div>
      )}

      {view === "pending" && (
        <Card className="inventory-data-card">
          <div className="inventory-section-header">
            <div>
              <p className="eyebrow">Próxima ação</p>
              <h2>Central de pendências</h2>
            </div>
            <Badge tone={data.pendingActions.length ? "warning" : "success"}>
              {data.pendingActions.length} aberta(s)
            </Badge>
          </div>
          <PendingActionList
            actions={data.pendingActions}
            canApproveInventoryRisk={canApproveInventoryRisk}
            canResolveTransfers={canResolveTransfers}
            onOpenPurchases={() => {
              window.location.hash = "/purchases";
            }}
            onReviewInventoryRequest={onReviewInventoryRequest}
            onReviewReturnableIncident={onReviewReturnableIncident}
            onResolveTransfer={onResolveTransfer}
          />
        </Card>
      )}

      {view === "planning" && (
        <div className="inventory-overview-grid">
          <Card className="inventory-priority-card">
            <div className="inventory-section-header inventory-section-header--wrap">
              <div>
                <p className="eyebrow">Físico → reservado → disponível</p>
                <h2>Reservas operacionais</h2>
              </div>
              <Button onClick={() => onOpen("reservation")} size="sm">
                Nova reserva
              </Button>
            </div>
            <div className="inventory-priority-list">
              {data.reservations.filter((item) => item.status === "active").length ? (
                data.reservations
                  .filter((item) => item.status === "active")
                  .map((reservation) => (
                    <article key={reservation.id}>
                      <span>
                        <strong>{itemById.get(reservation.inventoryItemId)?.name ?? "Item"}</strong>
                        <small>
                          {locationById.get(reservation.locationId)?.name ?? "Local"} ·{" "}
                          {reservation.reason}
                        </small>
                      </span>
                      <strong>{reservation.quantity.toLocaleString("pt-BR")}</strong>
                      <Button
                        onClick={() => onResolveReservation(reservation.id)}
                        size="sm"
                        variant="ghost"
                      >
                        Resolver
                      </Button>
                    </article>
                  ))
              ) : (
                <p className="inventory-copy">Nenhuma reserva ativa.</p>
              )}
            </div>
          </Card>

          <Card className="inventory-priority-card">
            <div className="inventory-section-header inventory-section-header--wrap">
              <div>
                <p className="eyebrow">ABC por risco e giro</p>
                <h2>Contagem cíclica</h2>
              </div>
              <Button onClick={onGenerateCyclePlan} size="sm" variant="secondary">
                Recalcular plano
              </Button>
            </div>
            <div className="inventory-priority-list">
              {data.countSchedules.slice(0, 8).map((schedule) => (
                <article key={schedule.id}>
                  <span>
                    <strong>{itemById.get(schedule.inventoryItemId)?.name ?? "Item"}</strong>
                    <small>{locationById.get(schedule.locationId)?.name ?? "Local"}</small>
                  </span>
                  <Badge tone={schedule.classification === "A" ? "danger" : "info"}>
                    Classe {schedule.classification} · risco {schedule.riskScore}
                  </Badge>
                  <small>{dateLabel(schedule.nextDueAt)}</small>
                </article>
              ))}
              {!data.countSchedules.length && (
                <p className="inventory-copy">Gere o primeiro plano.</p>
              )}
            </div>
          </Card>

          <Card className="inventory-priority-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Histórico por dia da semana</p>
                <h2>Previsão de demanda</h2>
              </div>
            </div>
            <div className="inventory-priority-list">
              {data.forecasts
                .filter((forecast) => forecast.suggestedPurchaseQuantity > 0)
                .sort(
                  (left, right) => right.suggestedPurchaseQuantity - left.suggestedPurchaseQuantity,
                )
                .slice(0, 8)
                .map((forecast) => (
                  <article key={forecast.inventoryItemId}>
                    <span>
                      <strong>{itemById.get(forecast.inventoryItemId)?.name ?? "Item"}</strong>
                      <small>
                        Demanda {forecast.expectedDemand.toLocaleString("pt-BR")} em{" "}
                        {forecast.horizonDays} dias
                      </small>
                    </span>
                    <Badge tone="warning">
                      Comprar {forecast.suggestedPurchaseQuantity.toLocaleString("pt-BR")}
                    </Badge>
                  </article>
                ))}
              {!data.forecasts.some((forecast) => forecast.suggestedPurchaseQuantity > 0) && (
                <p className="inventory-copy">Sem necessidade prevista de compra.</p>
              )}
            </div>
          </Card>

          <Card className="inventory-priority-card">
            <div className="inventory-section-header inventory-section-header--wrap">
              <div>
                <p className="eyebrow">Rendimento real e custo do lote</p>
                <h2>Produção e pré-preparo</h2>
              </div>
              <Button onClick={() => onOpen("production")} size="sm">
                Planejar produção
              </Button>
            </div>
            <div className="inventory-priority-list">
              {data.productionBatches.slice(0, 8).map((batch) => (
                <article key={batch.id}>
                  <span>
                    <strong>
                      {itemById.get(batch.outputInventoryItemId)?.name ?? "Preparado"}
                    </strong>
                    <small>
                      Lote {batch.batchCode} · planejado{" "}
                      {batch.plannedQuantity.toLocaleString("pt-BR")}
                    </small>
                  </span>
                  <Badge
                    tone={
                      batch.status === "completed"
                        ? "success"
                        : batch.status === "canceled"
                          ? "neutral"
                          : "warning"
                    }
                  >
                    {batch.status === "completed"
                      ? "Concluída"
                      : batch.status === "canceled"
                        ? "Cancelada"
                        : "Planejada"}
                  </Badge>
                  {batch.status === "planned" && (
                    <span className="inventory-command-bar__actions">
                      <Button
                        onClick={() => onCompleteProduction(batch.id)}
                        size="sm"
                        variant="secondary"
                      >
                        Concluir
                      </Button>
                      <Button
                        onClick={() => onCancelProduction(batch.id)}
                        size="sm"
                        variant="ghost"
                      >
                        Cancelar
                      </Button>
                    </span>
                  )}
                </article>
              ))}
              {!data.productionBatches.length && (
                <p className="inventory-copy">Nenhuma produção registrada.</p>
              )}
            </div>
          </Card>

          <Card className="inventory-priority-card">
            <div className="inventory-section-header inventory-section-header--wrap">
              <div>
                <p className="eyebrow">Trânsito entre estabelecimentos</p>
                <h2>Transferências entre unidades</h2>
              </div>
              <Button onClick={() => onOpen("interunit-transfer")} size="sm">
                Novo envio
              </Button>
            </div>
            <div className="inventory-priority-list">
              {data.interunitTransfers.slice(0, 8).map((transfer) => (
                <article key={transfer.id}>
                  <span>
                    <strong>
                      {data.organizationUnits.find((unit) => unit.id === transfer.sourceUnitId)
                        ?.name ?? "Origem"}{" "}
                      →{" "}
                      {data.organizationUnits.find((unit) => unit.id === transfer.destinationUnitId)
                        ?.name ?? "Destino"}
                    </strong>
                    <small>{transfer.reason}</small>
                  </span>
                  <Badge
                    tone={
                      transfer.status === "received"
                        ? "success"
                        : transfer.status === "canceled"
                          ? "neutral"
                          : "warning"
                    }
                  >
                    {transfer.status === "partially_received"
                      ? "Parcial"
                      : transfer.status === "in_transit"
                        ? "Em trânsito"
                        : transfer.status === "received"
                          ? "Recebida"
                          : "Cancelada"}
                  </Badge>
                  {["in_transit", "partially_received"].includes(transfer.status) && (
                    <span className="inventory-command-bar__actions">
                      {transfer.destinationUnitId === currentUnitId && (
                        <Button
                          onClick={() => onReceiveInterunitTransfer(transfer.id)}
                          size="sm"
                          variant="secondary"
                        >
                          Receber
                        </Button>
                      )}
                      {transfer.sourceUnitId === currentUnitId && (
                        <Button
                          onClick={() => onCancelInterunitTransfer(transfer.id)}
                          size="sm"
                          variant="ghost"
                        >
                          Cancelar
                        </Button>
                      )}
                    </span>
                  )}
                </article>
              ))}
              {!data.interunitTransfers.length && (
                <p className="inventory-copy">Nenhuma transferência entre unidades.</p>
              )}
            </div>
          </Card>

          <Card className="inventory-priority-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Entrega, preço e divergência</p>
                <h2>Desempenho dos fornecedores</h2>
              </div>
            </div>
            <div className="inventory-priority-list">
              {data.supplierPerformance.slice(0, 8).map((supplier) => (
                <article key={supplier.supplierId}>
                  <span>
                    <strong>{supplier.supplierName}</strong>
                    <small>
                      Atendimento {supplier.fillRatePercent.toLocaleString("pt-BR")}% · no prazo{" "}
                      {supplier.onTimePercent.toLocaleString("pt-BR")}% · divergência{" "}
                      {supplier.divergencePercent.toLocaleString("pt-BR")}%
                    </small>
                  </span>
                </article>
              ))}
              {!data.supplierPerformance.length && (
                <p className="inventory-copy">Ainda não há histórico suficiente.</p>
              )}
            </div>
          </Card>

          <Card className="inventory-priority-card">
            <div className="inventory-section-header inventory-section-header--wrap">
              <div>
                <p className="eyebrow">Snapshot auditável e imutável</p>
                <h2>Fechamento mensal</h2>
              </div>
              {data.capabilities?.canCloseInventory && (
                <Button onClick={() => onOpen("closing")} size="sm">
                  Fechar período
                </Button>
              )}
            </div>
            <div className="inventory-priority-list">
              {data.closings.slice(0, 8).map((closing) => (
                <article key={closing.id}>
                  <span>
                    <strong>{closing.period.slice(0, 7)}</strong>
                    <small>
                      {closing.lineCount} posição(ões) · {dateLabel(closing.closedAt)}
                    </small>
                  </span>
                  <span>
                    <strong>{formatMoney(closing.totalValueCents)}</strong>
                    {closing.totalInTransitValueCents > 0 && (
                      <small>{formatMoney(closing.totalInTransitValueCents)} em trânsito</small>
                    )}
                  </span>
                </article>
              ))}
              {!data.closings.length && <p className="inventory-copy">Nenhum período fechado.</p>}
            </div>
          </Card>
        </div>
      )}

      {view === "balances" && (
        <Card className="inventory-data-card">
          <div className="inventory-section-header inventory-section-header--wrap">
            <div>
              <p className="eyebrow">Posição atual</p>
              <h2>Saldos por item e local</h2>
            </div>
            <div className="inventory-filters">
              <SearchField
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar item, SKU ou código"
                value={query}
              />
              <NativeSelect
                aria-label="Filtrar por tipo de item"
                onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}
                value={kindFilter}
              >
                <option value="all">Todos os tipos</option>
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Filtrar por local"
                onChange={(event) => setLocationFilter(event.target.value)}
                value={locationFilter}
              >
                <option value="all">Todos os locais</option>
                {data.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Filtrar por situação"
                onChange={(event) => setStatusFilter(event.target.value)}
                value={statusFilter}
              >
                <option value="all">Todas as situações</option>
                <option value="zero">Zerados</option>
                <option value="low">Abaixo do mínimo</option>
                <option value="normal">Normais</option>
                <option value="inactive">Inativos</option>
              </NativeSelect>
            </div>
          </div>
          {visibleSummaries.length ? (
            <div className="inventory-balance-list">
              {visibleSummaries.map((summary) => (
                <article className="inventory-balance-row" key={summary.item.id}>
                  <div className="inventory-balance-row__identity">
                    <strong>{summary.item.name}</strong>
                    <small>
                      {kindLabels[itemKind(summary.item)]} · {summary.item.sku ?? "Sem SKU"} ·{" "}
                      {summary.item.purchaseUnit
                        ? `Compra em ${summary.item.purchaseUnit}`
                        : `Estoque em ${summary.item.unit}`}
                    </small>
                  </div>
                  <div>
                    <small>Físico</small>
                    <strong>
                      {summary.quantity.toLocaleString("pt-BR")} {summary.item.unit}
                    </strong>
                  </div>
                  <div>
                    <small>Reservado / quarentena / em trânsito / disponível</small>
                    <strong>
                      {summary.reservedQuantity.toLocaleString("pt-BR")} /{" "}
                      {summary.blockedQuantity.toLocaleString("pt-BR")} /{" "}
                      {summary.inTransitQuantity.toLocaleString("pt-BR")} /{" "}
                      {summary.availableQuantity.toLocaleString("pt-BR")} {summary.item.unit}
                    </strong>
                  </div>
                  <div>
                    <small>Custo médio</small>
                    <strong>
                      {summary.averageCostCents === null
                        ? "Não informado"
                        : `${formatMoney(summary.averageCostCents)}/${summary.item.unit}`}
                    </strong>
                  </div>
                  <div>
                    <small>Locais</small>
                    <span className="inventory-location-pills">
                      {data.balances
                        .filter(
                          (balance) =>
                            balance.inventoryItemId === summary.item.id && balance.quantity !== 0,
                        )
                        .map((balance) => (
                          <span key={balance.locationId}>
                            {locationById.get(balance.locationId)?.name}:{" "}
                            <strong>{balance.quantity.toLocaleString("pt-BR")}</strong>
                          </span>
                        ))}
                    </span>
                  </div>
                  <Badge
                    tone={
                      !summary.item.active
                        ? "neutral"
                        : summary.zero
                          ? "danger"
                          : summary.low
                            ? "warning"
                            : "success"
                    }
                  >
                    {!summary.item.active
                      ? "Inativo"
                      : summary.zero
                        ? "Zerado"
                        : summary.low
                          ? "Repor"
                          : "Normal"}
                  </Badge>
                  <Badge tone="info">{kindLabels[itemKind(summary.item)]}</Badge>
                  <Button
                    aria-label={`Editar ${summary.item.name}`}
                    onClick={() => onEditItem(summary.item)}
                    size="sm"
                    variant="ghost"
                  >
                    Editar
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhum item encontrado"
              description="Revise os filtros ou cadastre um novo item de estoque."
              icon="⌕"
            />
          )}
        </Card>
      )}

      {view === "counts" && (
        <div className="inventory-count-layout">
          <Card className="inventory-data-card">
            <p className="eyebrow">Contagem cíclica</p>
            <h2>Conte vários itens em uma única conferência</h2>
            <p className="inventory-copy">
              O saldo esperado fica oculto durante a contagem. O rascunho permanece neste
              dispositivo e divergências relevantes exigem aprovação de outra pessoa antes de
              alterar o estoque.
            </p>
            <Button
              disabled={!data.items.length || !data.locations.length}
              onClick={() => onOpen("event")}
            >
              Iniciar ou continuar contagem
            </Button>
          </Card>
          <Card className="inventory-data-card">
            <p className="eyebrow">Acompanhamento</p>
            <h2>Última contagem</h2>
            {latestCount ? (
              <div className="inventory-last-count">
                <strong>{dateLabel(latestCount.occurredAt)}</strong>
                <span>{latestCount.actorName ?? "Operador identificado"}</span>
                <small>{latestCount.reason ?? "Sem observação"}</small>
              </div>
            ) : (
              <EmptyState
                title="Nenhuma contagem registrada"
                description="Inicie a primeira contagem para criar a referência operacional."
                icon="✓"
              />
            )}
          </Card>
        </div>
      )}

      {view === "movements" && (
        <Card className="inventory-data-card">
          <div className="inventory-section-header">
            <div>
              <p className="eyebrow">Ledger auditável</p>
              <h2>Histórico de movimentações</h2>
            </div>
            <Badge tone="info">{data.recentMovements.length} recente(s)</Badge>
          </div>
          <MovementList data={data} />
        </Card>
      )}

      {view === "lots" && (
        <Card className="inventory-data-card">
          <div className="inventory-section-header">
            <div>
              <p className="eyebrow">FEFO</p>
              <h2>Lotes e validade</h2>
            </div>
            <Button onClick={() => onOpen("lot")} size="sm">
              Registrar lote
            </Button>
          </div>
          {data.lots.length ? (
            <div className="inventory-lot-grid">
              {data.lots.map((lot) => {
                const state = expiryState(lot.expiresAt);
                return (
                  <article key={lot.id}>
                    <div>
                      <strong>{itemById.get(lot.inventoryItemId)?.name ?? "Item"}</strong>
                      <small>{locationById.get(lot.locationId)?.name ?? "Local"}</small>
                    </div>
                    <Badge tone={state.tone}>{state.label}</Badge>
                    <dl>
                      <div>
                        <dt>Lote</dt>
                        <dd>{lot.batchCode}</dd>
                      </div>
                      <div>
                        <dt>Saldo</dt>
                        <dd>
                          {lot.quantity.toLocaleString("pt-BR")}{" "}
                          {itemById.get(lot.inventoryItemId)?.unit}
                        </dd>
                      </div>
                      <div>
                        <dt>Validade</dt>
                        <dd>{lot.expiresAt ? dateLabel(lot.expiresAt) : "Não informada"}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="Nenhum lote registrado"
              description="Use lotes para rastrear validade e consumir primeiro o que vence antes."
              icon="◇"
            />
          )}
        </Card>
      )}

      {view === "transfers" && (
        <Card className="inventory-data-card">
          <div className="inventory-section-header">
            <div>
              <p className="eyebrow">Origem → trânsito → destino</p>
              <h2>Transferências entre locais</h2>
            </div>
            <Button onClick={() => onOpen("transfer")} size="sm">
              Nova transferência
            </Button>
          </div>
          {data.transfers.length ? (
            <div className="inventory-movement-list">
              {data.transfers.map((transfer) => (
                <article key={transfer.id}>
                  <span>
                    <strong>{itemById.get(transfer.inventoryItemId)?.name ?? "Item"}</strong>
                    <small>
                      {locationById.get(transfer.sourceLocationId)?.name ?? "Origem"} →{" "}
                      {locationById.get(transfer.destinationLocationId)?.name ?? "Destino"}
                    </small>
                    <small>{transfer.reason}</small>
                    <small>
                      Enviada por {transfer.sentByName ?? "usuário"} · prazo{" "}
                      {dateLabel(transfer.deadlineAt)}
                    </small>
                    {transfer.receipts.map((receipt) => (
                      <small key={receipt.id}>
                        Conferida por {receipt.receivedByName ?? "usuário"} em{" "}
                        {dateLabel(receipt.receivedAt)} · recebida{" "}
                        {receipt.quantityReceived.toLocaleString("pt-BR")} · divergente{" "}
                        {receipt.quantityDivergent.toLocaleString("pt-BR")}
                      </small>
                    ))}
                  </span>
                  <span>
                    <strong>
                      {(
                        transfer.quantity -
                        transfer.quantityReceived -
                        transfer.quantityDivergent
                      ).toLocaleString("pt-BR")}{" "}
                      em trânsito
                    </strong>
                    {(transfer.quantityReceived > 0 || transfer.quantityDivergent > 0) && (
                      <small>
                        Recebido {transfer.quantityReceived.toLocaleString("pt-BR")} · divergente{" "}
                        {transfer.quantityDivergent.toLocaleString("pt-BR")}
                      </small>
                    )}
                    <small>{dateLabel(transfer.createdAt)}</small>
                  </span>
                  <Badge
                    tone={
                      transfer.status === "received"
                        ? "success"
                        : transfer.status === "canceled"
                          ? "neutral"
                          : transfer.status === "divergent"
                            ? "danger"
                            : "warning"
                    }
                  >
                    {transfer.status === "received"
                      ? "Recebida"
                      : transfer.status === "canceled"
                        ? "Cancelada"
                        : transfer.status === "divergent"
                          ? "Com divergência"
                          : transfer.status === "partially_received"
                            ? "Parcial"
                            : "Em trânsito"}
                  </Badge>
                  {(transfer.status === "in_transit" || transfer.status === "partially_received") &&
                    canResolveTransfers && (
                      <Button
                        onClick={() => onResolveTransfer(transfer.id)}
                        size="sm"
                        variant="secondary"
                      >
                        Conferir
                      </Button>
                    )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhuma transferência"
              description="Envios entre depósito, cozinha e bar aparecerão aqui até a conferência."
              icon="⇄"
            />
          )}
        </Card>
      )}

      {view === "assets" && (
        <Card className="inventory-data-card">
          <div className="inventory-section-header">
            <div>
              <p className="eyebrow">Mobiliário e utensílios</p>
              <h2>Ciclo de vida dos ativos</h2>
            </div>
            {canManageAssets && (
              <Button onClick={() => onOpen("asset")} size="sm">
                Novo ativo
              </Button>
            )}
          </div>
          {data.assets.length ? (
            <div className="inventory-settings-list">
              {data.assets.map((asset) => (
                <div key={asset.id}>
                  <span>
                    <strong>{itemById.get(asset.inventoryItemId)?.name ?? "Ativo"}</strong>
                    <small>
                      {asset.assetTag} · {locationById.get(asset.locationId)?.name ?? "Local"}
                    </small>
                  </span>
                  <Badge
                    tone={
                      asset.status === "in_use"
                        ? "success"
                        : asset.status === "retired"
                          ? "neutral"
                          : "warning"
                    }
                  >
                    {asset.status === "in_use"
                      ? "Em uso"
                      : asset.status === "maintenance"
                        ? "Manutenção"
                        : asset.status === "damaged"
                          ? "Danificado"
                          : "Descartado"}
                  </Badge>
                  <Badge tone={asset.condition === "unusable" ? "danger" : "info"}>
                    {asset.condition === "good"
                      ? "Bom"
                      : asset.condition === "fair"
                        ? "Regular"
                        : asset.condition === "poor"
                          ? "Ruim"
                          : "Sem uso"}
                  </Badge>
                  {canManageAssets && (
                    <Button onClick={() => onEditAsset(asset.id)} size="sm" variant="ghost">
                      Atualizar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhum ativo identificado"
              description="Cadastre etiquetas para rastrear local, conservação e manutenção."
              icon="◇"
            />
          )}
        </Card>
      )}

      {view === "returnables" && returnablesPanel}

      {view === "recipes" && recipes}
      {view === "controls" && controls}

      {view === "settings" && (
        <div className="inventory-settings-grid">
          <Card className="inventory-data-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Estrutura</p>
                <h2>Locais de estoque</h2>
              </div>
              <Button onClick={() => onOpen("location")} size="sm">
                Novo local
              </Button>
            </div>
            <div className="inventory-settings-list">
              {data.locations.map((location) => (
                <div key={location.id}>
                  <span>
                    <strong>{location.name}</strong>
                    <small>
                      {location.code} · {location.kind} · SLA {location.transferSlaMinutes} min
                    </small>
                  </span>
                  <Badge tone={location.active ? "success" : "neutral"}>
                    {location.active ? "Ativo" : "Inativo"}
                  </Badge>
                  <Button onClick={() => onEditLocation(location)} size="sm" variant="ghost">
                    Editar
                  </Button>
                  {location.active && (
                    <Button onClick={() => onArchiveLocation(location)} size="sm" variant="ghost">
                      Inativar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
          <Card className="inventory-data-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Cadastro</p>
                <h2>Itens de estoque</h2>
              </div>
              <Button onClick={() => onOpen("item")} size="sm">
                Novo item
              </Button>
            </div>
            <div className="inventory-settings-list">
              {data.items.map((item) => (
                <div key={item.id}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.sku ?? "Sem SKU"}</small>
                  </span>
                  <Badge tone={item.active ? "success" : "neutral"}>
                    {item.active ? "Ativo" : "Inativo"}
                  </Badge>
                  <Badge tone="info">{kindLabels[itemKind(item)]}</Badge>
                  <Button onClick={() => onEditItem(item)} size="sm" variant="ghost">
                    Editar
                  </Button>
                  {item.active && (
                    <Button onClick={() => onArchiveItem(item)} size="sm" variant="ghost">
                      Inativar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
          <Card className="inventory-data-card">
            <div className="inventory-section-header">
              <div>
                <p className="eyebrow">Operação por setor</p>
                <h2>Rotas e reposição</h2>
              </div>
              <div className="inventory-inline-actions">
                <Button
                  onClick={() => onOpen("location-item-setting")}
                  size="sm"
                  variant="secondary"
                >
                  Meta por setor
                </Button>
                <Button onClick={() => onOpen("issue-route")} size="sm">
                  Rota de venda
                </Button>
              </div>
            </div>
            <div className="inventory-settings-list">
              {data.locationItemSettings.map((setting) => (
                <div key={`${setting.locationId}:${setting.inventoryItemId}`}>
                  <span>
                    <strong>{itemById.get(setting.inventoryItemId)?.name ?? "Item"}</strong>
                    <small>
                      {locationById.get(setting.locationId)?.name ?? "Setor"} · mín.{" "}
                      {setting.minimumQuantity} · meta {setting.targetQuantity}
                    </small>
                  </span>
                  <Badge tone="info">Reposição</Badge>
                </div>
              ))}
              {data.issueRoutes.map((route) => (
                <div key={route.id}>
                  <span>
                    <strong>
                      {data.items.find((item) => item.productId === route.productId)?.name ??
                        "Produto"}
                    </strong>
                    <small>Baixa em {locationById.get(route.locationId)?.name ?? "Setor"}</small>
                  </span>
                  <Badge tone={route.active ? "success" : "neutral"}>
                    {route.active ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function PendingActionList({
  actions,
  limit,
  canApproveInventoryRisk,
  canResolveTransfers,
  onReviewInventoryRequest,
  onResolveTransfer,
  onReviewReturnableIncident,
  onOpenPurchases,
}: {
  actions: InventoryPendingAction[];
  limit?: number;
  canApproveInventoryRisk: boolean;
  canResolveTransfers: boolean;
  onReviewInventoryRequest: (requestId: string) => void;
  onResolveTransfer: (transferId: string) => void;
  onReviewReturnableIncident: (incidentId: string) => void;
  onOpenPurchases: () => void;
}) {
  const visible = limit ? actions.slice(0, limit) : actions;
  if (!visible.length)
    return (
      <EmptyState
        title="Nenhuma pendência operacional"
        description="Importações, divergências, transferências e ocorrências estão em dia."
        icon="✓"
      />
    );
  return (
    <div className="inventory-priority-list">
      {visible.map((action) => (
        <article key={`${action.type}:${action.id}`}>
          <span>
            <strong>{action.title}</strong>
            <small>{action.detail}</small>
            <small>{dateLabel(action.createdAt)}</small>
          </span>
          <Badge tone={action.priority === "high" ? "danger" : "warning"}>
            {action.priority === "high" ? "Prioridade alta" : "Revisar"}
          </Badge>
          {action.type === "inventory_review" && canApproveInventoryRisk && (
            <Button onClick={() => onReviewInventoryRequest(action.id)} size="sm" variant="ghost">
              Decidir
            </Button>
          )}
          {action.type === "transfer_receipt" && canResolveTransfers && (
            <Button onClick={() => onResolveTransfer(action.id)} size="sm" variant="ghost">
              Conferir
            </Button>
          )}
          {action.type === "returnable_incident" && (
            <Button onClick={() => onReviewReturnableIncident(action.id)} size="sm" variant="ghost">
              Revisar
            </Button>
          )}
          {(action.type === "nfe_review" || action.type === "low_stock") && (
            <Button onClick={onOpenPurchases} size="sm" variant="ghost">
              {action.type === "low_stock" ? "Comprar" : "Abrir compras"}
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}

function MovementList({ data, limit }: { data: InventoryData; limit?: number }) {
  const itemById = new Map(data.items.map((item) => [item.id, item]));
  const locationById = new Map(data.locations.map((location) => [location.id, location]));
  const movements = limit ? data.recentMovements.slice(0, limit) : data.recentMovements;
  if (!movements.length)
    return (
      <EmptyState
        title="Nenhuma movimentação registrada"
        description="Contagens, perdas, compras e baixas por venda aparecerão aqui."
        icon="≡"
      />
    );
  return (
    <div className="inventory-movement-list">
      {movements.map((movement) => (
        <article key={movement.id}>
          <span
            className={`inventory-movement-list__icon inventory-movement-list__icon--${movement.quantityDelta < 0 ? "out" : "in"}`}
          >
            <Icon name={movement.quantityDelta < 0 ? "arrow-down" : "arrow-up"} size={15} />
          </span>
          <span>
            <strong>{itemById.get(movement.inventoryItemId)?.name ?? "Item indisponível"}</strong>
            <small>
              {movementLabel(movement.type)} ·{" "}
              {locationById.get(movement.locationId)?.name ?? "Local"}
            </small>
            <small>{movement.reason ?? movement.actorName ?? "Movimentação automática"}</small>
          </span>
          <span>
            <Badge tone={movementTone(movement.quantityDelta)}>
              {movement.quantityDelta > 0 ? "+" : ""}
              {movement.quantityDelta.toLocaleString("pt-BR")}
            </Badge>
            <small>{dateLabel(movement.occurredAt)}</small>
          </span>
        </article>
      ))}
    </div>
  );
}
