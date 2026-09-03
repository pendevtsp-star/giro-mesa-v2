// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  NativeSelect,
  Progress,
  SearchField,
  Textarea,
  Toast,
} from "@giromesa/ui";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import {
  currencyToCents,
  dateLabel,
  type ManagementScope,
  operationalKey,
  parseInventory,
  parsePurchases,
  parseRecipeCatalog,
  parseSuppliers,
  RemoteGate,
  useRemote,
} from "../../management.shared";
import { formatMoney } from "../../rules";
import { InvoiceImportModal } from "./InvoiceImportModal";
import "./purchases.css";

type DraftLine = { key: string; inventoryItemId: string; quantity: string; unitCost: string };
type ReceiptDraft = { quantity: string; locationId: string; batchCode: string; expiresAt: string };
const newLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  inventoryItemId: "",
  quantity: "",
  unitCost: "",
});
const humanOrder = (id: string) => `PC-${id.slice(0, 8).toUpperCase()}`;
const decimal = (value: string) => Number(value.trim().replace(",", "."));
const labels: Record<string, string> = {
  draft: "Rascunho",
  approved: "Aprovado",
  partially_received: "Recebido parcialmente",
  received: "Recebido",
  canceled: "Cancelado",
  rejected: "Rejeitado",
};
const metricLabels: Record<string, string> = {
  orderCount: "Pedidos no período",
  orderedCents: "Valor comprado",
  receivedCents: "Valor recebido",
  pendingCount: "Aguardando ação",
  divergentInvoiceCount: "Faturas divergentes",
};
const moneyMetrics = new Set(["orderedCents", "receivedCents"]);
const metricValue = (key: string, value: number) =>
  moneyMetrics.has(key) ? formatMoney(value) : value.toLocaleString("pt-BR");
const tone = (status: string): "success" | "warning" | "danger" | "info" =>
  status === "received"
    ? "success"
    : ["canceled", "rejected"].includes(status)
      ? "danger"
      : status === "draft"
        ? "warning"
        : "info";

