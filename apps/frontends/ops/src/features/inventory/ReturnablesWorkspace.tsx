import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Modal,
  NativeSelect,
  SearchField,
  StatCard,
  Toast,
} from "@giromesa/ui";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import {
  aggregateReturnableReconciliation,
  dateLabel,
  type InventoryData,
  type InventoryItem,
  type ManagementScope,
  operationalKey,
  parseReturnablePolicy,
  type RemoteState,
  type ReturnableCustody,
  type ReturnablePolicy,
  type ReturnableSectorReconciliation,
  type ReturnablesData,
  useRemote,
} from "../../management.shared";
import { formatMoney } from "../../rules";
import { BarcodeScanModal } from "./InventoryModals";
import "./returnables.css";

interface ReturnablesWorkspaceProps {
  scope: ManagementScope;
  inventory: InventoryData;
  state: RemoteState<ReturnablesData>;
  updating: boolean;
  stale: boolean;
  refreshError: string | null;
  onRetry: () => void;
  onEditItem: (item: InventoryItem) => void;
  onOpenIncident: () => void;
  onOpenSupplierExchange: () => void;
  onReviewIncident: (incidentId: string) => void;
  onResolveSupplierExchange: (exchangeId: string) => void;
}

const incidentLabels = {
  breakage: "Quebra",
  loss: "Extravio",
  suspected_theft: "Suspeita de furto",
  recording_error: "Erro de lançamento",
  other: "Outro",
} as const;

const emptyReconciliation: ReturnableSectorReconciliation = {
  inventoryItemId: null,
  locationId: null,
  fullEquivalentQuantity: 0,
  emptyPhysicalQuantity: 0,
  openCustodyQuantity: 0,
  supplierInTransitQuantity: 0,
  approvedLossQuantity: 0,
  explainableBalanceQuantity: null,
  lastCountedAt: null,
  lastCountDifferenceQuantity: null,
};

function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("pt-BR");
}

function custodyLabel(custody: ReturnableCustody) {
  return (
    custody.counterpartyName || custody.responsibleName || custody.tableLabel || "Sem responsável"
  );
}

function ageTone(days: number): "success" | "warning" | "danger" {
  if (days >= 7) return "danger";
  if (days >= 3) return "warning";
  return "success";
}

export function filterReturnableCustodies(
  custodies: ReturnableCustody[],
  inventory: InventoryData,
  query: string,
  locationId: string,
  aging: string,
) {
  const term = normalized(query);
  const items = new Map(inventory.items.map((item) => [item.id, item]));
  return custodies.filter((custody) => {
    const item = items.get(custody.inventoryItemId);
    const matchesQuery =
      !term ||
      [
        custody.id,
        custody.orderId,
        custody.orderCode,
        custody.tableLabel,
        custody.counterpartyName,
        custody.responsibleName,
        item?.name,
        item?.sku,
        item?.barcode,
      ].some((value) => normalized(value).includes(term));
    const matchesAging =
      aging === "all" ||
      (aging === "today" && custody.ageDays < 1) ||
      (aging === "attention" && custody.ageDays >= 3 && custody.ageDays < 7) ||
      (aging === "critical" && custody.ageDays >= 7);
    return (
      matchesQuery && matchesAging && (locationId === "all" || custody.locationId === locationId)
    );
  });
}

export function ReturnablesWorkspace(props: ReturnablesWorkspaceProps) {
  if (props.state.status === "loading") {
    return (
      <Card className="returnables-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <div>
          <strong>Carregando custódias e vasilhames…</strong>
          <small>A posição física permanece disponível nas demais áreas do estoque.</small>
        </div>
      </Card>
    );
  }
  if (props.state.status === "error") {
    return (
      <Card className="returnables-state" role="alert">
        <div>
          <strong>Não foi possível carregar os retornáveis.</strong>
          <small>{props.state.message}</small>
        </div>
        <Button onClick={props.onRetry} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      </Card>
    );
  }
  return <ReturnablesReady {...props} data={props.state.data} />;
}

