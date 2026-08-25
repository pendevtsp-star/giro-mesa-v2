import { Toast } from "@giromesa/ui";
import { useEffect, useState } from "react";
import { api } from "../../api";
import {
  type InterunitTransfer,
  type InventoryAsset,
  type InventoryData,
  type InventoryItem,
  type InventoryReservation,
  type InventoryReviewRequest,
  type InventoryTransfer,
  type ManagementScope,
  operationalKey,
  type ProductionBatch,
  parseInventory,
  parseRecipeCatalog,
  parseReturnables,
  RemoteGate,
  type ReturnablesData,
  records,
  requiredString,
  type StockLocation,
  useRemote,
} from "../../management.shared";
import { type RealtimeStatus, subscribeScopeRealtime } from "../../realtime";
import { InventoryControls } from "./InventoryControls";
import {
  AssetModal,
  BarcodeScanModal,
  InterunitReceiptModal,
  InterunitTransferModal,
  InventoryClosingModal,
  InventoryEventModal,
  InventoryIssueRouteModal,
  InventoryReviewModal,
  ItemModal,
  LocationItemSettingModal,
  LocationModal,
  LotModal,
  ProductionBatchModal,
  ProductionCompletionModal,
  ReservationModal,
  ReservationResolutionModal,
  ReturnableConferenceModal,
  ReturnableIncidentModal,
  ReturnableIncidentReviewModal,
  ReturnableSupplierExchangeModal,
  ReturnableSupplierExchangeResolutionModal,
  TransferModal,
  TransferResolutionModal,
} from "./InventoryModals";
import { type InventoryDialog, type InventoryView, InventoryWorkspace } from "./InventoryWorkspace";
import {
  enqueueInventoryAction,
  type InventoryOfflineInput,
  replayInventoryQueue,
} from "./inventory-offline";
import { RecipeManager } from "./RecipeManager";
import { ReturnablesWorkspace } from "./ReturnablesWorkspace";

interface Feedback {
  message: string;
  tone: "success" | "danger";
}

function mergeReturnables(inventory: InventoryData, returnables: ReturnablesData | null) {
  if (!returnables) return inventory;
  const { closings, pendingActions, ...returnableState } = returnables;
  return {
    ...inventory,
    ...returnableState,
    returnableClosings: closings,
    returnablePendingActions: pendingActions,
  } satisfies InventoryData;
}

