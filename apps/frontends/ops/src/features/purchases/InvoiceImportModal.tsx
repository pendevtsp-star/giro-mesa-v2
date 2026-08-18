import { Badge, Button, Modal } from "@giromesa/ui";
import { useRef, useState } from "react";
import { api } from "../../api";
import {
  type InventoryItem,
  type InventoryItemKind,
  type ManagementScope,
  operationalKey,
  type RecipeProduct,
  record,
  requiredString,
  type StockLocation,
  type Supplier,
} from "../../management.shared";
import { formatMoney } from "../../rules";

type ReviewStatus = "matched" | "suggested" | "new" | "conflict" | "ignored";

interface ImportLine {
  id: string;
  status: ReviewStatus;
  inventoryItemId: string;
  description: string;
  supplierProductCode: string;
  gtin: string;
  purchaseUnit: string;
  quantity: string;
  unitCostCents: number;
  totalCents: number;
  matchScore: number | null;
  kind: InventoryItemKind;
  stockUnit: string;
  factor: string;
  productId: string;
}

interface ImportDraft {
  id: string;
  accessKey: string;
  documentNumber: string;
  totalCents: number;
  supplierId: string;
  lines: ImportLine[];
}

const statusView: Record<
  ReviewStatus,
  { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }
> = {
  matched: { label: "Vinculado", tone: "success" },
  suggested: { label: "Sugerido", tone: "info" },
  new: { label: "Novo", tone: "warning" },
  conflict: { label: "Conflito", tone: "danger" },
  ignored: { label: "Ignorado", tone: "neutral" },
};

function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === null || value === undefined
      ? ""
      : String(value);
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function normalizeStatus(value: unknown): ReviewStatus {
  return value === "matched" ||
    value === "suggested" ||
    value === "new" ||
    value === "conflict" ||
    value === "ignored"
    ? value
    : "new";
}

export function parseImport(value: unknown, selectedSupplierId: string): ImportDraft {
  const payload = record(value);
  const header =
    payload.import && typeof payload.import === "object" ? record(payload.import) : payload;
  const rawLines = Array.isArray(payload.lines)
    ? payload.lines
    : Array.isArray(header.lines)
      ? header.lines
      : [];
  return {
    id: requiredString(header.id ?? header.importId),
    accessKey: text(header.accessKey),
    documentNumber: text(header.documentNumber),
    totalCents: money(header.totalCents),
    supplierId: text(header.supplierId) || selectedSupplierId,
    lines: rawLines.map((candidate) => {
      const line = record(candidate);
      return {
        id: requiredString(line.id ?? line.lineId),
        status: normalizeStatus(line.status),
        inventoryItemId: text(line.inventoryItemId),
        description: text(line.description),
        supplierProductCode: text(line.supplierProductCode),
        gtin: text(line.gtin),
        purchaseUnit: text(line.purchaseUnit) || "un",
        quantity: text(line.quantity),
        unitCostCents: money(line.unitCostCents),
        totalCents: money(line.totalCents),
        matchScore:
          line.matchScore === null || line.matchScore === undefined
            ? null
            : Number(line.matchScore),
        kind: "ingredient",
        stockUnit: text(line.purchaseUnit).toLocaleLowerCase("pt-BR") || "un",
        factor: text(line.purchaseToStockFactor) || "1",
        productId: "",
      };
    }),
  };
}