function ReturnablesReady({
  scope,
  inventory,
  data,
  updating,
  stale,
  refreshError,
  onRetry,
  onEditItem,
  onOpenIncident,
  onOpenSupplierExchange,
  onReviewIncident,
  onResolveSupplierExchange,
}: Omit<ReturnablesWorkspaceProps, "state"> & { data: ReturnablesData }) {
  const policy = useRemote(scope, api.management.returnablePolicy, parseReturnablePolicy);
  const [query, setQuery] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [aging, setAging] = useState("all");
  const [selection, setSelection] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [returnLocationId, setReturnLocationId] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffIdentityId, setHandoffIdentityId] = useState("");
  const [handoffShift, setHandoffShift] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; message: string } | null>(
    null,
  );
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [policyMode, setPolicyMode] = useState<"disabled" | "manual">("disabled");
  const [policyDays, setPolicyDays] = useState("7");
  const [closePolicy, setClosePolicy] = useState<"ignore" | "warn" | "block">("warn");
  const itemById = useMemo(
    () => new Map(inventory.items.map((item) => [item.id, item])),
    [inventory.items],
  );
  const locationById = useMemo(
    () => new Map(inventory.locations.map((location) => [location.id, location])),
    [inventory.locations],
  );
  const visible = useMemo(
    () => filterReturnableCustodies(data.openCustodies, inventory, query, locationId, aging),
    [aging, data.openCustodies, inventory, locationId, query],
  );
  const selected = data.openCustodies.filter((custody) => selection.includes(custody.id));
  const selectedReconciliation = useMemo(() => {
    if (locationId === "all") return data.reconciliation.totals;
    const sectorRows = data.reconciliation.byLocation.filter(
      (row) => row.locationId === locationId,
    );
    return sectorRows.length ? aggregateReturnableReconciliation(sectorRows) : emptyReconciliation;
  }, [data.reconciliation, locationId]);

  useEffect(() => {
    if (policy.state.status !== "ready") return;
    setPolicyMode(policy.state.data.depositMode);
    setPolicyDays(String(policy.state.data.defaultDueDays));
    setClosePolicy(policy.state.data.returnableClosePolicy);
  }, [policy.state]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function run(key: string, task: () => Promise<unknown>, message: string) {
    setBusy(key);
    setFeedback(null);
    try {
      await task();
      await onRetry();
      setFeedback({ tone: "success", message });
      return true;
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "Não foi possível concluir a ação.",
      });
      return false;
    } finally {
      setBusy("");
    }
  }

  function selectCustody(custody: ReturnableCustody) {
    setSelection([custody.id]);
    setQuantities({ [custody.id]: String(custody.openQuantity) });
    setReturnLocationId(custody.locationId ?? inventory.locations[0]?.id ?? "");
    setReturnNote("");
  }

  function handleScan(code: string) {
    setScannerOpen(false);
    const matches = filterReturnableCustodies(data.openCustodies, inventory, code, "all", "all");
    const match = matches[0];
    if (matches.length === 1 && match) {
      selectCustody(match);
      setQuery(code);
      setFeedback({ tone: "success", message: "Custódia localizada. Confira a quantidade." });
      return;
    }
    setQuery(code);
    setFeedback(
      matches.length
        ? { tone: "success", message: `${matches.length} custódias encontradas.` }
        : { tone: "danger", message: "Nenhuma custódia aberta corresponde ao código lido." },
    );
  }

  const configurationIssues = new Set([
    ...data.configurationHealth.undecidedProductIds,
    ...data.configurationHealth.unlinkedReturnableProductIds,
    ...data.configurationHealth.inactiveContainerLinkProductIds,
    ...(policyMode === "manual" ? data.configurationHealth.missingDepositValueProductIds : []),
  ]);
  const issueProducts = data.classificationStatus.filter((entry) =>
    configurationIssues.has(entry.productId),
  );

  return (
    <div className="returnables-workspace">
      <section className="returnables-buckets" aria-label="Reconciliação de vasilhames">
        <StatCard
          title="Cheios equivalentes"
          value={selectedReconciliation.fullEquivalentQuantity}
        />
        <StatCard title="Vazios físicos" value={selectedReconciliation.emptyPhysicalQuantity} />
        <StatCard title="Pendentes de retorno" value={selectedReconciliation.openCustodyQuantity} />
        <StatCard title="Com fornecedor" value={selectedReconciliation.supplierInTransitQuantity} />
        <StatCard title="Perdas aprovadas" value={selectedReconciliation.approvedLossQuantity} />
        <StatCard
          title="Movimentos explicados"
          value={selectedReconciliation.explainableBalanceQuantity ?? "—"}
          footer={
            selectedReconciliation.explainableBalanceQuantity === null
              ? "Aguardando reconciliação do servidor"
              : "Sem comparar físico com custódia"
          }
        />
        <StatCard
          title="Última divergência de contagem"
          value={selectedReconciliation.lastCountDifferenceQuantity ?? "—"}
          footer={
            selectedReconciliation.lastCountedAt
              ? `Contagem de ${dateLabel(selectedReconciliation.lastCountedAt)}`
              : "Sem contagem aprovada para este setor"
          }
        />
      </section>

      {(stale || refreshError) && (
        <Card className="returnables-alert" role="alert">
          <span>
            <strong>Dados temporariamente desatualizados.</strong>
            <small>{refreshError ?? "A atualização em tempo real será retomada."}</small>
          </span>
          <Button disabled={updating} onClick={onRetry} size="sm" variant="secondary">
            Atualizar
          </Button>
        </Card>
      )}

      <Card className="returnables-inbox">
        <div className="inventory-section-header inventory-section-header--wrap">
          <div>
            <p className="eyebrow">Mesa, pedido, responsável e setor</p>
            <h2>Retornos pendentes</h2>
            <p>Registre apenas o que voltou agora; retornos parciais continuam abertos.</p>
          </div>
          <div className="inventory-command-bar__actions">
            {!online && <Badge tone="warning">Offline · conferência bloqueada</Badge>}
            <Button
              disabled={!data.openCustodies.length || !data.capabilities?.canConfirmReturnables}
              onClick={() => setScannerOpen(true)}
              size="sm"
              variant="secondary"
            >
              Ler código
            </Button>
            <Button
              disabled={!visible.length || !data.capabilities?.canConfirmReturnables}
              onClick={() => {
                const first = visible[0];
                if (first) selectCustody(first);
              }}
              size="sm"
            >
              Conferir retorno
            </Button>
          </div>
        </div>
        <div className="returnables-filters gm-toolbar">
          <SearchField
            aria-label="Buscar custódia por mesa, pedido, responsável ou código"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Mesa, pedido, responsável ou código"
            value={query}
          />
          <NativeSelect
            aria-label="Filtrar custódias por setor"
            onChange={(event) => setLocationId(event.target.value)}
            value={locationId}
          >
            <option value="all">Todos os setores</option>
            {inventory.locations
              .filter((location) => location.active)
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
          </NativeSelect>
          <NativeSelect
            aria-label="Filtrar custódias por prazo"
            onChange={(event) => setAging(event.target.value)}
            value={aging}
          >
            <option value="all">Todas as idades</option>
            <option value="today">Hoje</option>
            <option value="attention">3 a 6 dias</option>
            <option value="critical">7 dias ou mais</option>
          </NativeSelect>
        </div>

        {visible.length ? (
          <div className="returnables-inbox-list">
            {visible.map((custody) => {
              const item = itemById.get(custody.inventoryItemId);
              const checked = selection.includes(custody.id);
              return (
                <article data-selected={checked} key={custody.id}>
                  <label className="returnables-select">
                    <input
                      checked={checked}
                      onChange={(event) => {
                        setSelection((current) =>
                          event.target.checked
                            ? [...new Set([...current, custody.id])]
                            : current.filter((id) => id !== custody.id),
                        );
                        if (event.target.checked)
                          setQuantities((current) => ({
                            ...current,
                            [custody.id]: current[custody.id] ?? String(custody.openQuantity),
                          }));
                      }}
                      type="checkbox"
                    />
                    <span className="sr-only">Selecionar {custodyLabel(custody)}</span>
                  </label>
                  <div className="returnables-inbox-list__identity">
                    <strong>
                      {custody.tableLabel ??
                        custody.orderCode ??
                        `Pedido ${custody.orderId?.slice(0, 8) ?? "—"}`}
                    </strong>
                    <small>
                      {custodyLabel(custody)} ·{" "}
                      {locationById.get(custody.locationId ?? "")?.name ?? "Setor não informado"}
                    </small>
                    <small>
                      {item?.name ?? "Vasilhame"} · saída {dateLabel(custody.occurredAt)}
                    </small>
                    {custody.handoff && (
                      <small>
                        Responsabilidade passada para{" "}
                        {custody.handoff.toIdentityName ??
                          custody.handoff.toShiftReference ??
                          "outro operador"}
                      </small>
                    )}
                  </div>
                  <div>
                    <small>Em aberto</small>
                    <strong>{custody.openQuantity.toLocaleString("pt-BR")}</strong>
                    <small>de {custody.issuedQuantity.toLocaleString("pt-BR")}</small>
                  </div>
                  <div>
                    <Badge tone={ageTone(custody.ageDays)}>
                      {custody.ageDays === 0 ? "Hoje" : `${custody.ageDays} dia(s)`}
                    </Badge>
                    {custody.depositCents > 0 && (
                      <small>Caução {formatMoney(custody.depositCents)}</small>
                    )}
                  </div>
                  <Button onClick={() => selectCustody(custody)} size="sm" variant="ghost">
                    Retornar
                  </Button>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={
              data.openCustodies.length
                ? "Nenhuma pendência corresponde aos filtros"
                : "Nenhum vasilhame aguardando retorno"
            }
            description={
              data.openCustodies.length
                ? "Limpe os filtros ou leia outro código."
                : "Novas vendas retornáveis aparecerão aqui por mesa e pedido."
            }
            icon="↩"
          />
        )}

        {selected.length > 0 && (
          <form
            className="returnables-return-form gm-form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (!online) return;
              void run(
                "return",
                () =>
                  api.management.confirmReturnableCustodyBulk(
                    scope.organizationId,
                    scope.unitId,
                    {
                      lines: selected.map((custody) => ({
                        issueMovementId: custody.id,
                        locationId: returnLocationId,
                        quantity: quantities[custody.id] ?? "0",
                        note: returnNote.trim(),
                      })),
                    },
                    operationalKey("returnable-custody-bulk"),
                  ),
                selected.length === 1
                  ? "Retorno registrado."
                  : `${selected.length} retornos registrados.`,
              ).then((done) => {
                if (!done) return;
                setSelection([]);
                setQuantities({});
                setReturnNote("");
              });
            }}
          >
            <div className="inventory-section-header inventory-section-header--wrap">
              <div>
                <p className="eyebrow">Conferência rápida</p>
                <h3>{selected.length} custódia(s) selecionada(s)</h3>
              </div>
              <Button
                disabled={!data.capabilities?.canTransferReturnableResponsibility}
                onClick={() => setHandoffOpen(true)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Passar responsabilidade
              </Button>
            </div>
            <div className="returnables-return-lines">
              {selected.map((custody) => (
                <Label className="gm-form-field" key={custody.id}>
                  <span>
                    {custody.tableLabel ?? custody.orderCode ?? custodyLabel(custody)} · máximo{" "}
                    {custody.openQuantity.toLocaleString("pt-BR")}
                  </span>
                  <Input
                    inputMode="decimal"
                    max={custody.openQuantity}
                    min="0.001"
                    onChange={(event) =>
                      setQuantities((current) => ({ ...current, [custody.id]: event.target.value }))
                    }
                    required
                    value={quantities[custody.id] ?? ""}
                  />
                </Label>
              ))}
            </div>
            <div className="gm-form-grid inventory-form-grid">
              <Label className="gm-form-field">
                <span>Setor que recebeu os vazios</span>
                <NativeSelect
                  onChange={(event) => setReturnLocationId(event.target.value)}
                  required
                  value={returnLocationId}
                >
                  <option value="">Selecione</option>
                  {inventory.locations
                    .filter((location) => location.active)
                    .map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                </NativeSelect>
              </Label>
              <Label className="gm-form-field">
                <span>Referência da conferência</span>
                <Input
                  minLength={3}
                  onChange={(event) => setReturnNote(event.target.value)}
                  required
                  value={returnNote}
                />
              </Label>
            </div>
            <div className="inventory-modal-actions">
              <Button onClick={() => setSelection([])} type="button" variant="ghost">
                Cancelar seleção
              </Button>
              <Button
                disabled={
                  busy === "return" ||
                  !data.capabilities?.canConfirmReturnables ||
                  !online ||
                  !returnLocationId ||
                  returnNote.trim().length < 3 ||
                  selected.some((custody) => {
                    const quantity = Number(
                      String(quantities[custody.id] ?? "0").replace(",", "."),
                    );
                    return quantity <= 0 || quantity > custody.openQuantity;
                  })
                }
                type="submit"
              >
                {busy === "return" ? "Confirmando…" : "Confirmar retorno"}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <div className="inventory-overview-grid">
        <ConfigurationCard
          data={data}
          inventory={inventory}
          issueProducts={issueProducts}
          onEditItem={onEditItem}
          policy={policy}
          policyDays={policyDays}
          policyMode={policyMode}
          closePolicy={closePolicy}
          setClosePolicy={setClosePolicy}
          setPolicyDays={setPolicyDays}
          setPolicyMode={setPolicyMode}
          busy={busy}
          onClassify={(productId, classification) =>
            run(
              `classification:${productId}`,
              () =>
                api.management.classifyReturnableProduct(
                  scope.organizationId,
                  scope.unitId,
                  productId,
                  { status: classification },
                ),
              classification === "non_returnable"
                ? "Produto marcado como não retornável."
                : "Produto marcado como retornável; conclua o vínculo do vasilhame.",
            )
          }
          onSave={() =>
            run(
              "policy",
              () =>
                api.management.updateReturnablePolicy(scope.organizationId, scope.unitId, {
                  depositMode: policyMode,
                  defaultDueDays: Math.max(1, Number(policyDays) || 7),
                  returnableClosePolicy: closePolicy,
                }),
              policyMode === "manual" ? "Política manual de caução salva." : "Caução desligada.",
            ).then((done) => done && policy.retry())
          }
        />
        <IncidentCard data={data} onOpen={onOpenIncident} onReview={onReviewIncident} />
        <SupplierCard
          data={data}
          inventory={inventory}
          onOpen={onOpenSupplierExchange}
          onResolve={onResolveSupplierExchange}
        />
        {(data.pendingActions.length > 0 || data.closings.length > 0) && (
          <ClosingCard data={data} inventory={inventory} />
        )}
      </div>

      <BarcodeScanModal
        onClose={() => setScannerOpen(false)}
        onDetected={handleScan}
        open={scannerOpen}
      />
      <HandoffModal
        busy={busy === "handoff"}
        identities={inventory.inventoryOperators}
        onClose={() => setHandoffOpen(false)}
        onSubmit={() =>
          run(
            "handoff",
            () =>
              api.management.handoffReturnableCustody(
                scope.organizationId,
                scope.unitId,
                {
                  issueMovementIds: selection,
                  toIdentityId: handoffIdentityId,
                  ...(handoffShift.trim() ? { toShiftReference: handoffShift.trim() } : {}),
                  note: handoffNote.trim(),
                },
                operationalKey("returnable-custody-handoff"),
              ),
            "Responsabilidade transferida.",
          ).then((done) => {
            if (!done) return;
            setHandoffOpen(false);
            setSelection([]);
          })
        }
        open={handoffOpen}
        note={handoffNote}
        setNote={setHandoffNote}
        setShift={setHandoffShift}
        setToIdentityId={setHandoffIdentityId}
        shift={handoffShift}
        toIdentityId={handoffIdentityId}
      />
      {feedback && (
        <Toast
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
          tone={feedback.tone}
        />
      )}
    </div>
  );
}

function ConfigurationCard({
  data,
  inventory,
  issueProducts,
  onEditItem,
  policy,
  policyDays,
  policyMode,
  closePolicy,
  setClosePolicy,
  setPolicyDays,
  setPolicyMode,
  busy,
  onClassify,
  onSave,
}: {
  data: ReturnablesData;
  inventory: InventoryData;
  issueProducts: ReturnablesData["classificationStatus"];
  onEditItem: (item: InventoryItem) => void;
  policy: { state: RemoteState<ReturnablePolicy>; retry: () => void };
  policyDays: string;
  policyMode: "disabled" | "manual";
  closePolicy: "ignore" | "warn" | "block";
  setClosePolicy: (value: "ignore" | "warn" | "block") => void;
  setPolicyDays: (value: string) => void;
  setPolicyMode: (value: "disabled" | "manual") => void;
  busy: string;
  onClassify: (productId: string, classification: "returnable" | "non_returnable") => void;
  onSave: () => void;
}) {
  return (
    <Card className="returnables-card">
      <div className="inventory-section-header">
        <div>
          <p className="eyebrow">Configuração</p>
          <h2>Produtos e caução</h2>
        </div>
        <Badge tone={issueProducts.length ? "warning" : "success"}>
          {issueProducts.length ? `${issueProducts.length} revisar` : "Saudável"}
        </Badge>
      </div>
      <p className="inventory-copy">
        Caução é opcional. O sistema nunca cobra automaticamente: no modo manual, um usuário
        autorizado decide cada lançamento.
      </p>
      {policy.state.status === "loading" ? (
        <p role="status">Carregando política…</p>
      ) : policy.state.status === "error" ? (
        <div className="returnables-inline-error" role="alert">
          <span>{policy.state.message}</span>
          <Button onClick={policy.retry} size="sm" variant="ghost">
            Tentar novamente
          </Button>
        </div>
      ) : (
        <form
          className="gm-form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <Label className="gm-form-field">
            <span>Política de caução</span>
            <NativeSelect
              disabled={!data.capabilities?.canManageReturnablePolicy}
              onChange={(event) => setPolicyMode(event.target.value as "disabled" | "manual")}
              value={policyMode}
            >
              <option value="disabled">Desligada</option>
              <option value="manual">Manual</option>
            </NativeSelect>
          </Label>
          {policyMode === "manual" && (
            <Label className="gm-form-field">
              <span>Prazo padrão (dias)</span>
              <Input
                inputMode="numeric"
                max="365"
                min="1"
                onChange={(event) => setPolicyDays(event.target.value)}
                required
                type="number"
                value={policyDays}
              />
            </Label>
          )}
          <Label className="gm-form-field">
            <span>Ao fechar mesa com retorno pendente</span>
            <NativeSelect
              disabled={!data.capabilities?.canManageReturnablePolicy}
              onChange={(event) =>
                setClosePolicy(event.target.value as "ignore" | "warn" | "block")
              }
              value={closePolicy}
            >
              <option value="ignore">Não interferir</option>
              <option value="warn">Avisar e permitir decisão</option>
              <option value="block">Bloquear até resolver</option>
            </NativeSelect>
          </Label>
          <Button
            disabled={
              busy === "policy" ||
              !data.capabilities?.canManageReturnablePolicy ||
              Number(policyDays) < 1 ||
              Number(policyDays) > 365
            }
            size="sm"
            type="submit"
          >
            {busy === "policy" ? "Salvando…" : "Salvar política"}
          </Button>
        </form>
      )}
      {issueProducts.length ? (
        <div className="returnables-config-list">
          {issueProducts.slice(0, 8).map((entry) => {
            const item = inventory.items.find(
              (candidate) => candidate.productId === entry.productId,
            );
            return (
              <div key={entry.productId}>
                <span>
                  <strong>{entry.productName ?? item?.name ?? "Produto"}</strong>
                  <small>
                    {entry.classification === "undecided"
                      ? "Defina se usa vasilhame"
                      : entry.active
                        ? "Revise o vínculo ou valor"
                        : "Vínculo inativo"}
                  </small>
                </span>
                <span className="inventory-command-bar__actions">
                  {entry.classification === "undecided" && (
                    <>
                      <Button
                        disabled={
                          busy === `classification:${entry.productId}` ||
                          !data.capabilities?.canConfigureReturnables
                        }
                        onClick={() => onClassify(entry.productId, "returnable")}
                        size="sm"
                        variant="secondary"
                      >
                        Retornável
                      </Button>
                      <Button
                        disabled={
                          busy === `classification:${entry.productId}` ||
                          !data.capabilities?.canConfigureReturnables
                        }
                        onClick={() => onClassify(entry.productId, "non_returnable")}
                        size="sm"
                        variant="ghost"
                      >
                        Não retornável
                      </Button>
                    </>
                  )}
                  {item && (
                    <Button
                      disabled={!data.capabilities?.canConfigureReturnables}
                      onClick={() => onEditItem(item)}
                      size="sm"
                      variant="ghost"
                    >
                      {entry.classification === "undecided" ? "Configurar vínculo" : "Corrigir"}
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="returnables-healthy">
          <Badge tone="success">Configuração íntegra</Badge> Produtos retornáveis ativos têm vínculo
          válido.
        </p>
      )}
    </Card>
  );
}

function IncidentCard({
  data,
  onOpen,
  onReview,
}: {
  data: ReturnablesData;
  onOpen: () => void;
  onReview: (id: string) => void;
}) {
  return (
    <Card className="returnables-card">
      <div className="inventory-section-header inventory-section-header--wrap">
        <div>
          <p className="eyebrow">Quebra, extravio e furto</p>
          <h2>Ocorrências</h2>
        </div>
        <Button
          disabled={!data.capabilities?.canRecordReturnableIncident}
          onClick={onOpen}
          size="sm"
          variant="secondary"
        >
          Registrar ocorrência
        </Button>
      </div>
      {data.returnableIncidents.length ? (
        <div className="returnables-compact-list">
          {data.returnableIncidents.slice(0, 8).map((incident) => (
            <article key={incident.id}>
              <span>
                <strong>{incidentLabels[incident.kind]}</strong>
                <small>
                  {incident.reason} · {incident.actorName ?? "Operador"} ·{" "}
                  {dateLabel(incident.occurredAt)}
                </small>
              </span>
              <span>
                <Badge
                  tone={
                    incident.status === "approved"
                      ? "danger"
                      : incident.status === "rejected"
                        ? "neutral"
                        : "warning"
                  }
                >
                  {incident.status === "approved"
                    ? "Baixa aprovada"
                    : incident.status === "rejected"
                      ? "Rejeitada"
                      : "Aguardando revisão"}
                </Badge>
                <strong>{incident.quantity.toLocaleString("pt-BR")}</strong>
              </span>
              {incident.status === "pending" && data.capabilities?.canApproveReturnableIncident && (
                <Button onClick={() => onReview(incident.id)} size="sm" variant="ghost">
                  Revisar
                </Button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Sem ocorrências"
          description="Quebras e perdas aprovadas aparecerão separadas do estoque físico."
          icon="✓"
        />
      )}
    </Card>
  );
}

function SupplierCard({
  data,
  inventory,
  onOpen,
  onResolve,
}: {
  data: ReturnablesData;
  inventory: InventoryData;
  onOpen: () => void;
  onResolve: (id: string) => void;
}) {
  const itemById = new Map(inventory.items.map((item) => [item.id, item]));
  const locationById = new Map(inventory.locations.map((location) => [location.id, location]));
  return (
    <Card className="returnables-card">
      <div className="inventory-section-header inventory-section-header--wrap">
        <div>
          <p className="eyebrow">Vazios fora da unidade</p>
          <h2>Fornecedor</h2>
        </div>
        <Button onClick={onOpen} size="sm" variant="secondary">
          Enviar vasilhames
        </Button>
      </div>
      {data.supplierExchanges.length ? (
        <div className="returnables-compact-list">
          {data.supplierExchanges.slice(0, 8).map((exchange) => (
            <article key={exchange.id}>
              <span>
                <strong>{itemById.get(exchange.inventoryItemId)?.name ?? "Vasilhame"}</strong>
                <small>
                  {locationById.get(exchange.locationId)?.name ?? "Setor"} · {exchange.note} ·
                  enviado {dateLabel(exchange.sentAt)}
                </small>
              </span>
              <span>
                <Badge
                  tone={
                    exchange.status === "received"
                      ? "success"
                      : exchange.status === "canceled"
                        ? "neutral"
                        : "warning"
                  }
                >
                  {exchange.status === "received"
                    ? "Retornado"
                    : exchange.status === "canceled"
                      ? "Cancelado"
                      : "Com fornecedor"}
                </Badge>
                <strong>{exchange.quantity.toLocaleString("pt-BR")}</strong>
              </span>
              {exchange.status === "in_transit" && (
                <Button onClick={() => onResolve(exchange.id)} size="sm" variant="ghost">
                  Conferir retorno
                </Button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nenhum vasilhame com fornecedor"
          description="Envios e retornos do fornecedor ficam rastreados aqui."
          icon="⇄"
        />
      )}
    </Card>
  );
}

function ClosingCard({ data, inventory }: { data: ReturnablesData; inventory: InventoryData }) {
  const locationById = new Map(inventory.locations.map((location) => [location.id, location]));
  return (
    <Card className="returnables-card">
      <div className="inventory-section-header">
        <div>
          <p className="eyebrow">Exposto pelo servidor</p>
          <h2>Fechamento e pendências</h2>
        </div>
        <Badge tone={data.pendingActions.length ? "warning" : "info"}>
          {data.pendingActions.length}
        </Badge>
      </div>
      <div className="returnables-compact-list">
        {data.pendingActions.map((action) => (
          <article key={action.id}>
            <span>
              <strong>{action.title}</strong>
              <small>
                {action.detail} · {dateLabel(action.createdAt)}
              </small>
            </span>
            <Badge tone={action.priority === "high" ? "danger" : "warning"}>
              {action.priority === "high" ? "Alta" : "Revisar"}
            </Badge>
          </article>
        ))}
        {data.closings.map((closing) => (
          <article key={closing.id}>
            <span>
              <strong>
                {closing.period} ·{" "}
                {locationById.get(closing.locationId ?? "")?.name ?? "Todos os setores"}
              </strong>
              <small>
                Custódia {closing.pendingCustodyQuantity} · fornecedor{" "}
                {closing.supplierInTransitQuantity} · perdas {closing.approvedLossQuantity}
              </small>
            </span>
            <Badge tone="success">Fechado {dateLabel(closing.closedAt)}</Badge>
          </article>
        ))}
      </div>
    </Card>
  );
}

function HandoffModal({
  open,
  busy,
  identities,
  toIdentityId,
  shift,
  note,
  setToIdentityId,
  setShift,
  setNote,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  identities: Array<{ id: string; name: string }>;
  toIdentityId: string;
  shift: string;
  note: string;
  setToIdentityId: (value: string) => void;
  setShift: (value: string) => void;
  setNote: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal isOpen={open} onClose={onClose} size="sm" title="Passar responsabilidade">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <p className="inventory-context-note">
          A custódia continua aberta; apenas o responsável operacional muda e fica auditado.
        </p>
        <Label className="gm-form-field">
          <span>Novo responsável</span>
          <NativeSelect
            onChange={(event) => setToIdentityId(event.target.value)}
            required
            value={toIdentityId}
          >
            <option value="">Selecione</option>
            {identities.map((identity) => (
              <option key={identity.id} value={identity.id}>
                {identity.name}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="gm-form-field">
          <span>Turno/referência</span>
          <Input
            onChange={(event) => setShift(event.target.value)}
            placeholder="Ex.: bar-noite"
            value={shift}
          />
        </Label>
        <Label className="gm-form-field">
          <span>Motivo</span>
          <Input
            minLength={3}
            onChange={(event) => setNote(event.target.value)}
            required
            value={note}
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button disabled={busy || !toIdentityId || note.trim().length < 3} type="submit">
            {busy ? "Transferindo…" : "Confirmar passagem"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