export function RealInventoryPage({ scope }: { scope: ManagementScope }) {
  const { organizationId, unitId } = scope;
  const remote = useRemote(scope, api.management.inventory, parseInventory);
  const returnables = useRemote(scope, api.management.returnables, parseReturnables);
  const catalog = useRemote(scope, api.pilot.catalog, parseRecipeCatalog);
  const suppliers = useRemote(scope, api.management.suppliers, (value) =>
    records(value).map((supplier) => ({
      id: requiredString(supplier.id),
      name: requiredString(supplier.name),
    })),
  );
  const [view, setView] = useState<InventoryView>("overview");
  const [dialog, setDialog] = useState<InventoryDialog | null>(null);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<StockLocation | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [selectedReview, setSelectedReview] = useState<InventoryReviewRequest | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<InventoryTransfer | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<InventoryAsset | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<InventoryReservation | null>(null);
  const [selectedProduction, setSelectedProduction] = useState<ProductionBatch | null>(null);
  const [selectedInterunitTransfer, setSelectedInterunitTransfer] =
    useState<InterunitTransfer | null>(null);
  const [selectedSupplierExchangeId, setSelectedSupplierExchangeId] = useState<string | null>(null);
  const [scannedCode, setScannedCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");

  useEffect(
    () =>
      subscribeScopeRealtime(
        { organizationId, unitId },
        async () => {
          await remote.retry();
          await returnables.retry();
          return true;
        },
        setRealtimeStatus,
        15_000,
        {
          shouldInvalidate: (event) =>
            event.topic?.startsWith("management.inventory") === true ||
            event.topic?.startsWith("management.stock-location") === true ||
            event.topic?.startsWith("management.returnable") === true ||
            event.topic?.startsWith("management.product-returnable") === true,
        },
      ),
    [organizationId, remote.retry, returnables.retry, unitId],
  );

  useEffect(() => {
    const replay = async () => {
      if (!navigator.onLine) return;
      const result = await replayInventoryQueue({ organizationId, unitId });
      if (result.pending === 0) await remote.retry();
    };
    void replay();
    window.addEventListener("online", replay);
    return () => window.removeEventListener("online", replay);
  }, [organizationId, remote.retry, unitId]);

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setSelectedItem(null);
    setSelectedLocation(null);
    setSelectedIncidentId(null);
    setSelectedReview(null);
    setSelectedTransfer(null);
    setSelectedAsset(null);
    setSelectedReservation(null);
    setSelectedProduction(null);
    setSelectedInterunitTransfer(null);
    setSelectedSupplierExchangeId(null);
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      await remote.retry();
      void returnables.retry();
      setFeedback({ message: success, tone: "success" });
      setDialog(null);
      setSelectedItem(null);
      setSelectedLocation(null);
      setSelectedReview(null);
      setSelectedTransfer(null);
      setSelectedAsset(null);
      setSelectedReservation(null);
      setSelectedProduction(null);
      setSelectedInterunitTransfer(null);
      setSelectedSupplierExchangeId(null);
      return true;
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Não foi possível concluir a ação.",
        tone: "danger",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function queueOffline(action: InventoryOfflineInput, success: string) {
    enqueueInventoryAction(scope, action);
    setFeedback({ message: success, tone: "success" });
    setDialog(null);
    return true;
  }

  return (
    <>
      <RemoteGate remote={remote}>
        {(data) => (
          <>
            <InventoryWorkspace
              canApproveInventoryRisk={
                data.capabilities?.canApproveInventoryRisk ??
                ["owner", "manager"].includes(scope.profileId)
              }
              canResolveTransfers={data.capabilities?.canResolveTransfers ?? true}
              canManageAssets={data.capabilities?.canManageAssets ?? true}
              currentUnitId={scope.unitId}
              data={mergeReturnables(
                data,
                returnables.state.status === "ready" ? returnables.state.data : null,
              )}
              controls={<InventoryControls inventory={data} scope={scope} />}
              returnablesPanel={
                <ReturnablesWorkspace
                  inventory={data}
                  onEditItem={(item) => {
                    setSelectedItem(item);
                    setDialog("item");
                  }}
                  onOpenIncident={() => setDialog("returnable-incident")}
                  onOpenSupplierExchange={() => setDialog("returnable-supplier-exchange")}
                  onResolveSupplierExchange={(exchangeId) => {
                    setSelectedSupplierExchangeId(exchangeId);
                    setDialog("returnable-supplier-resolution");
                  }}
                  onRetry={returnables.retry}
                  onReviewIncident={(incidentId) => {
                    setSelectedIncidentId(incidentId);
                    setDialog("returnable-review");
                  }}
                  refreshError={returnables.refreshError}
                  scope={scope}
                  stale={returnables.stale}
                  state={returnables.state}
                  updating={returnables.updating}
                />
              }
              onArchiveItem={(item) => {
                if (!window.confirm(`Inativar ${item.name}? O saldo deve estar zerado.`)) return;
                void run(
                  () =>
                    api.management.archiveInventoryItem(
                      scope.organizationId,
                      scope.unitId,
                      item.id,
                    ),
                  "Item inativado.",
                );
              }}
              onArchiveLocation={(location) => {
                if (!window.confirm(`Inativar ${location.name}? O local deve estar sem saldo.`))
                  return;
                void run(
                  () =>
                    api.management.archiveStockLocation(
                      scope.organizationId,
                      scope.unitId,
                      location.id,
                    ),
                  "Local inativado.",
                );
              }}
              onEditItem={(item) => {
                setSelectedItem(item);
                setDialog("item");
              }}
              onEditLocation={(location) => {
                setSelectedLocation(location);
                setDialog("location");
              }}
              onEditAsset={(assetId) => {
                setSelectedAsset(data.assets.find((asset) => asset.id === assetId) ?? null);
                setDialog("asset");
              }}
              onResolveReservation={(reservationId) => {
                setSelectedReservation(
                  data.reservations.find((reservation) => reservation.id === reservationId) ?? null,
                );
                setDialog("reservation-resolution");
              }}
              onCompleteProduction={(batchId) => {
                setSelectedProduction(
                  data.productionBatches.find((batch) => batch.id === batchId) ?? null,
                );
                setDialog("production-complete");
              }}
              onCancelProduction={(batchId) => {
                const reason = window.prompt("Motivo do cancelamento da produção:");
                if (!reason || reason.trim().length < 3) return;
                void run(
                  () =>
                    api.management.cancelProductionBatch(
                      scope.organizationId,
                      scope.unitId,
                      batchId,
                      { reason: reason.trim() },
                      operationalKey("production-cancel"),
                    ),
                  "Produção cancelada e insumos liberados.",
                );
              }}
              onReceiveInterunitTransfer={(transferId) => {
                setSelectedInterunitTransfer(
                  data.interunitTransfers.find((transfer) => transfer.id === transferId) ?? null,
                );
                setDialog("interunit-receive");
              }}
              onCancelInterunitTransfer={(transferId) => {
                const reason = window.prompt("Motivo do cancelamento da transferência:");
                if (!reason || reason.trim().length < 3) return;
                void run(
                  () =>
                    api.management.cancelInterunitTransfer(
                      scope.organizationId,
                      scope.unitId,
                      transferId,
                      { reason: reason.trim() },
                      operationalKey("interunit-transfer-cancel"),
                    ),
                  "Transferência cancelada e saldo em trânsito devolvido.",
                );
              }}
              onGenerateCyclePlan={() => {
                void run(
                  () =>
                    api.management.generateCycleCountPlan(
                      scope.organizationId,
                      scope.unitId,
                      operationalKey("cycle-count-plan"),
                    ),
                  "Plano de contagem recalculado.",
                );
              }}
              onOpen={(nextDialog) => {
                setSelectedItem(null);
                setSelectedLocation(null);
                setSelectedAsset(null);
                setDialog(nextDialog);
              }}
              onReviewReturnableIncident={(incidentId) => {
                setSelectedIncidentId(incidentId);
                setDialog("returnable-review");
              }}
              onResolveSupplierExchange={(exchangeId) => {
                setSelectedSupplierExchangeId(exchangeId);
                setDialog("returnable-supplier-resolution");
              }}
              onReviewInventoryRequest={(requestId) => {
                setSelectedReview(
                  data.inventoryReviewRequests.find((request) => request.id === requestId) ?? null,
                );
                setDialog("inventory-review");
              }}
              onResolveTransfer={(transferId) => {
                setSelectedTransfer(
                  data.transfers.find((transfer) => transfer.id === transferId) ?? null,
                );
                setDialog("transfer-resolution");
              }}
              onViewChange={setView}
              recipes={<RecipeManager inventory={data} scope={scope} />}
              realtimeStatus={realtimeStatus}
              scannedCode={scannedCode}
              view={view}
            />

            <LocationModal
              busy={busy}
              location={selectedLocation}
              operators={data.inventoryOperators}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    selectedLocation
                      ? api.management.updateStockLocation(
                          scope.organizationId,
                          scope.unitId,
                          selectedLocation.id,
                          body,
                        )
                      : api.management.createStockLocation(
                          scope.organizationId,
                          scope.unitId,
                          body,
                          operationalKey("stock-location"),
                        ),
                  selectedLocation ? "Local atualizado." : "Local criado.",
                )
              }
              open={dialog === "location"}
            />
            <ItemModal
              busy={busy}
              item={selectedItem}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  async () => {
                    const {
                      returnableContainerItemId,
                      returnableQuantityPerUnit,
                      returnableDepositCents,
                      ...itemBody
                    } = body;
                    if (selectedItem) {
                      await api.management.updateInventoryItem(
                        scope.organizationId,
                        scope.unitId,
                        selectedItem.id,
                        itemBody,
                      );
                    } else {
                      await api.management.createInventoryItem(
                        scope.organizationId,
                        scope.unitId,
                        itemBody as Parameters<typeof api.management.createInventoryItem>[2],
                        operationalKey("inventory-item"),
                      );
                    }
                    const nextProductId =
                      itemBody.kind === "resale" && typeof itemBody.productId === "string"
                        ? itemBody.productId
                        : null;
                    const previousProductId = selectedItem?.productId ?? null;
                    const nextContainerId =
                      typeof returnableContainerItemId === "string"
                        ? returnableContainerItemId
                        : "";
                    const previousContainerId = selectedItem?.returnableContainerItemId ?? "";
                    if (
                      previousProductId &&
                      previousContainerId &&
                      previousProductId !== nextProductId
                    ) {
                      await api.management.configureReturnable(
                        scope.organizationId,
                        scope.unitId,
                        {
                          productId: previousProductId,
                          containerInventoryItemId: previousContainerId,
                          quantityPerUnit: "1",
                          depositCents: 0,
                          active: false,
                        },
                        operationalKey("returnable-configuration-disable"),
                      );
                    }
                    if (nextProductId && (nextContainerId || previousContainerId))
                      await api.management.configureReturnable(
                        scope.organizationId,
                        scope.unitId,
                        {
                          productId: nextProductId,
                          containerInventoryItemId: nextContainerId || previousContainerId,
                          quantityPerUnit:
                            typeof returnableQuantityPerUnit === "string"
                              ? returnableQuantityPerUnit
                              : "1",
                          depositCents:
                            typeof returnableDepositCents === "number" ? returnableDepositCents : 0,
                          active: Boolean(nextContainerId),
                        },
                        operationalKey("returnable-configuration"),
                      );
                  },
                  selectedItem ? "Item atualizado." : "Item cadastrado.",
                )
              }
              open={dialog === "item"}
              products={catalog.state.status === "ready" ? catalog.state.data.products : []}
              suppliers={suppliers.state.status === "ready" ? suppliers.state.data : []}
              containers={data.items
                .filter(
                  (candidate) => candidate.kind === "returnable_container" && candidate.active,
                )
                .map(({ id, name }) => ({ id, name }))}
            />
            <InventoryEventModal
              busy={busy}
              draftKey={`giromesa:inventory-count:${scope.organizationId}:${scope.unitId}`}
              items={data.items}
              locations={data.locations}
              lots={data.lots}
              onClose={closeDialog}
              onSubmit={(body) =>
                (() => {
                  const eventBody = {
                    type: body.type,
                    reason: body.reason,
                    lines: body.lines.map(({ inventoryItemId, locationId, lotId, quantity }) => ({
                      inventoryItemId,
                      locationId,
                      lotId,
                      quantity,
                    })),
                  };
                  const key = operationalKey("inventory-event");
                  const saved = !navigator.onLine
                    ? Promise.resolve(
                        queueOffline(
                          { kind: "event", body: eventBody, idempotencyKey: key },
                          `${body.lines.length} item(ns) guardado(s) para sincronização.`,
                        ),
                      )
                    : run(
                        () =>
                          api.management.createInventoryEvent(
                            scope.organizationId,
                            scope.unitId,
                            eventBody,
                            key,
                          ),
                        `${body.lines.length} item(ns) registrado(s); divergências relevantes aguardam aprovação.`,
                      );
                  return saved.then((completed) => {
                    if (completed) {
                      localStorage.removeItem(
                        `giromesa:inventory-count:${scope.organizationId}:${scope.unitId}`,
                      );
                    }
                    return completed;
                  });
                })()
              }
              open={dialog === "event"}
            />
            <TransferModal
              busy={busy}
              items={data.items}
              locations={data.locations}
              lots={data.lots}
              onClose={closeDialog}
              onSubmit={(body) =>
                !navigator.onLine
                  ? Promise.resolve(
                      queueOffline(
                        {
                          kind: "transfer",
                          body,
                          idempotencyKey: operationalKey("inventory-transfer-batch"),
                        },
                        "Transferência guardada para sincronização.",
                      ),
                    )
                  : run(
                      () =>
                        api.management.transferInventoryBatch(
                          scope.organizationId,
                          scope.unitId,
                          body,
                          operationalKey("inventory-transfer-batch"),
                        ),
                      "Transferência enviada e aguardando conferência no destino.",
                    )
              }
              open={dialog === "transfer"}
            />
            <TransferResolutionModal
              busy={busy}
              onClose={closeDialog}
              onSubmit={(body) =>
                selectedTransfer
                  ? run(
                      () =>
                        api.management.resolveInventoryTransfer(
                          scope.organizationId,
                          scope.unitId,
                          selectedTransfer.id,
                          body,
                          operationalKey("inventory-transfer-resolution"),
                        ),
                      body.decision === "received"
                        ? "Transferência recebida e saldo liberado no destino."
                        : "Transferência cancelada e saldo devolvido à origem.",
                    )
                  : Promise.resolve(false)
              }
              open={dialog === "transfer-resolution"}
              transfer={selectedTransfer}
            />
            <InventoryReviewModal
              busy={busy}
              onClose={closeDialog}
              onSubmit={(body) =>
                selectedReview
                  ? run(
                      () =>
                        api.management.reviewInventoryEvent(
                          scope.organizationId,
                          scope.unitId,
                          selectedReview.id,
                          body,
                          operationalKey("inventory-risk-review"),
                        ),
                      body.decision === "approved"
                        ? "Divergência aprovada e saldo atualizado."
                        : "Divergência rejeitada sem alterar o saldo.",
                    )
                  : Promise.resolve(false)
              }
              open={dialog === "inventory-review"}
              request={selectedReview}
            />
            <AssetModal
              asset={selectedAsset}
              busy={busy}
              items={data.items}
              locations={data.locations}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    selectedAsset
                      ? api.management.updateInventoryAsset(
                          scope.organizationId,
                          scope.unitId,
                          selectedAsset.id,
                          body,
                        )
                      : api.management.createInventoryAsset(
                          scope.organizationId,
                          scope.unitId,
                          body as Parameters<typeof api.management.createInventoryAsset>[2],
                          operationalKey("inventory-asset"),
                        ),
                  selectedAsset ? "Ativo atualizado." : "Ativo cadastrado.",
                )
              }
              open={dialog === "asset"}
            />
            <BarcodeScanModal
              onClose={closeDialog}
              onDetected={(value) => {
                setScannedCode(value);
                setView("balances");
                setDialog(null);
              }}
              open={dialog === "scan"}
            />
            <LotModal
              busy={busy}
              items={data.items}
              locations={data.locations}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    api.management.createInventoryLot(
                      scope.organizationId,
                      scope.unitId,
                      body,
                      operationalKey("inventory-lot"),
                    ),
                  "Lote e saldo registrados.",
                )
              }
              open={dialog === "lot"}
            />
            <ReservationModal
              busy={busy}
              items={data.items}
              locations={data.locations}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    api.management.createInventoryReservation(
                      scope.organizationId,
                      scope.unitId,
                      body,
                      operationalKey("inventory-reservation"),
                    ),
                  "Estoque reservado.",
                )
              }
              open={dialog === "reservation"}
            />
            <ReservationResolutionModal
              busy={busy}
              onClose={closeDialog}
              onSubmit={(body) =>
                selectedReservation
                  ? run(
                      () =>
                        api.management.resolveInventoryReservation(
                          scope.organizationId,
                          scope.unitId,
                          selectedReservation.id,
                          body,
                          operationalKey("inventory-reservation-resolution"),
                        ),
                      "Reserva resolvida.",
                    )
                  : Promise.resolve(false)
              }
              open={dialog === "reservation-resolution"}
              reservation={selectedReservation}
            />
            <ProductionBatchModal
              busy={busy}
              items={data.items}
              locations={data.locations}
              lots={data.lots}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    api.management.createProductionBatch(
                      scope.organizationId,
                      scope.unitId,
                      body,
                      operationalKey("production-batch"),
                    ),
                  "Produção planejada e insumos reservados.",
                )
              }
              open={dialog === "production"}
            />
            <ProductionCompletionModal
              batch={selectedProduction}
              busy={busy}
              onClose={closeDialog}
              onSubmit={(body) =>
                selectedProduction
                  ? run(
                      () =>
                        api.management.completeProductionBatch(
                          scope.organizationId,
                          scope.unitId,
                          selectedProduction.id,
                          body,
                          operationalKey("production-complete"),
                        ),
                      "Produção concluída e lote disponível.",
                    )
                  : Promise.resolve(false)
              }
              open={dialog === "production-complete"}
            />
            <InterunitTransferModal
              busy={busy}
              catalog={data.interunitCatalog}
              currentUnitId={scope.unitId}
              items={data.items}
              locations={data.locations}
              lots={data.lots}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    api.management.createInterunitTransfer(
                      scope.organizationId,
                      scope.unitId,
                      body,
                      operationalKey("interunit-transfer"),
                    ),
                  "Transferência enviada.",
                )
              }
              open={dialog === "interunit-transfer"}
              units={data.organizationUnits}
            />
            <InterunitReceiptModal
              busy={busy}
              onClose={closeDialog}
              onSubmit={(body) =>
                selectedInterunitTransfer
                  ? run(
                      () =>
                        api.management.receiveInterunitTransfer(
                          scope.organizationId,
                          scope.unitId,
                          selectedInterunitTransfer.id,
                          body,
                          operationalKey("interunit-receipt"),
                        ),
                      "Recebimento registrado.",
                    )
                  : Promise.resolve(false)
              }
              open={dialog === "interunit-receive"}
              transfer={selectedInterunitTransfer}
            />
            <InventoryClosingModal
              busy={busy}
              locations={data.locations}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    api.management.closeInventoryPeriod(
                      scope.organizationId,
                      scope.unitId,
                      body,
                      operationalKey("inventory-closing"),
                    ),
                  "Fechamento mensal criado.",
                )
              }
              open={dialog === "closing"}
            />
            <LocationItemSettingModal
              busy={busy}
              items={data.items}
              locations={data.locations}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    api.management.configureStockLocationItemSetting(
                      scope.organizationId,
                      scope.unitId,
                      body,
                    ),
                  "Meta do setor atualizada.",
                )
              }
              open={dialog === "location-item-setting"}
            />
            <InventoryIssueRouteModal
              busy={busy}
              items={data.items}
              locations={data.locations}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    api.management.configureInventoryIssueRoute(
                      scope.organizationId,
                      scope.unitId,
                      body,
                      operationalKey("inventory-issue-route"),
                    ),
                  "Rota de baixa por venda atualizada.",
                )
              }
              open={dialog === "issue-route"}
            />
            <ReturnableConferenceModal
              busy={busy}
              custodies={
                returnables.state.status === "ready" ? returnables.state.data.openCustodies : []
              }
              items={data.items}
              locations={data.locations}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    api.management.confirmReturnableCustody(
                      scope.organizationId,
                      scope.unitId,
                      {
                        issueMovementId: body.issueMovementId,
                        containerInventoryItemId: body.inventoryItemId,
                        locationId: body.locationId,
                        quantity: body.quantity,
                        orderId: body.orderId,
                        note: body.reason,
                      },
                      operationalKey("returnable-custody"),
                    ),
                  "Conferência de vasilhames confirmada.",
                )
              }
              open={dialog === "returnable-conference"}
              positions={
                returnables.state.status === "ready" ? returnables.state.data.returnables : []
              }
            />
            <ReturnableIncidentModal
              busy={busy}
              items={data.items}
              locations={data.locations}
              movements={
                returnables.state.status === "ready"
                  ? returnables.state.data.recentReturnableMovements
                  : []
              }
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    api.management.createReturnableIncident(
                      scope.organizationId,
                      scope.unitId,
                      {
                        containerInventoryItemId: body.inventoryItemId,
                        locationId: body.locationId,
                        movementId: body.movementId,
                        orderId: body.orderId,
                        type: body.kind,
                        quantity: body.quantity,
                        note: body.reason,
                        evidence: body.evidence,
                      },
                      operationalKey("returnable-incident"),
                    ),
                  "Ocorrência registrada para auditoria.",
                )
              }
              open={dialog === "returnable-incident"}
            />
            <ReturnableIncidentReviewModal
              busy={busy}
              onClose={closeDialog}
              onSubmit={(body) =>
                selectedIncidentId
                  ? run(
                      () =>
                        api.management.reviewReturnableIncident(
                          scope.organizationId,
                          scope.unitId,
                          selectedIncidentId,
                          body,
                          operationalKey("returnable-incident-review"),
                        ),
                      body.decision === "approved"
                        ? "Ocorrência aprovada e saldo atualizado."
                        : "Ocorrência rejeitada.",
                    )
                  : Promise.resolve(false)
              }
              open={dialog === "returnable-review"}
            />
            <ReturnableSupplierExchangeModal
              busy={busy}
              items={data.items}
              locations={data.locations}
              onClose={closeDialog}
              onSubmit={(body) =>
                run(
                  () =>
                    api.management.exchangeReturnablesWithSupplier(
                      scope.organizationId,
                      scope.unitId,
                      body,
                      operationalKey("returnable-supplier-exchange"),
                    ),
                  "Saída de vasilhames conciliada com o fornecedor.",
                )
              }
              open={dialog === "returnable-supplier-exchange"}
              suppliers={suppliers.state.status === "ready" ? suppliers.state.data : []}
            />
            <ReturnableSupplierExchangeResolutionModal
              busy={busy}
              onClose={closeDialog}
              onSubmit={(body) =>
                selectedSupplierExchangeId
                  ? run(
                      () =>
                        api.management.resolveReturnableSupplierExchange(
                          scope.organizationId,
                          scope.unitId,
                          selectedSupplierExchangeId,
                          body,
                          operationalKey("returnable-supplier-exchange-resolution"),
                        ),
                      body.decision === "received"
                        ? "Retorno do fornecedor confirmado."
                        : "Envio cancelado e saldo recomposto.",
                    )
                  : Promise.resolve(false)
              }
              open={dialog === "returnable-supplier-resolution"}
            />
          </>
        )}
      </RemoteGate>
      {feedback && (
        <Toast
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
          tone={feedback.tone}
        />
      )}
    </>
  );
}