export function InvoiceImportModal({
  open,
  scope,
  items,
  locations,
  suppliers,
  products,
  onClose,
  onDone,
}: {
  open: boolean;
  scope: ManagementScope;
  items: InventoryItem[];
  locations: StockLocation[];
  suppliers: Supplier[];
  products: RecipeProduct[];
  onClose: () => void;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [busy, setBusy] = useState<"upload" | "review" | "confirm" | "">("");
  const [reviewed, setReviewed] = useState(false);
  const [acceptDivergence, setAcceptDivergence] = useState(false);
  const [divergenceReason, setDivergenceReason] = useState("");
  const [error, setError] = useState("");

  function patchLine(id: string, patch: Partial<ImportLine>) {
    setReviewed(false);
    setDraft((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
          }
        : current,
    );
  }

  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setError("O XML da NF-e deve ter no máximo 5 MB.");
      return;
    }
    setBusy("upload");
    setError("");
    try {
      const imported = await api.management.importNfe(
        scope.organizationId,
        scope.unitId,
        { xml: await file.text(), supplierId: supplierId || undefined },
        operationalKey("nfe-import"),
      );
      const parsed = parseImport(imported, supplierId);
      setDraft(parsed);
      setSupplierId(parsed.supplierId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível ler a NF-e.");
    } finally {
      setBusy("");
    }
  }

  async function review() {
    if (!draft) return;
    setBusy("review");
    setError("");
    try {
      await api.management.reviewNfeImport(
        scope.organizationId,
        scope.unitId,
        draft.id,
        {
          supplierId: supplierId || undefined,
          lines: draft.lines.map((line) => ({
            lineId: line.id,
            status:
              line.status === "ignored" ? "ignored" : line.inventoryItemId ? "matched" : "new",
            inventoryItemId: line.inventoryItemId || undefined,
            newItem:
              line.inventoryItemId || line.status === "ignored"
                ? undefined
                : {
                    name: line.description,
                    kind: line.kind,
                    productId: line.kind === "resale" ? line.productId : undefined,
                    unit: line.stockUnit,
                    sku: line.supplierProductCode || undefined,
                    barcode: line.gtin || undefined,
                    purchaseUnit: line.purchaseUnit,
                    purchaseToStockFactor: line.factor,
                  },
          })),
        },
        operationalKey("nfe-review"),
      );
      setReviewed(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar a revisão.");
    } finally {
      setBusy("");
    }
  }

  async function confirm() {
    if (!draft || !locationId || !reviewed) return;
    setBusy("confirm");
    setError("");
    try {
      await api.management.confirmNfeImport(
        scope.organizationId,
        scope.unitId,
        draft.id,
        {
          locationId,
          acceptTotalDivergence: divergence !== 0 ? acceptDivergence : undefined,
          divergenceReason: divergence !== 0 ? divergenceReason.trim() : undefined,
        },
        operationalKey("nfe-confirm"),
      );
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível confirmar a entrada.");
    } finally {
      setBusy("");
    }
  }

  const unresolved = draft?.lines.some(
    (line) =>
      line.status !== "ignored" &&
      !line.inventoryItemId &&
      (!line.description ||
        !line.stockUnit ||
        Number(line.factor) <= 0 ||
        (line.kind === "resale" && !line.productId)),
  );
  const linesTotal = draft?.lines.reduce((sum, line) => sum + line.totalCents, 0) ?? 0;
  const divergence = draft ? draft.totalCents - linesTotal : 0;
  return (
    <Modal isOpen={open} onClose={onClose} size="xl" title="Importar NF-e de compra">
      <div className="gm-form-stack">
        <p className="purchases-note">
          O XML é revisado antes da entrada. O estoque só muda após a confirmação explícita do
          recebimento.
        </p>
        {error && (
          <p className="purchases-divergence" role="alert">
            {error}
          </p>
        )}
        {!draft ? (
          <>
            <label className="gm-form-field">
              <span>Fornecedor, se já cadastrado</span>
              <select onChange={(event) => setSupplierId(event.target.value)} value={supplierId}>
                <option value="">Identificar pelo CNPJ da NF-e</option>
                {suppliers
                  .filter((supplier) => supplier.active)
                  .map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="gm-form-field">
              <span>Arquivo XML da NF-e</span>
              <input
                accept=".xml,application/xml,text/xml"
                disabled={busy === "upload"}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
                ref={fileRef}
                type="file"
              />
            </label>
          </>
        ) : (
          <>
            <div className="purchases-total">
              <span>
                NF-e {draft.documentNumber || "sem número"} · chave{" "}
                {draft.accessKey || "não informada"}
              </span>
              <strong>{formatMoney(draft.totalCents)}</strong>
            </div>
            <label className="gm-form-field">
              <span>Fornecedor</span>
              <select
                onChange={(event) => {
                  setSupplierId(event.target.value);
                  setReviewed(false);
                }}
                required
                value={supplierId}
              >
                <option value="">Selecione</option>
                {suppliers
                  .filter((supplier) => supplier.active)
                  .map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
              </select>
            </label>
            <ul className="nfe-review-lines" aria-label="Linhas da NF-e">
              {draft.lines.map((line) => {
                const status = statusView[line.status];
                return (
                  <li className="nfe-review-line" key={line.id}>
                    <div>
                      <strong>{line.description}</strong>
                      <small>
                        {line.supplierProductCode || "Sem código"} · {line.quantity}{" "}
                        {line.purchaseUnit} · {formatMoney(line.totalCents)}
                      </small>
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <label className="gm-form-field">
                      <span>Vínculo</span>
                      <select
                        onChange={(event) => {
                          const inventoryItemId = event.target.value;
                          patchLine(line.id, {
                            inventoryItemId,
                            status: inventoryItemId ? "matched" : "new",
                          });
                        }}
                        value={line.inventoryItemId}
                      >
                        <option value="">Criar novo item</option>
                        {items
                          .filter((item) => item.active)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    {!line.inventoryItemId && line.status !== "ignored" && (
                      <div className="nfe-new-item-fields">
                        <label className="gm-form-field">
                          <span>Tipo</span>
                          <select
                            onChange={(event) =>
                              patchLine(line.id, { kind: event.target.value as InventoryItemKind })
                            }
                            value={line.kind}
                          >
                            <option value="ingredient">Insumo</option>
                            <option value="prepared">Preparado</option>
                            <option value="resale">Revenda</option>
                            <option value="reusable">Utensílio/mobiliário</option>
                            <option value="returnable_container">Vasilhame</option>
                          </select>
                        </label>
                        <label className="gm-form-field">
                          <span>Unidade de estoque</span>
                          <input
                            onChange={(event) =>
                              patchLine(line.id, { stockUnit: event.target.value })
                            }
                            value={line.stockUnit}
                          />
                        </label>
                        <label className="gm-form-field">
                          <span>Conversão</span>
                          <input
                            inputMode="decimal"
                            onChange={(event) => patchLine(line.id, { factor: event.target.value })}
                            value={line.factor}
                          />
                        </label>
                        {line.kind === "resale" && (
                          <label className="gm-form-field">
                            <span>Produto do Cardápio</span>
                            <select
                              onChange={(event) =>
                                patchLine(line.id, { productId: event.target.value })
                              }
                              required
                              value={line.productId}
                            >
                              <option value="">Selecione</option>
                              {products
                                .filter((product) => product.active)
                                .map((product) => (
                                  <option key={product.id} value={product.id}>
                                    {product.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                      </div>
                    )}
                    <Button
                      onClick={() =>
                        patchLine(line.id, {
                          status: line.status === "ignored" ? "new" : "ignored",
                          inventoryItemId: "",
                        })
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {line.status === "ignored" ? "Revisar" : "Ignorar"}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {reviewed && (
              <>
                <label className="gm-form-field">
                  <span>Local de entrada</span>
                  <select
                    onChange={(event) => setLocationId(event.target.value)}
                    required
                    value={locationId}
                  >
                    <option value="">Selecione</option>
                    {locations
                      .filter((location) => location.active)
                      .map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                  </select>
                </label>
                {divergence !== 0 && (
                  <div className="gm-form-stack purchases-divergence" role="status">
                    <strong>Divergência de {formatMoney(Math.abs(divergence))}</strong>
                    <small>
                      Total dos itens {formatMoney(linesTotal)} · NF-e{" "}
                      {formatMoney(draft.totalCents)}.
                    </small>
                    <label>
                      <input
                        checked={acceptDivergence}
                        onChange={(event) => setAcceptDivergence(event.target.checked)}
                        type="checkbox"
                      />{" "}
                      Aceito confirmar esta divergência
                    </label>
                    <label className="gm-form-field">
                      <span>Motivo</span>
                      <textarea
                        minLength={5}
                        onChange={(event) => setDivergenceReason(event.target.value)}
                        required
                        value={divergenceReason}
                      />
                    </label>
                  </div>
                )}
              </>
            )}
          </>
        )}
        <div className="purchases-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          {draft && !reviewed && (
            <Button
              disabled={busy === "review" || !supplierId || unresolved}
              onClick={() => void review()}
            >
              {busy === "review" ? "Salvando revisão…" : "Salvar vínculos"}
            </Button>
          )}
          {draft && reviewed && (
            <Button
              disabled={
                busy === "confirm" ||
                !locationId ||
                (divergence !== 0 && (!acceptDivergence || divergenceReason.trim().length < 5))
              }
              onClick={() => void confirm()}
            >
              {busy === "confirm" ? "Confirmando…" : "Confirmar entrada no estoque"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