export function RealPurchasesPage({ scope }: { scope: ManagementScope }) {
  const [busy, setBusy] = useState("");
  const idempotencyKeys = useRef(new Map<string, string>());
  const [toast, setToast] = useState<{ tone: "success" | "danger"; message: string } | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [nfeOpen, setNfeOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const purchases = useRemote(
    scope,
    useMemo(
      () => (organizationId: string, unitId: string) =>
        api.management.purchases(organizationId, unitId, {
          page,
          pageSize: 8,
          status: status === "all" ? undefined : status,
          search: query.trim() || undefined,
        }),
      [page, query, status],
    ),
    parsePurchases,
  );
  const inventory = useRemote(scope, api.management.inventory, parseInventory);
  const catalog = useRemote(scope, api.pilot.catalog, parseRecipeCatalog);
  const suppliers = useRemote(scope, api.management.suppliers, parseSuppliers);
  const [supplierName, setSupplierName] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [supplierDocument, setSupplierDocument] = useState("");
  const [supplierContact, setSupplierContact] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [supplierNotes, setSupplierNotes] = useState("");
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [receipt, setReceipt] = useState<Record<string, ReceiptDraft>>({});
  const [documentNumber, setDocumentNumber] = useState("");
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceLineDrafts, setInvoiceLineDrafts] = useState<
    Record<string, { quantity: string; unitCost: string }>
  >({});
  const [invoiceIssuedAt, setInvoiceIssuedAt] = useState("");
  const [invoiceCompetenceDate, setInvoiceCompetenceDate] = useState("");
  const [invoiceTolerance, setInvoiceTolerance] = useState("0");
  const [invoiceAccessKey, setInvoiceAccessKey] = useState("");
  const [invoiceSeries, setInvoiceSeries] = useState("");
  const [invoiceModel, setInvoiceModel] = useState("55");
  const [invoiceTaxTotal, setInvoiceTaxTotal] = useState("0");
  const [invoiceXml, setInvoiceXml] = useState<{ name: string; content: string } | null>(null);
  const [transition, setTransition] = useState<{
    id: string;
    version: number;
    kind: "cancel" | "reject";
  } | null>(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [correction, setCorrection] = useState<{
    id: string;
    version: number;
    kind: "receipt" | "invoice";
  } | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const fallback = ["owner", "manager", "inventory"].includes(scope.profileId);
  function mutationKey(signature: string) {
    const existing = idempotencyKeys.current.get(signature);
    if (existing) return existing;
    const next = operationalKey("purchase");
    idempotencyKeys.current.set(signature, next);
    return next;
  }
  async function run(
    key: string,
    task: () => Promise<unknown>,
    message: string,
    signature?: string,
  ) {
    setBusy(key);
    setToast(null);
    try {
      await task();
      idempotencyKeys.current.clear();
      if (signature) idempotencyKeys.current.delete(signature);
      setToast({ tone: "success", message });
      purchases.retry();
      return true;
    } catch (error) {
      setToast({
        tone: "danger",
        message: error instanceof Error ? error.message : "Não foi possível concluir a ação.",
      });
      return false;
    } finally {
      setBusy("");
    }
  }
  function resetOrder() {
    setSupplierId("");
    setExpectedAt("");
    setLines([newLine()]);
  }
  function patchLine(key: string, patch: Partial<DraftLine>) {
    setLines((all) => all.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
  return (
    <RemoteGate remote={purchases}>
      {(data) => (
        <RemoteGate remote={inventory}>
          {(stock) => {
            const supplierDirectory =
              suppliers.state.status === "ready" ? suppliers.state.data : data.suppliers;
            const supplierList = supplierDirectory.filter((supplier) => supplier.active);
            const supplierById = new Map(
              supplierList.map((supplier) => [supplier.id, supplier.name]),
            );
            const itemById = new Map(stock.items.map((item) => [item.id, item]));
            const capabilities = data.capabilities;
            const canCreate = capabilities?.canCreate ?? fallback;
            const canApprove =
              capabilities?.canApprove ?? ["owner", "manager"].includes(scope.profileId);
            const canReceive = capabilities?.canReceive ?? fallback;
            const canInvoice =
              capabilities?.canInvoice ?? ["owner", "manager", "finance"].includes(scope.profileId);
            const canReconcile = capabilities?.canReconcile ?? canInvoice;
            const canConfirmInvoice =
              capabilities?.canConfirmInvoice ??
              ["owner", "manager", "finance"].includes(scope.profileId);
            const canReverseReceipt = capabilities?.canReverseReceipt ?? false;
            const canCancelInvoice = capabilities?.canCancelInvoice ?? false;
            const visible = data.orders;
            const pages = Math.max(
              1,
              Math.ceil((data.page?.total ?? data.orders.length) / (data.page?.pageSize ?? 8)),
            );
            const total = lines.reduce(
              (sum, line) =>
                sum +
                Math.max(0, decimal(line.quantity) || 0) *
                  Math.max(0, currencyToCents(line.unitCost)),
              0,
            );
            const selectedReceipt = data.orders.find((order) => order.id === receiptId);
            const receiptItems = data.items.filter((item) => item.purchaseOrderId === receiptId);
            const selectedInvoice = data.orders.find((order) => order.id === invoiceId);
            const registeredInvoice = data.invoices.find(
              (invoice) => invoice.purchaseOrderId === invoiceId,
            );
            const editingSupplier = supplierDirectory.find(
              (supplier) => supplier.id === editingSupplierId,
            );
            const suggestions = data.suggestions;
            async function submitSupplier(event: FormEvent<HTMLFormElement>) {
              event.preventDefault();
              const saved = await run(
                "supplier",
                () =>
                  editingSupplierId
                    ? api.management.updateSupplier(
                        scope.organizationId,
                        scope.unitId,
                        editingSupplierId,
                        {
                          name: supplierName.trim(),
                          document: supplierDocument.trim() || undefined,
                          contactName: supplierContact.trim() || undefined,
                          email: supplierEmail.trim() || undefined,
                          phone: supplierPhone.trim() || undefined,
                          address: supplierAddress.trim() || undefined,
                          notes: supplierNotes.trim() || undefined,
                          version: editingSupplier?.version ?? 1,
                        },
                        mutationKey(
                          `supplier:${editingSupplierId}:${supplierName}:${supplierEmail}:${supplierDocument}:${supplierContact}:${supplierPhone}:${supplierAddress}:${supplierNotes}`,
                        ),
                      )
                    : api.management.createSupplier(
                        scope.organizationId,
                        scope.unitId,
                        {
                          name: supplierName.trim(),
                          document: supplierDocument.trim() || undefined,
                          contactName: supplierContact.trim() || undefined,
                          email: supplierEmail.trim() || undefined,
                          phone: supplierPhone.trim() || undefined,
                          address: supplierAddress.trim() || undefined,
                          notes: supplierNotes.trim() || undefined,
                        },
                        mutationKey(
                          `supplier:new:${supplierName}:${supplierEmail}:${supplierDocument}:${supplierContact}:${supplierPhone}:${supplierAddress}:${supplierNotes}`,
                        ),
                      ),
                editingSupplierId ? "Fornecedor atualizado." : "Fornecedor cadastrado.",
              );
              if (saved) {
                setSupplierName("");
                setSupplierEmail("");
                setSupplierDocument("");
                setSupplierContact("");
                setSupplierPhone("");
                setSupplierAddress("");
                setSupplierNotes("");
                setEditingSupplierId(null);
                suppliers.retry();
              }
            }
            async function submitOrder(event: FormEvent<HTMLFormElement>) {
              event.preventDefault();
              const body = {
                supplierId,
                expectedAt: expectedAt ? new Date(expectedAt).toISOString() : undefined,
                items: lines.map((line) => ({
                  inventoryItemId: line.inventoryItemId,
                  quantity: line.quantity,
                  unitCostCents: currencyToCents(line.unitCost),
                })),
              };
              const editingOrder = data.orders.find((order) => order.id === editingId);
              const saved = await run(
                "order",
                () =>
                  editingId
                    ? api.management.updatePurchase(
                        scope.organizationId,
                        scope.unitId,
                        editingId,
                        { ...body, version: editingOrder?.version ?? 1 },
                        mutationKey(`purchase-update:${editingId}:${JSON.stringify(body)}`),
                      )
                    : api.management.createPurchase(
                        scope.organizationId,
                        scope.unitId,
                        body,
                        mutationKey(`purchase-create:${JSON.stringify(body)}`),
                      ),
                editingId ? "Pedido atualizado." : "Pedido criado como rascunho.",
              );
              if (saved) {
                setOrderOpen(false);
                setEditingId(null);
                resetOrder();
              }
            }
            async function submitReceipt(event: FormEvent<HTMLFormElement>) {
              event.preventDefault();
              if (!receiptId) return;
              const receiptLines = receiptItems
                .map((item) => ({ item, draft: receipt[item.id] }))
                .filter(
                  (line): line is { item: (typeof receiptItems)[number]; draft: ReceiptDraft } =>
                    decimal(line.draft?.quantity ?? "") > 0,
                );
              if (receiptLines.some(({ draft }) => !draft.locationId)) {
                setToast({
                  tone: "danger",
                  message: "Selecione o local de entrada para todas as linhas recebidas.",
                });
                return;
              }
              const saved = await run(
                "receipt",
                () =>
                  api.management.receivePurchase(
                    scope.organizationId,
                    scope.unitId,
                    receiptId,
                    {
                      lines: receiptLines.map(({ item, draft }) => ({
                        purchaseOrderItemId: item.id,
                        locationId: draft.locationId,
                        quantity: draft.quantity,
                        batchCode: draft.batchCode || undefined,
                        expiresAt: draft.expiresAt
                          ? new Date(`${draft.expiresAt}T12:00:00`).toISOString()
                          : undefined,
                      })),
                    },
                    mutationKey(`purchase-receipt:${receiptId}:${JSON.stringify(receiptLines)}`),
                  ),
                "Recebimento registrado e estoque atualizado.",
              );
              if (saved) setReceiptId(null);
            }
            async function submitInvoice(event: FormEvent<HTMLFormElement>) {
              event.preventDefault();
              if (!invoiceId) return;
              const issuedAt = invoiceIssuedAt || new Date().toISOString().slice(0, 10);
              const invoiceLines = data.items.filter((item) => item.purchaseOrderId === invoiceId);
              const body = {
                documentNumber: documentNumber.trim(),
                ...(invoiceAccessKey && invoiceXml
                  ? {
                      accessKey: invoiceAccessKey,
                      series: invoiceSeries.trim(),
                      model: invoiceModel,
                      taxTotalCents: currencyToCents(invoiceTaxTotal),
                      xmlContent: invoiceXml.content,
                    }
                  : {}),
                issuedAt,
                competenceDate: invoiceCompetenceDate || issuedAt,
                dueDate: invoiceDueDate,
                totalCents: currencyToCents(invoiceAmount),
                toleranceCents: currencyToCents(invoiceTolerance),
                confirmIfMatched: canConfirmInvoice,
                lines: invoiceLines.map((item) => ({
                  purchaseOrderItemId: item.id,
                  quantity: invoiceLineDrafts[item.id]?.quantity ?? item.quantity,
                  unitCostCents: currencyToCents(
                    invoiceLineDrafts[item.id]?.unitCost ?? (item.unitCostCents / 100).toFixed(2),
                  ),
                })),
              };
              const saved = await run(
                "invoice",
                () =>
                  api.management.createPurchaseInvoice(
                    scope.organizationId,
                    scope.unitId,
                    invoiceId,
                    body,
                    mutationKey(`purchase-invoice:${invoiceId}:${JSON.stringify(body)}`),
                  ),
                "Fatura registrada para conciliação.",
              );
              if (saved) {
                setInvoiceId(null);
                setDocumentNumber("");
                setInvoiceIssuedAt("");
                setInvoiceCompetenceDate("");
                setInvoiceDueDate("");
                setInvoiceAmount("");
                setInvoiceTolerance("0");
                setInvoiceAccessKey("");
                setInvoiceSeries("");
                setInvoiceModel("55");
                setInvoiceTaxTotal("0");
                setInvoiceXml(null);
                setInvoiceLineDrafts({});
              }
            }
            function edit(orderId: string) {
              const order = data.orders.find((candidate) => candidate.id === orderId);
              if (!order) return;
              setEditingId(orderId);
              setSupplierId(order.supplierId ?? "");
              setExpectedAt(order.expectedAt?.slice(0, 16) ?? "");
              setLines(
                data.items
                  .filter((item) => item.purchaseOrderId === orderId)
                  .map((item) => ({
                    key: item.id,
                    inventoryItemId: item.inventoryItemId,
                    quantity: item.quantity,
                    unitCost: (item.unitCostCents / 100).toFixed(2).replace(".", ","),
                  })),
              );
              setOrderOpen(true);
            }
            return (
              <div className="purchases-page">
                <section aria-label="Ações de compras" className="gm-toolbar purchases-command-bar">
                  <div className="purchases-command-bar__context">
                    <strong>Fluxo de suprimentos</strong>
                    <span>Pedidos, recebimentos e faturas da unidade</span>
                  </div>
                  <div className="purchases-header__actions">
                    {canReceive && (
                      <Button onClick={() => setNfeOpen(true)} variant="secondary">
                        Importar NF-e
                      </Button>
                    )}
                    {canCreate && (
                      <Button
                        onClick={() => {
                          setEditingId(null);
                          resetOrder();
                          setOrderOpen(true);
                        }}
                      >
                        Novo pedido
                      </Button>
                    )}
                    <Button onClick={() => setSupplierOpen(true)} variant="secondary">
                      Fornecedores
                    </Button>
                  </div>
                </section>
                {toast && (
                  <Toast
                    message={toast.message}
                    onDismiss={() => setToast(null)}
                    tone={toast.tone}
                    title={toast.tone === "success" ? "Concluído" : undefined}
                  />
                )}
                <section aria-label="Resumo de compras" className="purchases-metrics">
                  {data.metrics.length > 0 ? (
                    data.metrics.slice(0, 3).map((metric) => (
                      <div
                        data-tone={metric.key === "divergentInvoiceCount" ? "warning" : undefined}
                        key={metric.key}
                      >
                        <small>{metric.label ?? metricLabels[metric.key] ?? "Indicador"}</small>
                        <strong>{metricValue(metric.key, metric.value)}</strong>
                      </div>
                    ))
                  ) : (
                    <>
                      <div>
                        <small>Em aberto</small>
                        <strong>
                          {
                            data.orders.filter((order) =>
                              ["draft", "approved", "partially_received"].includes(order.status),
                            ).length
                          }
                        </strong>
                      </div>
                      <div>
                        <small>Recebimentos</small>
                        <strong>{data.receipts.length}</strong>
                      </div>
                      <div>
                        <small>Reposição sugerida</small>
                        <strong>{suggestions.length}</strong>
                      </div>
                    </>
                  )}
                </section>
                {suggestions.length > 0 && (
                  <section
                    aria-labelledby="purchase-suggestions-title"
                    className="purchases-restock"
                  >
                    <div className="purchases-section-heading">
                      <div>
                        <h2 id="purchase-suggestions-title">Sugestões de reposição</h2>
                      </div>
                      <Badge tone="warning">{suggestions.length}</Badge>
                    </div>
                    <div className="purchases-suggestions">
                      {suggestions.slice(0, 4).map((suggestion) => (
                        <div key={suggestion.inventoryItemId}>
                          <strong>{suggestion.itemName}</strong>
                          <small>
                            {suggestion.reason ?? "Reposição sugerida"} · comprar{" "}
                            {suggestion.suggestedQuantity} {suggestion.purchaseUnit}
                            {suggestion.supplierName ? ` · ${suggestion.supplierName}` : ""}
                          </small>
                          {canCreate && (
                            <Button
                              onClick={() => {
                                setEditingId(null);
                                setSupplierId(suggestion.supplierId ?? "");
                                setLines([
                                  {
                                    ...newLine(),
                                    inventoryItemId: suggestion.inventoryItemId,
                                    quantity: suggestion.suggestedQuantity,
                                  },
                                ]);
                                setOrderOpen(true);
                              }}
                              size="sm"
                              variant="ghost"
                            >
                              Criar pedido
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <section aria-labelledby="purchase-orders-title" className="purchases-panel">
                  <div className="purchases-section-heading">
                    <div>
                      <h2 id="purchase-orders-title">Pedidos de compra</h2>
                    </div>
                    <Badge>{data.page?.total ?? data.orders.length} pedido(s)</Badge>
                  </div>
                  <div className="gm-toolbar purchases-toolbar">
                    <SearchField
                      aria-label="Buscar pedido ou fornecedor"
                      className="purchases-toolbar__search"
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setPage(1);
                      }}
                      placeholder="Buscar pedido ou fornecedor"
                      value={query}
                    />
                    <label className="gm-form-field purchases-toolbar__status">
                      <span>Status</span>
                      <NativeSelect
                        onChange={(event) => {
                          setStatus(event.target.value);
                          setPage(1);
                        }}
                        value={status}
                      >
                        <option value="all">Todos os status</option>
                        <option value="draft">Rascunho</option>
                        <option value="approved">Aprovado</option>
                        <option value="partially_received">Parcial</option>
                        <option value="received">Recebido</option>
                        <option value="canceled">Cancelado</option>
                        <option value="rejected">Rejeitado</option>
                      </NativeSelect>
                    </label>
                  </div>
                  {visible.length ? (
                    <div className="purchases-orders">
                      {visible.map((order) => {
                        const orderItems = data.items.filter(
                          (item) => item.purchaseOrderId === order.id,
                        );
                        const ordered = orderItems.reduce(
                          (sum, item) => sum + decimal(item.quantity) * item.unitCostCents,
                          0,
                        );
                        const received = orderItems.reduce(
                          (sum, item) =>
                            sum +
                            Math.min(
                              decimal(item.quantity),
                              decimal(item.receivedQuantity ?? "0"),
                            ) *
                              item.unitCostCents,
                          0,
                        );
                        const percent = ordered ? Math.round((received * 100) / ordered) : 0;
                        const reversibleReceipt = data.receipts.find(
                          (receipt) =>
                            receipt.purchaseOrderId === order.id && receipt.status === "posted",
                        );
                        const cancelableInvoice = data.invoices.find(
                          (invoice) =>
                            invoice.purchaseOrderId === order.id &&
                            !["canceled", "reversed"].includes(invoice.status),
                        );
                        return (
                          <article className="purchases-order" key={order.id}>
                            <div className="purchases-order__identity">
                              <strong>{humanOrder(order.id)}</strong>
                              <span>
                                {supplierById.get(order.supplierId ?? "") ??
                                  "Fornecedor não informado"}
                              </span>
                              <small>
                                Criado em {dateLabel(order.createdAt)} · previsão{" "}
                                {dateLabel(order.expectedAt)}
                              </small>
                            </div>
                            <div className="purchases-order__total">
                              <small>Total</small>
                              <strong>{formatMoney(order.totalCents)}</strong>
                            </div>
                            <div className="purchases-order__status">
                              <Badge tone={tone(order.status)}>
                                {labels[order.status] ?? order.status}
                              </Badge>
                            </div>
                            <div className="purchases-order__progress">
                              <Progress label="Recebido" value={percent} />
                            </div>
                            <div className="purchases-actions">
                              {order.status === "draft" && canApprove && (
                                <Button
                                  disabled={busy === order.id}
                                  onClick={() =>
                                    void run(
                                      order.id,
                                      () =>
                                        api.management.approvePurchase(
                                          scope.organizationId,
                                          scope.unitId,
                                          order.id,
                                          { version: order.version },
                                          mutationKey(
                                            `purchase-approve:${order.id}:${order.version}`,
                                          ),
                                        ),
                                      "Pedido aprovado.",
                                    )
                                  }
                                  size="sm"
                                >
                                  Aprovar
                                </Button>
                              )}
                              {order.status === "draft" && canCreate && (
                                <Button onClick={() => edit(order.id)} size="sm" variant="ghost">
                                  Editar
                                </Button>
                              )}
                              {["approved", "partially_received"].includes(order.status) &&
                                canReceive && (
                                  <Button
                                    onClick={() => {
                                      setReceiptId(order.id);
                                      setReceipt(
                                        Object.fromEntries(
                                          orderItems.map((item) => [
                                            item.id,
                                            {
                                              quantity: "",
                                              locationId: "",
                                              batchCode: "",
                                              expiresAt: "",
                                            },
                                          ]),
                                        ),
                                      );
                                    }}
                                    size="sm"
                                    variant="secondary"
                                  >
                                    Receber
                                  </Button>
                                )}
                              {canInvoice &&
                                ["approved", "partially_received", "received"].includes(
                                  order.status,
                                ) && (
                                  <Button
                                    onClick={() => {
                                      setInvoiceId(order.id);
                                      setInvoiceAmount(
                                        (order.totalCents / 100).toFixed(2).replace(".", ","),
                                      );
                                      setInvoiceLineDrafts(
                                        Object.fromEntries(
                                          data.items
                                            .filter((item) => item.purchaseOrderId === order.id)
                                            .map((item) => [
                                              item.id,
                                              {
                                                quantity: item.quantity,
                                                unitCost: (item.unitCostCents / 100)
                                                  .toFixed(2)
                                                  .replace(".", ","),
                                              },
                                            ]),
                                        ),
                                      );
                                    }}
                                    size="sm"
                                    variant="ghost"
                                  >
                                    Fatura
                                  </Button>
                                )}
                              {canReverseReceipt && reversibleReceipt && (
                                <Button
                                  onClick={() => {
                                    setCorrection({
                                      id: reversibleReceipt.id,
                                      version: reversibleReceipt.version,
                                      kind: "receipt",
                                    });
                                    setCorrectionReason("");
                                  }}
                                  size="sm"
                                  variant="ghost"
                                >
                                  Estornar recebimento
                                </Button>
                              )}
                              {canCancelInvoice && cancelableInvoice && (
                                <Button
                                  onClick={() => {
                                    setCorrection({
                                      id: cancelableInvoice.id,
                                      version: cancelableInvoice.version,
                                      kind: "invoice",
                                    });
                                    setCorrectionReason("");
                                  }}
                                  size="sm"
                                  variant="ghost"
                                >
                                  Cancelar fatura
                                </Button>
                              )}
                              {order.status === "draft" && canApprove && (
                                <Button
                                  onClick={() => {
                                    setTransition({
                                      id: order.id,
                                      version: order.version,
                                      kind: "reject",
                                    });
                                    setTransitionReason("");
                                  }}
                                  size="sm"
                                  variant="ghost"
                                >
                                  Rejeitar
                                </Button>
                              )}
                              {order.status === "draft" && canApprove && (
                                <Button
                                  onClick={() => {
                                    setTransition({
                                      id: order.id,
                                      version: order.version,
                                      kind: "cancel",
                                    });
                                    setTransitionReason("");
                                  }}
                                  size="sm"
                                  variant="danger"
                                >
                                  Cancelar
                                </Button>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState
                      description={
                        query || status !== "all"
                          ? "Ajuste os filtros para localizar outro pedido."
                          : "Crie o primeiro pedido com fornecedor, itens e previsão de entrega."
                      }
                      icon="＋"
                      title="Nenhum pedido encontrado"
                    />
                  )}
                  {pages > 1 && (
                    <nav aria-label="Paginação dos pedidos" className="purchases-pagination">
                      <Button
                        disabled={page === 1}
                        onClick={() => setPage((current) => current - 1)}
                        size="sm"
                        variant="ghost"
                      >
                        Anterior
                      </Button>
                      <span>
                        Página {page} de {pages}
                      </span>
                      <Button
                        disabled={page === pages}
                        onClick={() => setPage((current) => current + 1)}
                        size="sm"
                        variant="ghost"
                      >
                        Próxima
                      </Button>
                    </nav>
                  )}
                </section>
                <Modal
                  isOpen={supplierOpen}
                  onClose={() => setSupplierOpen(false)}
                  title="Fornecedores"
                >
                  <form className="gm-form-stack" onSubmit={(event) => void submitSupplier(event)}>
                    <label className="gm-form-field">
                      <span>Nome</span>
                      <Input
                        onChange={(event) => setSupplierName(event.target.value)}
                        required
                        value={supplierName}
                      />
                    </label>
                    <label className="gm-form-field">
                      <span>E-mail</span>
                      <Input
                        onChange={(event) => setSupplierEmail(event.target.value)}
                        type="email"
                        value={supplierEmail}
                      />
                    </label>
                    <label className="gm-form-field">
                      <span>CPF/CNPJ</span>
                      <Input
                        onChange={(event) => setSupplierDocument(event.target.value)}
                        value={supplierDocument}
                      />
                    </label>
                    <label className="gm-form-field">
                      <span>Contato</span>
                      <Input
                        onChange={(event) => setSupplierContact(event.target.value)}
                        value={supplierContact}
                      />
                    </label>
                    <label className="gm-form-field">
                      <span>Telefone</span>
                      <Input
                        onChange={(event) => setSupplierPhone(event.target.value)}
                        value={supplierPhone}
                      />
                    </label>
                    <label className="gm-form-field">
                      <span>Endereço</span>
                      <Input
                        onChange={(event) => setSupplierAddress(event.target.value)}
                        value={supplierAddress}
                      />
                    </label>
                    <label className="gm-form-field">
                      <span>Observações</span>
                      <Textarea
                        onChange={(event) => setSupplierNotes(event.target.value)}
                        value={supplierNotes}
                      />
                    </label>
                    <div className="purchases-modal-actions">
                      <Button onClick={() => setSupplierOpen(false)} variant="ghost">
                        Fechar
                      </Button>
                      <Button disabled={busy === "supplier" || !supplierName.trim()} type="submit">
                        {editingSupplierId ? "Salvar fornecedor" : "Cadastrar fornecedor"}
                      </Button>
                    </div>
                  </form>
                  <div className="purchases-suppliers">
                    {supplierDirectory.map((supplier) => (
                      <div key={supplier.id}>
                        <strong>{supplier.name}</strong>
                        <small>
                          {supplier.email ?? "Sem e-mail"} · {supplier.active ? "Ativo" : "Inativo"}
                        </small>
                        <div className="purchases-actions">
                          <Button
                            onClick={() => {
                              setEditingSupplierId(supplier.id);
                              setSupplierName(supplier.name);
                              setSupplierEmail(supplier.email ?? "");
                              setSupplierDocument(supplier.document ?? "");
                              setSupplierContact(supplier.contactName ?? "");
                              setSupplierPhone(supplier.phone ?? "");
                              setSupplierAddress(supplier.address ?? "");
                              setSupplierNotes(supplier.notes ?? "");
                            }}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Editar
                          </Button>
                          {supplier.active && (
                            <Button
                              onClick={() =>
                                void run(
                                  `archive-${supplier.id}`,
                                  () =>
                                    api.management.archiveSupplier(
                                      scope.organizationId,
                                      scope.unitId,
                                      supplier.id,
                                      { version: supplier.version },
                                      mutationKey(
                                        `supplier-archive:${supplier.id}:${supplier.version}`,
                                      ),
                                    ),
                                  "Fornecedor inativado.",
                                ).then((saved) => {
                                  if (saved) suppliers.retry();
                                })
                              }
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              Inativar
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Modal>
                <Modal
                  isOpen={orderOpen}
                  onClose={() => setOrderOpen(false)}
                  size="xl"
                  title={editingId ? "Editar pedido de compra" : "Novo pedido de compra"}
                >
                  <form className="gm-form-stack" onSubmit={(event) => void submitOrder(event)}>
                    <div className="gm-form-grid">
                      <label className="gm-form-field">
                        <span>Fornecedor</span>
                        <NativeSelect
                          onChange={(event) => setSupplierId(event.target.value)}
                          required
                          value={supplierId}
                        >
                          <option value="">Selecione</option>
                          {supplierList.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                      <label className="gm-form-field">
                        <span>Previsão de entrega</span>
                        <Input
                          onChange={(event) => setExpectedAt(event.target.value)}
                          type="datetime-local"
                          value={expectedAt}
                        />
                      </label>
                    </div>
                    <fieldset className="purchases-lines">
                      <legend>Itens do pedido</legend>
                      {lines.map((line, index) => {
                        const item = itemById.get(line.inventoryItemId);
                        return (
                          <div className="purchases-line" key={line.key}>
                            <label className="gm-form-field">
                              <span>Item de estoque</span>
                              <NativeSelect
                                onChange={(event) =>
                                  patchLine(line.key, { inventoryItemId: event.target.value })
                                }
                                required
                                value={line.inventoryItemId}
                              >
                                <option value="">Selecione</option>
                                {stock.items
                                  .filter((candidate) => candidate.active)
                                  .map((candidate) => (
                                    <option key={candidate.id} value={candidate.id}>
                                      {candidate.name}
                                    </option>
                                  ))}
                              </NativeSelect>
                              <small>
                                {item?.purchaseUnit
                                  ? `${item.purchaseUnit}${item.purchaseToStockFactor !== 1 ? ` = ${item.purchaseToStockFactor} ${item.unit}` : ""}`
                                  : item?.unit}
                              </small>
                            </label>
                            <label className="gm-form-field">
                              <span>Quantidade</span>
                              <Input
                                inputMode="decimal"
                                onChange={(event) =>
                                  patchLine(line.key, { quantity: event.target.value })
                                }
                                required
                                value={line.quantity}
                              />
                            </label>
                            <label className="gm-form-field">
                              <span>Custo unitário (R$)</span>
                              <Input
                                inputMode="decimal"
                                data-currency="brl"
                                onChange={(event) =>
                                  patchLine(line.key, { unitCost: event.target.value })
                                }
                                required
                                value={line.unitCost}
                              />
                            </label>
                            <Button
                              aria-label={`Remover item ${index + 1}`}
                              disabled={lines.length === 1}
                              onClick={() =>
                                setLines((all) =>
                                  all.filter((candidate) => candidate.key !== line.key),
                                )
                              }
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              Remover
                            </Button>
                          </div>
                        );
                      })}
                      <Button
                        onClick={() => setLines((all) => [...all, newLine()])}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Adicionar item
                      </Button>
                    </fieldset>
                    <div className="purchases-total">
                      <span>Total estimado</span>
                      <strong>{formatMoney(total)}</strong>
                    </div>
                    <div className="purchases-modal-actions">
                      <Button onClick={() => setOrderOpen(false)} variant="ghost">
                        Cancelar
                      </Button>
                      <Button
                        disabled={
                          busy === "order" ||
                          !supplierId ||
                          lines.some(
                            (line) =>
                              !line.inventoryItemId ||
                              decimal(line.quantity) <= 0 ||
                              currencyToCents(line.unitCost) <= 0,
                          )
                        }
                        type="submit"
                      >
                        {busy === "order"
                          ? "Salvando…"
                          : editingId
                            ? "Salvar pedido"
                            : "Criar pedido"}
                      </Button>
                    </div>
                  </form>
                </Modal>
                <InvoiceImportModal
                  items={stock.items}
                  locations={stock.locations}
                  orderItems={data.items}
                  orders={data.orders}
                  invoices={data.invoices}
                  onClose={() => setNfeOpen(false)}
                  onDone={() => {
                    setNfeOpen(false);
                    setToast({
                      tone: "success",
                      message: "NF-e confirmada e estoque atualizado com auditoria.",
                    });
                    purchases.retry();
                    inventory.retry();
                  }}
                  open={nfeOpen}
                  products={catalog.state.status === "ready" ? catalog.state.data.products : []}
                  scope={scope}
                  suppliers={supplierDirectory}
                />
                <Modal
                  isOpen={Boolean(selectedReceipt)}
                  onClose={() => setReceiptId(null)}
                  size="xl"
                  title={
                    selectedReceipt ? `Receber ${humanOrder(selectedReceipt.id)}` : "Receber pedido"
                  }
                >
                  <form className="gm-form-stack" onSubmit={(event) => void submitReceipt(event)}>
                    <p className="purchases-note">
                      Informe somente o que chegou agora. O restante fica pendente no pedido.
                    </p>
                    <fieldset className="purchases-lines">
                      <legend>Linhas restantes</legend>
                      {receiptItems.map((item) => {
                        const snapshot = item as typeof item & {
                          purchaseUnit?: string | null;
                          stockUnit?: string | null;
                        };
                        const draft = receipt[item.id] ?? {
                          quantity: "",
                          locationId: "",
                          batchCode: "",
                          expiresAt: "",
                        };
                        const remaining = Math.max(
                          0,
                          decimal(item.quantity) - decimal(item.receivedQuantity ?? "0"),
                        );
                        return (
                          <div className="purchases-receipt-line" key={item.id}>
                            <strong>
                              {itemById.get(item.inventoryItemId)?.name ?? "Item"}
                              <small>
                                Restante: {remaining}{" "}
                                {snapshot.purchaseUnit ??
                                  snapshot.stockUnit ??
                                  itemById.get(item.inventoryItemId)?.purchaseUnit ??
                                  itemById.get(item.inventoryItemId)?.unit ??
                                  "un"}
                              </small>
                            </strong>
                            <label className="gm-form-field">
                              <span>Quantidade</span>
                              <Input
                                inputMode="decimal"
                                onChange={(event) =>
                                  setReceipt((all) => ({
                                    ...all,
                                    [item.id]: { ...draft, quantity: event.target.value },
                                  }))
                                }
                                value={draft.quantity}
                              />
                            </label>
                            <label className="gm-form-field">
                              <span>Local de entrada</span>
                              <NativeSelect
                                onChange={(event) =>
                                  setReceipt((all) => ({
                                    ...all,
                                    [item.id]: { ...draft, locationId: event.target.value },
                                  }))
                                }
                                value={draft.locationId}
                              >
                                <option value="">Selecione</option>
                                {stock.locations
                                  .filter((location) => location.active)
                                  .map((location) => (
                                    <option key={location.id} value={location.id}>
                                      {location.name}
                                    </option>
                                  ))}
                              </NativeSelect>
                            </label>
                            <label className="gm-form-field">
                              <span>Lote</span>
                              <Input
                                onChange={(event) =>
                                  setReceipt((all) => ({
                                    ...all,
                                    [item.id]: { ...draft, batchCode: event.target.value },
                                  }))
                                }
                                value={draft.batchCode}
                              />
                            </label>
                            <label className="gm-form-field">
                              <span>Validade</span>
                              <Input
                                onChange={(event) =>
                                  setReceipt((all) => ({
                                    ...all,
                                    [item.id]: { ...draft, expiresAt: event.target.value },
                                  }))
                                }
                                type="date"
                                value={draft.expiresAt}
                              />
                            </label>
                          </div>
                        );
                      })}
                    </fieldset>
                    <div className="purchases-modal-actions">
                      <Button onClick={() => setReceiptId(null)} variant="ghost">
                        Cancelar
                      </Button>
                      <Button
                        disabled={
                          busy === "receipt" ||
                          !receiptItems.some(
                            (item) =>
                              decimal(receipt[item.id]?.quantity ?? "") > 0 &&
                              receipt[item.id]?.locationId,
                          )
                        }
                        type="submit"
                      >
                        Confirmar recebimento
                      </Button>
                    </div>
                  </form>
                </Modal>
                <Modal
                  isOpen={Boolean(selectedInvoice)}
                  onClose={() => setInvoiceId(null)}
                  title="Registrar fatura"
                >
                  <form className="gm-form-stack" onSubmit={(event) => void submitInvoice(event)}>
                    <label className="gm-form-field">
                      <span>Documento fiscal / fatura</span>
                      <Input
                        onChange={(event) => setDocumentNumber(event.target.value)}
                        required
                        value={documentNumber}
                      />
                    </label>
                    <div className="gm-form-grid">
                      <label className="gm-form-field">
                        <span>Chave de acesso NF-e (44 dígitos)</span>
                        <Input
                          inputMode="numeric"
                          maxLength={44}
                          onChange={(event) =>
                            setInvoiceAccessKey(event.target.value.replace(/\D/g, "").slice(0, 44))
                          }
                          pattern="\d{44}"
                          placeholder="Somente números"
                          value={invoiceAccessKey}
                        />
                      </label>
                      <label className="gm-form-field">
                        <span>Série</span>
                        <Input
                          inputMode="numeric"
                          maxLength={3}
                          onChange={(event) =>
                            setInvoiceSeries(event.target.value.replace(/\D/g, "").slice(0, 3))
                          }
                          value={invoiceSeries}
                        />
                      </label>
                      <label className="gm-form-field">
                        <span>Modelo fiscal</span>
                        <NativeSelect
                          onChange={(event) => setInvoiceModel(event.target.value)}
                          value={invoiceModel}
                        >
                          <option value="55">55 · NF-e</option>
                          <option value="65">65 · NFC-e</option>
                        </NativeSelect>
                      </label>
                      <label className="gm-form-field">
                        <span>Total de tributos (R$)</span>
                        <Input
                          inputMode="decimal"
                          data-currency="brl"
                          onChange={(event) => setInvoiceTaxTotal(event.target.value)}
                          value={invoiceTaxTotal}
                        />
                      </label>
                    </div>
                    <label className="gm-form-field">
                      <span>XML da NF-e (opcional, até 2 MB)</span>
                      <input
                        accept=".xml,application/xml,text/xml"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) {
                            setInvoiceXml(null);
                            return;
                          }
                          if (file.size > 2_000_000 || !file.name.toLowerCase().endsWith(".xml")) {
                            setInvoiceXml(null);
                            setToast({
                              tone: "danger",
                              message: "Selecione um arquivo XML de até 2 MB.",
                            });
                            event.target.value = "";
                            return;
                          }
                          void file
                            .text()
                            .then((content) => setInvoiceXml({ name: file.name, content }));
                        }}
                        type="file"
                      />
                      <small>
                        {invoiceXml
                          ? `${invoiceXml.name} pronto para envio.`
                          : "O navegador apenas lê e envia o texto; os campos fiscais continuam manuais."}
                      </small>
                    </label>
                    <label className="gm-form-field">
                      <span>Emissão</span>
                      <Input
                        onChange={(event) => setInvoiceIssuedAt(event.target.value)}
                        required
                        type="date"
                        value={invoiceIssuedAt}
                      />
                    </label>
                    <label className="gm-form-field">
                      <span>Competência</span>
                      <Input
                        onChange={(event) => setInvoiceCompetenceDate(event.target.value)}
                        required
                        type="date"
                        value={invoiceCompetenceDate}
                      />
                    </label>
                    <label className="gm-form-field">
                      <span>Vencimento</span>
                      <Input
                        onChange={(event) => setInvoiceDueDate(event.target.value)}
                        required
                        type="date"
                        value={invoiceDueDate}
                      />
                    </label>
                    <label className="gm-form-field">
                      <span>Tolerância para conciliação (R$)</span>
                      <Input
                        inputMode="decimal"
                        data-currency="brl"
                        onChange={(event) => setInvoiceTolerance(event.target.value)}
                        value={invoiceTolerance}
                      />
                    </label>
                    <label className="gm-form-field">
                      <span>Valor da fatura (R$)</span>
                      <Input
                        inputMode="decimal"
                        data-currency="brl"
                        onChange={(event) => setInvoiceAmount(event.target.value)}
                        required
                        value={invoiceAmount}
                      />
                    </label>
                    <fieldset className="purchases-lines">
                      <legend>Linhas faturadas</legend>
                      {data.items
                        .filter((item) => item.purchaseOrderId === invoiceId)
                        .map((item) => {
                          const draft = invoiceLineDrafts[item.id] ?? {
                            quantity: item.quantity,
                            unitCost: (item.unitCostCents / 100).toFixed(2).replace(".", ","),
                          };
                          return (
                            <div className="purchases-line" key={item.id}>
                              <strong>{itemById.get(item.inventoryItemId)?.name ?? "Item"}</strong>
                              <label className="gm-form-field">
                                <span>Quantidade</span>
                                <Input
                                  inputMode="decimal"
                                  data-currency="brl"
                                  onChange={(event) =>
                                    setInvoiceLineDrafts((all) => ({
                                      ...all,
                                      [item.id]: { ...draft, quantity: event.target.value },
                                    }))
                                  }
                                  value={draft.quantity}
                                />
                              </label>
                              <label className="gm-form-field">
                                <span>Custo (R$)</span>
                                <Input
                                  inputMode="decimal"
                                  onChange={(event) =>
                                    setInvoiceLineDrafts((all) => ({
                                      ...all,
                                      [item.id]: { ...draft, unitCost: event.target.value },
                                    }))
                                  }
                                  value={draft.unitCost}
                                />
                              </label>
                            </div>
                          );
                        })}
                    </fieldset>
                    {selectedInvoice &&
                      currencyToCents(invoiceAmount) !== selectedInvoice.totalCents && (
                        <p className="purchases-divergence" role="status">
                          Divergência: pedido {formatMoney(selectedInvoice.totalCents)} · fatura{" "}
                          {formatMoney(Math.max(0, currencyToCents(invoiceAmount)))}
                        </p>
                      )}
                    {registeredInvoice && registeredInvoice.reconciliationLines.length > 0 && (
                      <section
                        aria-labelledby="purchase-line-reconciliation"
                        className="purchases-reconciliation"
                      >
                        <div className="purchases-reconciliation__heading">
                          <strong id="purchase-line-reconciliation">Conciliação por item</strong>
                          <Badge
                            tone={registeredInvoice.status === "divergent" ? "warning" : "success"}
                          >
                            {registeredInvoice.status === "divergent"
                              ? "Com divergências"
                              : "Conciliada"}
                          </Badge>
                        </div>
                        <div className="purchases-reconciliation__lines">
                          {registeredInvoice.reconciliationLines.map((line, index) => {
                            const purchaseOrderItemId = String(line.purchaseOrderItemId ?? "");
                            const orderItem = data.items.find(
                              (item) => item.id === purchaseOrderItemId,
                            );
                            const itemName = orderItem
                              ? (itemById.get(orderItem.inventoryItemId)?.name ?? "Item")
                              : `Item ${index + 1}`;
                            const matched = line.matched === true;
                            return (
                              <div data-matched={matched} key={purchaseOrderItemId || index}>
                                <strong>{itemName}</strong>
                                <span>
                                  Pedido {String(line.orderedQuantity ?? "0")} · recebido{" "}
                                  {String(line.receivedQuantity ?? "0")} · faturado{" "}
                                  {String(line.invoicedQuantity ?? "0")}
                                </span>
                                <small>
                                  Custo pedido {formatMoney(Number(line.orderedUnitCostCents ?? 0))}{" "}
                                  · fatura {formatMoney(Number(line.invoicedUnitCostCents ?? 0))}
                                </small>
                                <Badge tone={matched ? "success" : "warning"}>
                                  {matched ? "Conforme" : "Revisar"}
                                </Badge>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}
                    <div className="purchases-modal-actions">
                      <Button onClick={() => setInvoiceId(null)} variant="ghost">
                        Cancelar
                      </Button>
                      <Button
                        disabled={
                          busy === "invoice" ||
                          !documentNumber.trim() ||
                          !invoiceDueDate ||
                          !invoiceIssuedAt ||
                          !invoiceCompetenceDate ||
                          (invoiceAccessKey.length > 0 && invoiceAccessKey.length !== 44) ||
                          Boolean(invoiceAccessKey) !== Boolean(invoiceXml) ||
                          (Boolean(invoiceAccessKey) && !/^\d{1,3}$/.test(invoiceSeries)) ||
                          currencyToCents(invoiceAmount) <= 0 ||
                          (Boolean(invoiceAccessKey) && currencyToCents(invoiceTaxTotal) < 0) ||
                          currencyToCents(invoiceTolerance) < 0
                        }
                        type="submit"
                      >
                        Registrar fatura
                      </Button>
                      {canReconcile &&
                        data.invoices.find((invoice) => invoice.purchaseOrderId === invoiceId) && (
                          <Button
                            onClick={() => {
                              const invoice = data.invoices.find(
                                (candidate) => candidate.purchaseOrderId === invoiceId,
                              );
                              if (invoice)
                                void run(
                                  "reconcile",
                                  () =>
                                    api.management.reconcilePurchaseInvoice(
                                      scope.organizationId,
                                      scope.unitId,
                                      invoice.id,
                                      {
                                        toleranceCents: currencyToCents(invoiceTolerance),
                                        version: invoice.version,
                                      },
                                      mutationKey(
                                        `purchase-reconcile:${invoice.id}:${invoice.version}:${invoiceTolerance}`,
                                      ),
                                    ),
                                  "Conciliação confirmada.",
                                );
                            }}
                            type="button"
                            variant="secondary"
                          >
                            Conciliar
                          </Button>
                        )}
                      {canConfirmInvoice &&
                        data.invoices.find((invoice) => invoice.purchaseOrderId === invoiceId) && (
                          <Button
                            onClick={() => {
                              const invoice = data.invoices.find(
                                (candidate) => candidate.purchaseOrderId === invoiceId,
                              );
                              if (invoice)
                                void run(
                                  "confirm-invoice",
                                  () =>
                                    api.management.confirmPurchaseInvoice(
                                      scope.organizationId,
                                      scope.unitId,
                                      invoice.id,
                                      { acceptDivergence: false, version: invoice.version },
                                      mutationKey(
                                        `purchase-confirm-invoice:${invoice.id}:${invoice.version}`,
                                      ),
                                    ),
                                  "Fatura confirmada.",
                                );
                            }}
                            type="button"
                            variant="secondary"
                          >
                            Confirmar
                          </Button>
                        )}
                    </div>
                  </form>
                </Modal>
                <Modal
                  isOpen={Boolean(transition)}
                  onClose={() => setTransition(null)}
                  title={transition?.kind === "reject" ? "Rejeitar pedido" : "Cancelar pedido"}
                >
                  <form
                    className="gm-form-stack"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!transition) return;
                      const action =
                        transition.kind === "reject"
                          ? api.management.rejectPurchase
                          : api.management.cancelPurchase;
                      void run(
                        `transition-${transition.id}`,
                        () =>
                          action(
                            scope.organizationId,
                            scope.unitId,
                            transition.id,
                            { reason: transitionReason.trim(), version: transition.version },
                            mutationKey(
                              `purchase-${transition.kind}:${transition.id}:${transition.version}:${transitionReason.trim()}`,
                            ),
                          ),
                        transition.kind === "reject" ? "Pedido rejeitado." : "Pedido cancelado.",
                      ).then((saved) => {
                        if (saved) setTransition(null);
                      });
                    }}
                  >
                    <label className="gm-form-field">
                      <span>Motivo</span>
                      <Textarea
                        minLength={3}
                        onChange={(event) => setTransitionReason(event.target.value)}
                        required
                        value={transitionReason}
                      />
                    </label>
                    <div className="purchases-modal-actions">
                      <Button onClick={() => setTransition(null)} variant="ghost">
                        Voltar
                      </Button>
                      <Button
                        disabled={
                          busy.startsWith("transition-") || transitionReason.trim().length < 3
                        }
                        type="submit"
                        variant={transition?.kind === "cancel" ? "danger" : "secondary"}
                      >
                        Confirmar
                      </Button>
                    </div>
                  </form>
                </Modal>
                <Modal
                  isOpen={Boolean(correction)}
                  onClose={() => setCorrection(null)}
                  title={
                    correction?.kind === "receipt" ? "Estornar recebimento" : "Cancelar fatura"
                  }
                >
                  <form
                    className="gm-form-stack"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!correction) return;
                      const action =
                        correction.kind === "receipt"
                          ? api.management.reversePurchaseReceipt
                          : api.management.cancelPurchaseInvoice;
                      void run(
                        `correction-${correction.id}`,
                        () =>
                          action(
                            scope.organizationId,
                            scope.unitId,
                            correction.id,
                            { reason: correctionReason.trim(), version: correction.version },
                            mutationKey(
                              `purchase-${correction.kind}-correction:${correction.id}:${correction.version}:${correctionReason.trim()}`,
                            ),
                          ),
                        correction.kind === "receipt"
                          ? "Recebimento estornado."
                          : "Fatura cancelada.",
                      ).then((saved) => {
                        if (saved) setCorrection(null);
                      });
                    }}
                  >
                    <p className="purchases-note">
                      Esta ação gera um registro compensatório e exige justificativa para auditoria.
                    </p>
                    <label className="gm-form-field">
                      <span>Motivo</span>
                      <Textarea
                        minLength={3}
                        onChange={(event) => setCorrectionReason(event.target.value)}
                        required
                        value={correctionReason}
                      />
                    </label>
                    <div className="purchases-modal-actions">
                      <Button onClick={() => setCorrection(null)} variant="ghost">
                        Voltar
                      </Button>
                      <Button
                        disabled={
                          busy.startsWith("correction-") || correctionReason.trim().length < 3
                        }
                        type="submit"
                        variant="danger"
                      >
                        Confirmar ação
                      </Button>
                    </div>
                  </form>
                </Modal>
              </div>
            );
          }}
        </RemoteGate>
      )}
    </RemoteGate>
  );
}
