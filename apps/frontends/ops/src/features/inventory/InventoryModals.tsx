import { Button, Input, Label, Modal, NativeSelect, Textarea } from "@giromesa/ui";
import { useEffect, useMemo, useState } from "react";
import type {
  InterunitTransfer,
  InventoryAsset,
  InventoryItem,
  InventoryItemKind,
  InventoryLot,
  InventoryReservation,
  InventoryReviewRequest,
  InventoryTransfer,
  ProductionBatch,
  ReturnableMovement,
  ReturnablePosition,
  StockLocation,
} from "../../management.shared";

export interface SelectOption {
  id: string;
  name: string;
}

export type InventoryEventKind = "count" | "loss" | "adjustment";

export interface InventoryEventLineDraft {
  id: string;
  inventoryItemId: string;
  locationId: string;
  lotId?: string;
  quantity: string;
}

function numberInput(value: string): string {
  return value.replace(",", ".");
}

function productionInputDraft() {
  return {
    id: crypto.randomUUID(),
    inventoryItemId: "",
    locationId: "",
    lotId: "",
    quantity: "",
  };
}

export function LocationModal({
  location,
  operators,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  location: StockLocation | null;
  operators: Array<{ id: string; name: string }>;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: {
    name: string;
    code: string;
    barcode?: string;
    kind: StockLocation["kind"];
    responsibleIdentityId: string | null;
    requireDistinctTransferReceiver: boolean;
    transferSlaMinutes: number;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState(location?.name ?? "");
  const [code, setCode] = useState(location?.code ?? "");
  const [barcode, setBarcode] = useState(location?.barcode ?? "");
  const [kind, setKind] = useState<StockLocation["kind"]>(location?.kind ?? "warehouse");
  const [responsibleIdentityId, setResponsibleIdentityId] = useState(
    location?.responsibleIdentityId ?? "",
  );
  const [distinctReceiver, setDistinctReceiver] = useState(
    location?.requireDistinctTransferReceiver ?? true,
  );
  const [slaMinutes, setSlaMinutes] = useState(String(location?.transferSlaMinutes ?? 30));
  useEffect(() => {
    setName(location?.name ?? "");
    setCode(location?.code ?? "");
    setBarcode(location?.barcode ?? "");
    setKind(location?.kind ?? "warehouse");
    setResponsibleIdentityId(location?.responsibleIdentityId ?? "");
    setDistinctReceiver(location?.requireDistinctTransferReceiver ?? true);
    setSlaMinutes(String(location?.transferSlaMinutes ?? 30));
  }, [location]);
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="sm"
      title={location ? "Editar local" : "Novo local"}
    >
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            name: name.trim(),
            code: code.trim().toUpperCase(),
            ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
            kind,
            responsibleIdentityId: responsibleIdentityId || null,
            requireDistinctTransferReceiver: distinctReceiver,
            transferSlaMinutes: Number(slaMinutes),
          });
        }}
      >
        <Label className="gm-form-field">
          <span>Nome</span>
          <Input
            minLength={2}
            onChange={(event) => {
              const next = event.target.value;
              setName(next);
              if (!location)
                setCode(
                  next
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/[^A-Za-z0-9]+/g, "_")
                    .replace(/^_|_$/g, "")
                    .toUpperCase(),
                );
            }}
            required
            value={name}
          />
        </Label>
        <div className="gm-form-grid inventory-form-grid">
          <Label className="gm-form-field">
            <span>Tipo de setor</span>
            <NativeSelect
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              <option value="warehouse">Depósito</option>
              <option value="cooler">Geladeira</option>
              <option value="freezer">Freezer</option>
              <option value="bar">Bar</option>
              <option value="kitchen">Cozinha</option>
              <option value="returnables">Vasilhames</option>
              <option value="other">Outro</option>
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Código de barras/QR</span>
            <Input value={barcode} onChange={(event) => setBarcode(event.target.value)} />
          </Label>
          <Label className="gm-form-field">
            <span>Prazo da transferência (min)</span>
            <Input
              min="1"
              max="10080"
              type="number"
              required
              value={slaMinutes}
              onChange={(event) => setSlaMinutes(event.target.value)}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Responsável pelo setor</span>
            <NativeSelect
              value={responsibleIdentityId}
              onChange={(event) => setResponsibleIdentityId(event.target.value)}
            >
              <option value="">Sem responsável</option>
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
        </div>
        <Label className="inventory-check-row">
          <Input
            type="checkbox"
            checked={distinctReceiver}
            onChange={(event) => setDistinctReceiver(event.target.checked)}
          />
          <span>Exigir outra pessoa para conferir o recebimento</span>
        </Label>
        <Label className="gm-form-field">
          <span>Código operacional</span>
          <Input
            maxLength={40}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            pattern="[A-Za-z0-9_-]+"
            required
            value={code}
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={busy || name.trim().length < 2 || !code.trim() || Number(slaMinutes) < 1}
            type="submit"
          >
            {busy ? "Salvando…" : "Salvar local"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ItemModal({
  item,
  products,
  suppliers,
  containers,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  item: InventoryItem | null;
  products: SelectOption[];
  suppliers: SelectOption[];
  containers: SelectOption[];
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [sku, setSku] = useState(item?.sku ?? "");
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "un");
  const [purchaseUnit, setPurchaseUnit] = useState(item?.purchaseUnit ?? "");
  const [factor, setFactor] = useState(String(item?.purchaseToStockFactor ?? 1));
  const [minimum, setMinimum] = useState(String(item?.minimumQuantity ?? 0));
  const [reorder, setReorder] = useState(String(item?.reorderQuantity ?? 0));
  const [leadTime, setLeadTime] = useState(String(item?.leadTimeDays ?? 0));
  const [productId, setProductId] = useState(item?.productId ?? "");
  const [supplierId, setSupplierId] = useState(item?.preferredSupplierId ?? "");
  const [kind, setKind] = useState<InventoryItemKind>(item?.kind ?? "ingredient");
  const [containerItemId, setContainerItemId] = useState(item?.returnableContainerItemId ?? "");
  const [returnableQuantity, setReturnableQuantity] = useState(
    String(item?.returnableQuantityPerUnit ?? 1),
  );
  const [deposit, setDeposit] = useState(
    item?.returnableDepositCents ? String(item.returnableDepositCents / 100) : "0",
  );
  useEffect(() => {
    setName(item?.name ?? "");
    setSku(item?.sku ?? "");
    setBarcode(item?.barcode ?? "");
    setUnit(item?.unit ?? "un");
    setPurchaseUnit(item?.purchaseUnit ?? "");
    setFactor(String(item?.purchaseToStockFactor ?? 1));
    setMinimum(String(item?.minimumQuantity ?? 0));
    setReorder(String(item?.reorderQuantity ?? 0));
    setLeadTime(String(item?.leadTimeDays ?? 0));
    setProductId(item?.productId ?? "");
    setSupplierId(item?.preferredSupplierId ?? "");
    setKind(item?.kind ?? "ingredient");
    setContainerItemId(item?.returnableContainerItemId ?? "");
    setReturnableQuantity(String(item?.returnableQuantityPerUnit ?? 1));
    setDeposit(item?.returnableDepositCents ? String(item.returnableDepositCents / 100) : "0");
  }, [item]);
  const valid =
    name.trim().length >= 2 &&
    unit.trim() &&
    Number(numberInput(factor)) > 0 &&
    Number(numberInput(minimum)) >= 0 &&
    Number(numberInput(reorder)) >= 0 &&
    Number(leadTime) >= 0 &&
    Number(numberInput(returnableQuantity)) > 0 &&
    Number(numberInput(deposit)) >= 0 &&
    (kind !== "resale" || Boolean(productId));
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="lg"
      title={item ? "Editar item de estoque" : "Novo item de estoque"}
    >
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            name: name.trim(),
            sku: sku.trim() || undefined,
            barcode: barcode.trim() || undefined,
            unit: unit.trim(),
            purchaseUnit: purchaseUnit.trim() || undefined,
            purchaseToStockFactor: numberInput(factor),
            minimumQuantity: numberInput(minimum),
            reorderQuantity: numberInput(reorder),
            leadTimeDays: Number(leadTime),
            productId: kind === "resale" ? productId : item ? null : undefined,
            preferredSupplierId: supplierId || (item ? null : undefined),
            allowNegative: item?.allowNegative ?? false,
            kind,
            returnableContainerItemId:
              kind === "resale" && containerItemId ? containerItemId : item ? null : undefined,
            returnableQuantityPerUnit: numberInput(returnableQuantity),
            returnableDepositCents: Math.round(Number(numberInput(deposit)) * 100),
          });
        }}
      >
        <div className="gm-form-grid inventory-form-grid">
          <Label className="gm-form-field">
            <span>Nome do item</span>
            <Input minLength={2} onChange={(e) => setName(e.target.value)} required value={name} />
          </Label>
          <Label className="gm-form-field">
            <span>Tipo de item</span>
            <NativeSelect
              onChange={(event) => {
                setKind(event.target.value as InventoryItemKind);
                setContainerItemId("");
              }}
              value={kind}
            >
              <option value="ingredient">Insumo</option>
              <option value="prepared">Preparado / semiacabado</option>
              <option value="resale">Produto de revenda</option>
              <option value="reusable">Utensílio/mobiliário</option>
              <option value="returnable_container">Vasilhame retornável</option>
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>SKU interno</span>
            <Input maxLength={80} onChange={(e) => setSku(e.target.value)} value={sku} />
          </Label>
          <Label className="gm-form-field">
            <span>Código de barras</span>
            <Input maxLength={80} onChange={(e) => setBarcode(e.target.value)} value={barcode} />
          </Label>
          <Label className="gm-form-field">
            <span>Unidade de estoque</span>
            <NativeSelect onChange={(e) => setUnit(e.target.value)} value={unit}>
              {["un", "kg", "g", "l", "ml"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Unidade de compra</span>
            <Input
              onChange={(e) => setPurchaseUnit(e.target.value)}
              placeholder="Ex.: caixa"
              value={purchaseUnit}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Conversão para estoque</span>
            <Input
              inputMode="decimal"
              onChange={(e) => setFactor(e.target.value)}
              required
              value={factor}
            />
            <small>
              Quantidade em {unit || "un"} contida em cada {purchaseUnit || "unidade comprada"}.
            </small>
          </Label>
          <Label className="gm-form-field">
            <span>Estoque mínimo</span>
            <Input
              inputMode="decimal"
              onChange={(e) => setMinimum(e.target.value)}
              required
              value={minimum}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Quantidade sugerida de compra</span>
            <Input
              inputMode="decimal"
              onChange={(e) => setReorder(e.target.value)}
              required
              value={reorder}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Prazo do fornecedor (dias)</span>
            <Input
              inputMode="numeric"
              min={0}
              onChange={(e) => setLeadTime(e.target.value)}
              type="number"
              value={leadTime}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Fornecedor preferencial</span>
            <NativeSelect onChange={(e) => setSupplierId(e.target.value)} value={supplierId}>
              <option value="">Não definido</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
          {kind === "resale" && (
            <Label className="gm-form-field inventory-form-grid__wide">
              <span>Produto do Cardápio para baixa direta</span>
              <NativeSelect
                onChange={(e) => setProductId(e.target.value)}
                required
                value={productId}
              >
                <option value="">Selecione</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </NativeSelect>
              <small>
                Obrigatório para revenda. Itens preparados devem consumir por ficha técnica.
              </small>
            </Label>
          )}
          {kind === "resale" && (
            <Label className="gm-form-field inventory-form-grid__wide">
              <span>Vasilhame vinculado</span>
              <NativeSelect
                onChange={(event) => setContainerItemId(event.target.value)}
                value={containerItemId}
              >
                <option value="">Produto não retornável</option>
                {containers.map((container) => (
                  <option key={container.id} value={container.id}>
                    {container.name}
                  </option>
                ))}
              </NativeSelect>
              <small>A venda gera retorno previsto; o saldo físico só muda após conferência.</small>
            </Label>
          )}
          {kind === "resale" && containerItemId && (
            <>
              <Label className="gm-form-field">
                <span>Vasilhames por venda</span>
                <Input
                  inputMode="decimal"
                  onChange={(event) => setReturnableQuantity(event.target.value)}
                  required
                  value={returnableQuantity}
                />
              </Label>
              <Label className="gm-form-field">
                <span>Caução por vasilhame (R$)</span>
                <Input
                  inputMode="decimal"
                  onChange={(event) => setDeposit(event.target.value)}
                  required
                  value={deposit}
                />
              </Label>
            </>
          )}
          {kind === "reusable" && (
            <p className="inventory-context-note inventory-form-grid__wide">
              Utensílios e mobiliário são controlados por saldo, local, contagem e perda, sem baixa
              por venda.
            </p>
          )}
        </div>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button disabled={busy || !valid} type="submit">
            {busy ? "Salvando…" : "Salvar item"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function InventoryEventModal({
  open,
  busy,
  items,
  locations,
  lots,
  draftKey,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  items: InventoryItem[];
  locations: StockLocation[];
  lots: InventoryLot[];
  draftKey: string;
  onClose: () => void;
  onSubmit: (body: {
    type: InventoryEventKind;
    reason: string;
    lines: InventoryEventLineDraft[];
  }) => Promise<unknown>;
}) {
  const [type, setType] = useState<InventoryEventKind>("count");
  const [reason, setReason] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [lotId, setLotId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lines, setLines] = useState<InventoryEventLineDraft[]>([]);
  const availableLots = lots.filter(
    (lot) =>
      lot.inventoryItemId === inventoryItemId &&
      lot.locationId === locationId &&
      lot.active &&
      lot.quantity > 0,
  );
  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem(draftKey);
      setLines(saved ? (JSON.parse(saved) as InventoryEventLineDraft[]) : []);
    } catch {
      setLines([]);
    }
  }, [draftKey, open]);
  useEffect(() => {
    if (!open) return;
    localStorage.setItem(draftKey, JSON.stringify(lines));
  }, [draftKey, lines, open]);
  const addLine = () => {
    if (!inventoryItemId || !locationId || !quantity.trim() || (availableLots.length > 0 && !lotId))
      return;
    const normalized = numberInput(quantity);
    if (!Number.isFinite(Number(normalized))) return;
    setLines((current) => [
      ...current.filter(
        (line) => !(line.inventoryItemId === inventoryItemId && line.locationId === locationId),
      ),
      {
        id: crypto.randomUUID(),
        inventoryItemId,
        locationId,
        lotId: lotId || undefined,
        quantity: normalized,
      },
    ]);
    setInventoryItemId("");
    setLotId("");
    setQuantity("");
  };
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const locationById = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );
  const quantityLabel =
    type === "count"
      ? "Saldo contado"
      : type === "loss"
        ? "Quantidade perdida"
        : "Variação (+ ou -)";
  const selectedItem = itemById.get(inventoryItemId);
  return (
    <Modal isOpen={open} onClose={onClose} size="lg" title="Movimentar estoque">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ type, reason: reason.trim(), lines });
        }}
      >
        <div
          className="inventory-movement-kind"
          role="radiogroup"
          aria-label="Tipo de movimentação"
        >
          {(
            [
              ["count", "Contagem"],
              ["loss", "Perda"],
              ["adjustment", "Ajuste"],
            ] as const
          ).map(([value, label]) => (
            <Button
              aria-pressed={type === value}
              key={value}
              onClick={() => setType(value)}
              type="button"
            >
              {label}
            </Button>
          ))}
        </div>
        <p className="inventory-context-note">
          {type === "count"
            ? "A contagem substitui o saldo atual."
            : type === "loss"
              ? "A perda será subtraída do saldo."
              : "O ajuste soma ou subtrai a variação informada."}
        </p>
        <fieldset
          className={`inventory-line-builder${availableLots.length ? "" : " inventory-line-builder--no-lot"}`}
        >
          <legend>Adicionar item</legend>
          <Label className="gm-form-field">
            <span>Local</span>
            <NativeSelect
              onChange={(e) => {
                setLocationId(e.target.value);
                setLotId("");
              }}
              value={locationId}
            >
              <option value="">Selecione</option>
              {locations
                .filter((l) => l.active)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Item de estoque</span>
            <NativeSelect
              onChange={(e) => {
                setInventoryItemId(e.target.value);
                setLotId("");
              }}
              value={inventoryItemId}
            >
              <option value="">Selecione</option>
              {items
                .filter((i) => i.active)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unit})
                  </option>
                ))}
            </NativeSelect>
          </Label>
          {availableLots.length > 0 && (
            <Label className="gm-form-field">
              <span>Lote</span>
              <NativeSelect onChange={(e) => setLotId(e.target.value)} required value={lotId}>
                <option value="">Selecione</option>
                {availableLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.batchCode} · {lot.quantity}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          )}
          <Label className="gm-form-field">
            <span>
              {quantityLabel}
              {selectedItem ? ` (${selectedItem.unit})` : ""}
            </span>
            <Input
              inputMode="decimal"
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addLine();
              }}
              onChange={(e) => setQuantity(e.target.value)}
              value={quantity}
            />
          </Label>
          <Button
            disabled={
              !inventoryItemId ||
              !locationId ||
              !quantity.trim() ||
              (availableLots.length > 0 && !lotId)
            }
            onClick={addLine}
            variant="secondary"
          >
            Adicionar
          </Button>
        </fieldset>
        {lines.length > 0 && (
          <ul className="inventory-draft-lines" aria-label="Itens da movimentação">
            {lines.map((line) => (
              <li key={line.id}>
                <span>
                  <strong>{itemById.get(line.inventoryItemId)?.name}</strong>
                  <small>{locationById.get(line.locationId)?.name}</small>
                  {line.lotId && (
                    <small>Lote {lots.find((lot) => lot.id === line.lotId)?.batchCode}</small>
                  )}
                </span>
                <strong>
                  {line.quantity} {itemById.get(line.inventoryItemId)?.unit}
                </strong>
                <Button
                  aria-label={`Remover ${itemById.get(line.inventoryItemId)?.name ?? "item"}`}
                  onClick={() =>
                    setLines((current) => current.filter((candidate) => candidate.id !== line.id))
                  }
                  size="sm"
                  variant="ghost"
                >
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Label className="gm-form-field">
          <span>Motivo e referência</span>
          <Textarea
            minLength={3}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: contagem semanal da cozinha"
            required
            rows={3}
            value={reason}
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Continuar depois
          </Button>
          <Button disabled={busy || lines.length === 0 || reason.trim().length < 3} type="submit">
            {busy ? "Registrando…" : `Confirmar ${lines.length} item(ns)`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TransferModal({
  open,
  busy,
  items,
  locations,
  lots,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  items: InventoryItem[];
  locations: StockLocation[];
  lots: InventoryLot[];
  onClose: () => void;
  onSubmit: (body: {
    sourceLocationId: string;
    destinationLocationId: string;
    reason: string;
    lines: Array<{ inventoryItemId: string; quantity: string; lotId?: string }>;
  }) => Promise<unknown>;
}) {
  const [itemId, setItemId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [lotId, setLotId] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [lines, setLines] = useState<
    Array<{ id: string; inventoryItemId: string; quantity: string; lotId?: string }>
  >([]);
  useEffect(() => {
    if (!open) return;
    setItemId("");
    setSourceId("");
    setDestinationId("");
    setQuantity("");
    setReason("");
    setLotId("");
    setScanCode("");
    setLines([]);
  }, [open]);
  const availableLots = lots.filter(
    (lot) => lot.inventoryItemId === itemId && lot.locationId === sourceId && lot.quantity > 0,
  );
  return (
    <Modal isOpen={open} onClose={onClose} size="md" title="Transferir entre locais">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            sourceLocationId: sourceId,
            destinationLocationId: destinationId,
            reason: reason.trim(),
            lines: lines.map(({ id: _id, ...line }) => line),
          });
        }}
      >
        <Label className="gm-form-field">
          <span>Leitor de código</span>
          <Input
            autoComplete="off"
            placeholder="Leia um setor ou item e pressione Enter"
            value={scanCode}
            onChange={(event) => setScanCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const code = scanCode.trim().toLocaleLowerCase("pt-BR");
              const location = locations.find(
                (value) =>
                  value.code.toLocaleLowerCase("pt-BR") === code ||
                  value.barcode?.toLocaleLowerCase("pt-BR") === code,
              );
              const item = items.find(
                (value) =>
                  value.sku?.toLocaleLowerCase("pt-BR") === code ||
                  value.barcode?.toLocaleLowerCase("pt-BR") === code,
              );
              if (location) {
                if (!sourceId) setSourceId(location.id);
                else if (location.id !== sourceId) setDestinationId(location.id);
              } else if (item) setItemId(item.id);
              setScanCode("");
            }}
          />
        </Label>
        <div className="gm-form-grid inventory-form-grid">
          <Label className="gm-form-field inventory-form-grid__wide">
            <span>Item de estoque</span>
            <NativeSelect
              onChange={(e) => {
                setItemId(e.target.value);
                setLotId("");
              }}
              required
              value={itemId}
            >
              <option value="">Selecione</option>
              {items
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Origem</span>
            <NativeSelect
              onChange={(e) => {
                setSourceId(e.target.value);
                setLotId("");
              }}
              required
              value={sourceId}
            >
              <option value="">Selecione</option>
              {locations
                .filter((location) => location.active)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Destino</span>
            <NativeSelect
              onChange={(e) => setDestinationId(e.target.value)}
              required
              value={destinationId}
            >
              <option value="">Selecione</option>
              {locations
                .filter((location) => location.active && location.id !== sourceId)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          {availableLots.length > 0 && (
            <Label className="gm-form-field">
              <span>Lote</span>
              <NativeSelect onChange={(e) => setLotId(e.target.value)} required value={lotId}>
                <option value="">Selecione</option>
                {availableLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.batchCode} · {lot.quantity}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          )}
          <Label className="gm-form-field">
            <span>Quantidade</span>
            <Input
              inputMode="decimal"
              onChange={(e) => setQuantity(e.target.value)}
              required
              value={quantity}
            />
          </Label>
          <Label className="gm-form-field inventory-form-grid__wide">
            <span>Motivo</span>
            <Input
              minLength={3}
              onChange={(e) => setReason(e.target.value)}
              required
              value={reason}
            />
          </Label>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={!itemId || !quantity || (availableLots.length > 0 && !lotId)}
          onClick={() => {
            setLines((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                inventoryItemId: itemId,
                quantity: numberInput(quantity),
                ...(lotId ? { lotId } : {}),
              },
            ]);
            setItemId("");
            setQuantity("");
            setLotId("");
          }}
        >
          Adicionar item à transferência
        </Button>
        {lines.length > 0 && (
          <ul className="inventory-draft-list">
            {lines.map((line) => (
              <li key={line.id}>
                <span>
                  {items.find((item) => item.id === line.inventoryItemId)?.name ?? "Item"} ·{" "}
                  {line.quantity}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setLines((current) => current.filter((value) => value.id !== line.id))
                  }
                >
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              !sourceId ||
              !destinationId ||
              sourceId === destinationId ||
              reason.trim().length < 3 ||
              lines.length === 0
            }
            type="submit"
          >
            {busy ? "Transferindo…" : `Enviar ${lines.length} item(ns)`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function LotModal({
  open,
  busy,
  items,
  locations,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  items: InventoryItem[];
  locations: StockLocation[];
  onClose: () => void;
  onSubmit: (body: {
    inventoryItemId: string;
    locationId: string;
    batchCode: string;
    expiresAt?: string;
    quantity: string;
    unitCostCents?: number;
  }) => Promise<unknown>;
}) {
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [batchCode, setBatchCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  return (
    <Modal isOpen={open} onClose={onClose} size="md" title="Registrar lote e validade">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            inventoryItemId: itemId,
            locationId,
            batchCode: batchCode.trim(),
            expiresAt: expiresAt ? new Date(`${expiresAt}T12:00:00`).toISOString() : undefined,
            quantity: numberInput(quantity),
            unitCostCents: unitCost ? Math.round(Number(numberInput(unitCost)) * 100) : undefined,
          });
        }}
      >
        <div className="gm-form-grid inventory-form-grid">
          <Label className="gm-form-field">
            <span>Item de estoque</span>
            <NativeSelect onChange={(e) => setItemId(e.target.value)} required value={itemId}>
              <option value="">Selecione</option>
              {items
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Local</span>
            <NativeSelect
              onChange={(e) => setLocationId(e.target.value)}
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
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Código do lote</span>
            <Input onChange={(e) => setBatchCode(e.target.value)} required value={batchCode} />
          </Label>
          <Label className="gm-form-field">
            <span>Validade</span>
            <Input onChange={(e) => setExpiresAt(e.target.value)} type="date" value={expiresAt} />
          </Label>
          <Label className="gm-form-field">
            <span>Quantidade recebida</span>
            <Input
              inputMode="decimal"
              onChange={(e) => setQuantity(e.target.value)}
              required
              value={quantity}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Custo unitário (R$)</span>
            <Input
              inputMode="decimal"
              onChange={(e) => setUnitCost(e.target.value)}
              value={unitCost}
            />
          </Label>
        </div>
        <p className="inventory-context-note">
          Registrar um lote também adiciona a quantidade ao saldo e ao histórico auditável.
        </p>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              !itemId ||
              !locationId ||
              !batchCode.trim() ||
              Number(numberInput(quantity)) <= 0
            }
            type="submit"
          >
            {busy ? "Registrando…" : "Registrar lote"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReturnableConferenceModal({
  open,
  busy,
  items,
  locations,
  positions,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  items: InventoryItem[];
  locations: StockLocation[];
  positions: ReturnablePosition[];
  onClose: () => void;
  onSubmit: (body: {
    inventoryItemId: string;
    locationId: string;
    quantity: string;
    reason: string;
  }) => Promise<unknown>;
}) {
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const position = positions.find(
    (candidate) =>
      candidate.inventoryItemId === itemId &&
      (!candidate.locationId || candidate.locationId === locationId),
  );
  return (
    <Modal isOpen={open} onClose={onClose} title="Conferir vasilhames">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ inventoryItemId: itemId, locationId, quantity, reason: reason.trim() });
        }}
      >
        <p className="inventory-context-note">
          Informe apenas o que retornou agora. O previsto não compõe o saldo físico até esta
          confirmação.
        </p>
        <Label className="gm-form-field">
          <span>Vasilhame</span>
          <NativeSelect onChange={(event) => setItemId(event.target.value)} required value={itemId}>
            <option value="">Selecione</option>
            {items
              .filter((item) => item.active && item.kind === "returnable_container")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </NativeSelect>
        </Label>
        <Label className="gm-form-field">
          <span>Local da conferência</span>
          <NativeSelect
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
          </NativeSelect>
        </Label>
        {itemId && (
          <div className="inventory-context-note" role="status">
            Em custódia: <strong>{position?.expectedQuantity ?? 0}</strong> · retorno agora:{" "}
            <strong>{quantity || "—"}</strong>
          </div>
        )}
        <Label className="gm-form-field">
          <span>Quantidade retornada agora</span>
          <Input
            inputMode="decimal"
            min="0"
            onChange={(event) => setQuantity(event.target.value)}
            required
            value={quantity}
          />
        </Label>
        <Label className="gm-form-field">
          <span>Motivo e referência</span>
          <Textarea
            minLength={3}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: conferência do fechamento do bar"
            required
            value={reason}
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              !itemId ||
              !locationId ||
              Number(numberInput(quantity)) <= 0 ||
              reason.trim().length < 3
            }
            type="submit"
          >
            {busy ? "Confirmando…" : "Confirmar conferência"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReturnableIncidentModal({
  open,
  busy,
  items,
  locations,
  movements,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  items: InventoryItem[];
  locations: StockLocation[];
  movements: ReturnableMovement[];
  onClose: () => void;
  onSubmit: (body: {
    inventoryItemId: string;
    locationId?: string;
    movementId?: string;
    orderId?: string;
    kind: "breakage" | "loss" | "suspected_theft" | "recording_error" | "other";
    quantity: string;
    reason: string;
  }) => Promise<unknown>;
}) {
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [movementId, setMovementId] = useState("");
  const [source, setSource] = useState<"custody" | "physical">("custody");
  const [kind, setKind] = useState<
    "breakage" | "loss" | "suspected_theft" | "recording_error" | "other"
  >("breakage");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Modal isOpen={open} onClose={onClose} title="Registrar ocorrência de vasilhame">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          const movement = movements.find((candidate) => candidate.id === movementId);
          void onSubmit({
            inventoryItemId: itemId,
            locationId: source === "physical" ? locationId : undefined,
            movementId: source === "custody" ? movementId : undefined,
            orderId: source === "custody" ? (movement?.orderId ?? undefined) : undefined,
            kind,
            quantity,
            reason: reason.trim(),
          });
        }}
      >
        <p className="inventory-context-note">
          A ocorrência ficará pendente até a revisão por gerente ou proprietário.
        </p>
        <div className="gm-form-grid inventory-form-grid">
          {source === "physical" && (
            <Label className="gm-form-field">
              <span>Vasilhame</span>
              <NativeSelect
                onChange={(event) => setItemId(event.target.value)}
                required
                value={itemId}
              >
                <option value="">Selecione</option>
                {items
                  .filter((item) => item.active && item.kind === "returnable_container")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </NativeSelect>
            </Label>
          )}
          <Label className="gm-form-field">
            <span>Origem</span>
            <NativeSelect
              onChange={(event) => setSource(event.target.value as typeof source)}
              value={source}
            >
              <option value="custody">Custódia de venda</option>
              <option value="physical">Saldo físico</option>
            </NativeSelect>
          </Label>
          {source === "custody" ? (
            <Label className="gm-form-field inventory-form-grid__wide">
              <span>Movimento de saída</span>
              <NativeSelect
                onChange={(event) => {
                  const next = movements.find((movement) => movement.id === event.target.value);
                  setMovementId(event.target.value);
                  if (next) setItemId(next.inventoryItemId);
                }}
                required
                value={movementId}
              >
                <option value="">Selecione</option>
                {movements
                  .filter((movement) => movement.type === "issue")
                  .map((movement) => (
                    <option key={movement.id} value={movement.id}>
                      {String(movement.context.orderCode ?? movement.orderId ?? "Venda")} ·{" "}
                      {String(
                        movement.context.tableLabel ?? movement.context.tableNumber ?? "sem mesa",
                      )}{" "}
                      · {movement.quantityDelta}
                    </option>
                  ))}
              </NativeSelect>
            </Label>
          ) : (
            <Label className="gm-form-field">
              <span>Local</span>
              <NativeSelect
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
              </NativeSelect>
            </Label>
          )}
          <Label className="gm-form-field">
            <span>Ocorrência</span>
            <NativeSelect
              onChange={(event) => setKind(event.target.value as typeof kind)}
              value={kind}
            >
              <option value="breakage">Quebra</option>
              <option value="loss">Extravio</option>
              <option value="suspected_theft">Suspeita de furto</option>
              <option value="recording_error">Erro de lançamento</option>
              <option value="other">Outro</option>
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Quantidade</span>
            <Input
              inputMode="decimal"
              min="0"
              onChange={(event) => setQuantity(event.target.value)}
              required
              value={quantity}
            />
          </Label>
        </div>
        <Label className="gm-form-field">
          <span>Justificativa e referência</span>
          <Textarea
            minLength={5}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              !itemId ||
              (source === "custody" ? !movementId : !locationId) ||
              Number(numberInput(quantity)) <= 0 ||
              reason.trim().length < 5
            }
            type="submit"
            variant="danger"
          >
            {busy ? "Registrando…" : "Enviar para aprovação"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReturnableIncidentReviewModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: { decision: "approved" | "rejected"; reason: string }) => Promise<unknown>;
}) {
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [reason, setReason] = useState("");
  return (
    <Modal isOpen={open} onClose={onClose} title="Revisar ocorrência">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ decision, reason: reason.trim() });
        }}
      >
        <Label className="gm-form-field">
          <span>Decisão</span>
          <NativeSelect
            onChange={(event) => setDecision(event.target.value as typeof decision)}
            value={decision}
          >
            <option value="approved">Aprovar baixa</option>
            <option value="rejected">Rejeitar ocorrência</option>
          </NativeSelect>
        </Label>
        <Label className="gm-form-field">
          <span>Justificativa da revisão</span>
          <Textarea
            minLength={5}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Voltar
          </Button>
          <Button disabled={busy || reason.trim().length < 5} type="submit">
            {busy ? "Salvando…" : "Confirmar revisão"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function InventoryReviewModal({
  request,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  request: InventoryReviewRequest | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: { decision: "approved" | "rejected"; reason: string }) => Promise<unknown>;
}) {
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) return;
    setDecision("approved");
    setReason("");
  }, [open]);
  return (
    <Modal isOpen={open} onClose={onClose} size="sm" title="Revisar divergência">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ decision, reason: reason.trim() });
        }}
      >
        <p className="inventory-context-note">
          {request?.reason ?? "Confira a divergência antes de decidir."} Quem contou não pode
          aprovar a própria solicitação.
        </p>
        <Label className="gm-form-field">
          <span>Decisão</span>
          <NativeSelect
            onChange={(event) => setDecision(event.target.value as typeof decision)}
            value={decision}
          >
            <option value="approved">Aprovar e aplicar</option>
            <option value="rejected">Rejeitar sem alterar saldo</option>
          </NativeSelect>
        </Label>
        <Label className="gm-form-field">
          <span>Justificativa</span>
          <Textarea
            minLength={5}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            value={reason}
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button disabled={busy || reason.trim().length < 5} type="submit">
            {busy ? "Registrando…" : "Confirmar decisão"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TransferResolutionModal({
  transfer,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  transfer: InventoryTransfer | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: {
    decision: "received" | "canceled";
    quantityReceived?: string;
    quantityDivergent?: string;
    divergenceReason?: string;
    evidence?: string[];
    note: string;
  }) => Promise<unknown>;
}) {
  const [decision, setDecision] = useState<"received" | "canceled">("received");
  const [quantityReceived, setQuantityReceived] = useState("");
  const [quantityDivergent, setQuantityDivergent] = useState("0");
  const [divergenceReason, setDivergenceReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    setDecision("received");
    setQuantityReceived(
      transfer
        ? String(transfer.quantity - transfer.quantityReceived - transfer.quantityDivergent)
        : "",
    );
    setQuantityDivergent("0");
    setDivergenceReason("");
    setEvidence("");
    setNote("");
  }, [open, transfer]);
  return (
    <Modal isOpen={open} onClose={onClose} size="sm" title="Resolver transferência">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            decision,
            ...(decision === "received"
              ? {
                  quantityReceived: numberInput(quantityReceived),
                  quantityDivergent: numberInput(quantityDivergent || "0"),
                  ...(divergenceReason.trim() ? { divergenceReason: divergenceReason.trim() } : {}),
                  ...(evidence.trim()
                    ? {
                        evidence: evidence
                          .split(/\r?\n/)
                          .map((url) => url.trim())
                          .filter(Boolean),
                      }
                    : {}),
                }
              : {}),
            note: note.trim(),
          });
        }}
      >
        <p className="inventory-context-note">
          {transfer
            ? `${transfer.quantity.toLocaleString("pt-BR")} unidade(s) estão em trânsito.`
            : "Confira o recebimento físico antes de concluir."}
        </p>
        <Label className="gm-form-field">
          <span>Resultado</span>
          <NativeSelect
            onChange={(event) => setDecision(event.target.value as typeof decision)}
            value={decision}
          >
            <option value="received">Recebido no destino</option>
            <option value="canceled">Cancelar e devolver à origem</option>
          </NativeSelect>
        </Label>
        {decision === "received" && (
          <div className="gm-form-grid inventory-form-grid">
            <Label className="gm-form-field">
              <span>Quantidade recebida</span>
              <Input
                inputMode="decimal"
                required
                value={quantityReceived}
                onChange={(event) => setQuantityReceived(event.target.value)}
              />
            </Label>
            <Label className="gm-form-field">
              <span>Divergência</span>
              <Input
                inputMode="decimal"
                required
                value={quantityDivergent}
                onChange={(event) => setQuantityDivergent(event.target.value)}
              />
            </Label>
          </div>
        )}
        {decision === "received" && Number(numberInput(quantityDivergent || "0")) > 0 && (
          <>
            <Label className="gm-form-field">
              <span>Motivo da divergência</span>
              <Textarea
                minLength={3}
                required
                value={divergenceReason}
                onChange={(event) => setDivergenceReason(event.target.value)}
              />
            </Label>
            <Label className="gm-form-field">
              <span>Evidências (uma URL por linha)</span>
              <Textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} />
            </Label>
          </>
        )}
        <Label className="gm-form-field">
          <span>Conferência</span>
          <Textarea
            minLength={3}
            onChange={(event) => setNote(event.target.value)}
            required
            rows={3}
            value={note}
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Voltar
          </Button>
          <Button
            disabled={
              busy ||
              note.trim().length < 3 ||
              (decision === "received" &&
                (!quantityReceived ||
                  (Number(numberInput(quantityDivergent || "0")) > 0 &&
                    divergenceReason.trim().length < 3)))
            }
            type="submit"
          >
            {busy ? "Registrando…" : "Confirmar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AssetModal({
  asset,
  items,
  locations,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  asset: InventoryAsset | null;
  items: InventoryItem[];
  locations: StockLocation[];
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [inventoryItemId, setInventoryItemId] = useState(asset?.inventoryItemId ?? "");
  const [locationId, setLocationId] = useState(asset?.locationId ?? "");
  const [assetTag, setAssetTag] = useState(asset?.assetTag ?? "");
  const [status, setStatus] = useState<InventoryAsset["status"]>(asset?.status ?? "in_use");
  const [condition, setCondition] = useState<InventoryAsset["condition"]>(
    asset?.condition ?? "good",
  );
  const [notes, setNotes] = useState(asset?.notes ?? "");
  useEffect(() => {
    setInventoryItemId(asset?.inventoryItemId ?? "");
    setLocationId(asset?.locationId ?? "");
    setAssetTag(asset?.assetTag ?? "");
    setStatus(asset?.status ?? "in_use");
    setCondition(asset?.condition ?? "good");
    setNotes(asset?.notes ?? "");
  }, [asset]);
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="md"
      title={asset ? "Atualizar ativo" : "Novo ativo"}
    >
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            inventoryItemId,
            locationId,
            assetTag: assetTag.trim().toUpperCase(),
            status,
            condition,
            notes: notes.trim() || undefined,
            ...(asset ? { version: asset.version } : {}),
          });
        }}
      >
        <div className="gm-form-grid inventory-form-grid">
          <Label className="gm-form-field">
            <span>Item reutilizável</span>
            <NativeSelect
              disabled={Boolean(asset)}
              onChange={(event) => setInventoryItemId(event.target.value)}
              required
              value={inventoryItemId}
            >
              <option value="">Selecione</option>
              {items
                .filter((item) => item.kind === "reusable" && item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Etiqueta/QR</span>
            <Input
              minLength={2}
              onChange={(event) => setAssetTag(event.target.value)}
              required
              value={assetTag}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Local</span>
            <NativeSelect
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
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Situação</span>
            <NativeSelect
              onChange={(event) => setStatus(event.target.value as typeof status)}
              value={status}
            >
              <option value="in_use">Em uso</option>
              <option value="maintenance">Em manutenção</option>
              <option value="damaged">Danificado</option>
              <option value="retired">Descartado</option>
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Conservação</span>
            <NativeSelect
              onChange={(event) => setCondition(event.target.value as typeof condition)}
              value={condition}
            >
              <option value="good">Bom</option>
              <option value="fair">Regular</option>
              <option value="poor">Ruim</option>
              <option value="unusable">Sem uso</option>
            </NativeSelect>
          </Label>
          <Label className="gm-form-field inventory-form-grid__wide">
            <span>Observações/manutenção</span>
            <Textarea onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
          </Label>
        </div>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={busy || !inventoryItemId || !locationId || assetTag.trim().length < 2}
            type="submit"
          >
            {busy ? "Salvando…" : "Salvar ativo"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function BarcodeScanModal({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setValue("");
    setError("");
  }, [open]);
  async function detect(file: File) {
    const Detector = (
      window as typeof window & {
        BarcodeDetector?: new (options: {
          formats: string[];
        }) => {
          detect(source: ImageBitmap): Promise<Array<{ rawValue: string }>>;
        };
      }
    ).BarcodeDetector;
    if (!Detector) {
      setError(
        "A leitura pela câmera não é compatível com este navegador. Digite ou use o leitor USB.",
      );
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const codes = await new Detector({
        formats: ["ean_13", "ean_8", "code_128", "qr_code"],
      }).detect(bitmap);
      bitmap.close();
      const code = codes[0]?.rawValue;
      if (!code) throw new Error("Código não encontrado na imagem.");
      onDetected(code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível ler o código.");
    }
  }
  return (
    <Modal isOpen={open} onClose={onClose} size="sm" title="Ler código">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onDetected(value.trim());
        }}
      >
        <Label className="gm-form-field">
          <span>Código de barras ou QR</span>
          <Input
            onChange={(event) => setValue(event.target.value)}
            placeholder="Bipe ou digite o código"
            value={value}
          />
        </Label>
        <Label className="gm-form-field">
          <span>Usar câmera do celular</span>
          <input
            className="border-input bg-background"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void detect(file);
            }}
            type="file"
          />
        </Label>
        {error && (
          <p className="inventory-context-note" role="alert">
            {error}
          </p>
        )}
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button disabled={!value.trim()} type="submit">
            Localizar item
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReturnableSupplierExchangeModal({
  open,
  busy,
  items,
  locations,
  suppliers,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  items: InventoryItem[];
  locations: StockLocation[];
  suppliers: SelectOption[];
  onClose: () => void;
  onSubmit: (body: {
    containerInventoryItemId: string;
    locationId: string;
    supplierId: string;
    quantity: string;
    note: string;
  }) => Promise<unknown>;
}) {
  const [containerInventoryItemId, setContainerInventoryItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    setContainerInventoryItemId("");
    setLocationId("");
    setSupplierId("");
    setQuantity("");
    setNote("");
  }, [open]);
  return (
    <Modal isOpen={open} onClose={onClose} size="md" title="Enviar vasilhames ao fornecedor">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            containerInventoryItemId,
            locationId,
            supplierId,
            quantity: numberInput(quantity),
            note: note.trim(),
          });
        }}
      >
        <p className="inventory-context-note">
          A saída reduz apenas o saldo físico de vasilhames e mantém um lançamento auditável por
          fornecedor.
        </p>
        <div className="gm-form-grid inventory-form-grid">
          <Label className="gm-form-field">
            <span>Vasilhame</span>
            <NativeSelect
              onChange={(event) => setContainerInventoryItemId(event.target.value)}
              required
              value={containerInventoryItemId}
            >
              <option value="">Selecione</option>
              {items
                .filter((item) => item.kind === "returnable_container" && item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Fornecedor</span>
            <NativeSelect
              onChange={(event) => setSupplierId(event.target.value)}
              required
              value={supplierId}
            >
              <option value="">Selecione</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Local de saída</span>
            <NativeSelect
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
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Quantidade</span>
            <Input
              inputMode="decimal"
              onChange={(event) => setQuantity(event.target.value)}
              required
              value={quantity}
            />
          </Label>
          <Label className="gm-form-field inventory-form-grid__wide">
            <span>Comprovante/referência</span>
            <Textarea
              minLength={3}
              onChange={(event) => setNote(event.target.value)}
              required
              rows={3}
              value={note}
            />
          </Label>
        </div>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              !containerInventoryItemId ||
              !locationId ||
              !supplierId ||
              Number(numberInput(quantity)) <= 0 ||
              note.trim().length < 3
            }
            type="submit"
          >
            {busy ? "Registrando…" : "Confirmar saída"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReturnableSupplierExchangeResolutionModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: { decision: "received" | "canceled"; note: string }) => Promise<unknown>;
}) {
  const [decision, setDecision] = useState<"received" | "canceled">("received");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    setDecision("received");
    setNote("");
  }, [open]);
  return (
    <Modal isOpen={open} onClose={onClose} size="sm" title="Conferir retorno do fornecedor">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ decision, note: note.trim() });
        }}
      >
        <Label className="gm-form-field">
          <span>Resultado</span>
          <NativeSelect
            value={decision}
            onChange={(event) => setDecision(event.target.value as typeof decision)}
          >
            <option value="received">Vasilhames recebidos</option>
            <option value="canceled">Cancelar envio e recompor saldo</option>
          </NativeSelect>
        </Label>
        <Label className="gm-form-field">
          <span>Comprovante/referência</span>
          <Textarea
            minLength={3}
            required
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" disabled={busy || note.trim().length < 3}>
            {busy ? "Registrando…" : "Confirmar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReservationModal({
  open,
  busy,
  items,
  locations,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  items: InventoryItem[];
  locations: StockLocation[];
  onClose: () => void;
  onSubmit: (body: {
    inventoryItemId: string;
    locationId: string;
    quantity: string;
    sourceType: "order" | "scheduled_order" | "event" | "manual";
    sourceId: string;
    reason: string;
    expiresAt?: string;
  }) => Promise<unknown>;
}) {
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [sourceType, setSourceType] = useState<"order" | "scheduled_order" | "event" | "manual">(
    "manual",
  );
  const [sourceId, setSourceId] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  useEffect(() => {
    if (!open) return;
    setInventoryItemId("");
    setLocationId("");
    setQuantity("");
    setSourceType("manual");
    setSourceId("");
    setReason("");
    setExpiresAt("");
  }, [open]);
  return (
    <Modal isOpen={open} onClose={onClose} size="md" title="Reservar estoque">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            inventoryItemId,
            locationId,
            quantity: numberInput(quantity),
            sourceType,
            sourceId: sourceId.trim(),
            reason: reason.trim(),
            ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
          });
        }}
      >
        <div className="gm-form-grid inventory-form-grid">
          <Label className="gm-form-field">
            <span>Item</span>
            <NativeSelect
              value={inventoryItemId}
              onChange={(event) => setInventoryItemId(event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {items
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Local</span>
            <NativeSelect
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {locations
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Quantidade</span>
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
          </Label>
          <Label className="gm-form-field">
            <span>Origem da reserva</span>
            <NativeSelect
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as typeof sourceType)}
            >
              <option value="manual">Manual</option>
              <option value="order">Pedido</option>
              <option value="scheduled_order">Pedido agendado</option>
              <option value="event">Evento</option>
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Referência</span>
            <Input
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              required
            />
          </Label>
          <Label className="gm-form-field">
            <span>Expira em</span>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </Label>
          <Label className="gm-form-field inventory-form-grid__wide">
            <span>Motivo</span>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              required
            />
          </Label>
        </div>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              !inventoryItemId ||
              !locationId ||
              Number(numberInput(quantity)) <= 0 ||
              !sourceId.trim() ||
              reason.trim().length < 3
            }
            type="submit"
          >
            {busy ? "Reservando…" : "Confirmar reserva"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReservationResolutionModal({
  open,
  busy,
  reservation,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  reservation: InventoryReservation | null;
  onClose: () => void;
  onSubmit: (body: {
    decision: "consumed" | "released" | "canceled";
    note: string;
  }) => Promise<unknown>;
}) {
  const [decision, setDecision] = useState<"consumed" | "released" | "canceled">("released");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) return;
    setDecision("released");
    setNote("");
  }, [open]);
  return (
    <Modal isOpen={open} onClose={onClose} size="sm" title="Resolver reserva">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ decision, note: note.trim() });
        }}
      >
        <p className="inventory-context-note">
          Reserva de {reservation?.quantity.toLocaleString("pt-BR") ?? "0"} unidade(s). Consumir
          também baixa o saldo físico.
        </p>
        <Label className="gm-form-field">
          <span>Decisão</span>
          <NativeSelect
            value={decision}
            onChange={(event) => setDecision(event.target.value as typeof decision)}
          >
            <option value="released">Liberar sem baixa</option>
            <option value="consumed">Consumir e baixar</option>
            <option value="canceled">Cancelar</option>
          </NativeSelect>
        </Label>
        <Label className="gm-form-field">
          <span>Justificativa</span>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            minLength={3}
            required
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Voltar
          </Button>
          <Button disabled={busy || note.trim().length < 3} type="submit">
            {busy ? "Salvando…" : "Confirmar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ProductionBatchModal({
  open,
  busy,
  items,
  locations,
  lots,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  items: InventoryItem[];
  locations: StockLocation[];
  lots: InventoryLot[];
  onClose: () => void;
  onSubmit: (body: {
    outputInventoryItemId: string;
    outputLocationId: string;
    batchCode: string;
    plannedQuantity: string;
    expiresAt?: string;
    notes?: string;
    inputs: Array<{
      inventoryItemId: string;
      locationId: string;
      lotId?: string;
      plannedQuantity: string;
    }>;
  }) => Promise<unknown>;
}) {
  const [outputInventoryItemId, setOutputInventoryItemId] = useState("");
  const [outputLocationId, setOutputLocationId] = useState("");
  const [batchCode, setBatchCode] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [inputs, setInputs] = useState([productionInputDraft()]);
  useEffect(() => {
    if (!open) return;
    setOutputInventoryItemId("");
    setOutputLocationId("");
    setBatchCode("");
    setPlannedQuantity("");
    setExpiresAt("");
    setNotes("");
    setInputs([productionInputDraft()]);
  }, [open]);
  return (
    <Modal isOpen={open} onClose={onClose} size="lg" title="Planejar produção">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            outputInventoryItemId,
            outputLocationId,
            batchCode: batchCode.trim(),
            plannedQuantity: numberInput(plannedQuantity),
            ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            inputs: inputs.map((line) => ({
              inventoryItemId: line.inventoryItemId,
              locationId: line.locationId,
              ...(line.lotId ? { lotId: line.lotId } : {}),
              plannedQuantity: numberInput(line.quantity),
            })),
          });
        }}
      >
        <div className="gm-form-grid inventory-form-grid">
          <Label className="gm-form-field">
            <span>Item produzido</span>
            <NativeSelect
              value={outputInventoryItemId}
              onChange={(event) => setOutputInventoryItemId(event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {items
                .filter(
                  (item) => item.active && (item.kind === "prepared" || item.kind === "ingredient"),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Local de entrada</span>
            <NativeSelect
              value={outputLocationId}
              onChange={(event) => setOutputLocationId(event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {locations
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Código do lote</span>
            <Input
              value={batchCode}
              onChange={(event) => setBatchCode(event.target.value)}
              required
            />
          </Label>
          <Label className="gm-form-field">
            <span>Rendimento planejado</span>
            <Input
              inputMode="decimal"
              value={plannedQuantity}
              onChange={(event) => setPlannedQuantity(event.target.value)}
              required
            />
          </Label>
          <Label className="gm-form-field">
            <span>Validade</span>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Observações</span>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Label>
        </div>
        <div className="inventory-section-header">
          <strong>Insumos reservados</strong>
          <Button
            onClick={() => setInputs((current) => [...current, productionInputDraft()])}
            size="sm"
            variant="secondary"
          >
            Adicionar insumo
          </Button>
        </div>
        {inputs.map((line) => (
          <div className="gm-form-grid inventory-form-grid" key={line.id}>
            <Label className="gm-form-field">
              <span>Insumo</span>
              <NativeSelect
                value={line.inventoryItemId}
                onChange={(event) =>
                  setInputs((current) =>
                    current.map((item) =>
                      item.id === line.id
                        ? { ...item, inventoryItemId: event.target.value, lotId: "" }
                        : item,
                    ),
                  )
                }
                required
              >
                <option value="">Selecione</option>
                {items
                  .filter(
                    (item) =>
                      item.active &&
                      item.kind !== "reusable" &&
                      item.kind !== "returnable_container",
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </NativeSelect>
            </Label>
            <Label className="gm-form-field">
              <span>Local</span>
              <NativeSelect
                value={line.locationId}
                onChange={(event) =>
                  setInputs((current) =>
                    current.map((item) =>
                      item.id === line.id
                        ? { ...item, locationId: event.target.value, lotId: "" }
                        : item,
                    ),
                  )
                }
                required
              >
                <option value="">Selecione</option>
                {locations
                  .filter((item) => item.active)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </NativeSelect>
            </Label>
            <Label className="gm-form-field">
              <span>Lote, se controlado</span>
              <NativeSelect
                value={line.lotId}
                onChange={(event) =>
                  setInputs((current) =>
                    current.map((item) =>
                      item.id === line.id ? { ...item, lotId: event.target.value } : item,
                    ),
                  )
                }
              >
                <option value="">Sem lote</option>
                {lots
                  .filter(
                    (lot) =>
                      lot.inventoryItemId === line.inventoryItemId &&
                      lot.locationId === line.locationId &&
                      lot.quantity > 0,
                  )
                  .map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.batchCode} · {lot.quantity}
                    </option>
                  ))}
              </NativeSelect>
            </Label>
            <Label className="gm-form-field">
              <span>Quantidade</span>
              <Input
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) =>
                  setInputs((current) =>
                    current.map((item) =>
                      item.id === line.id ? { ...item, quantity: event.target.value } : item,
                    ),
                  )
                }
                required
              />
            </Label>
            {inputs.length > 1 && (
              <Button
                onClick={() =>
                  setInputs((current) => current.filter((item) => item.id !== line.id))
                }
                size="sm"
                variant="ghost"
              >
                Remover
              </Button>
            )}
          </div>
        ))}
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              !outputInventoryItemId ||
              !outputLocationId ||
              !batchCode.trim() ||
              Number(numberInput(plannedQuantity)) <= 0 ||
              inputs.some(
                (line) =>
                  !line.inventoryItemId ||
                  !line.locationId ||
                  Number(numberInput(line.quantity)) <= 0,
              )
            }
            type="submit"
          >
            {busy ? "Planejando…" : "Reservar insumos"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ProductionCompletionModal({
  open,
  busy,
  batch,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  batch: ProductionBatch | null;
  onClose: () => void;
  onSubmit: (body: {
    actualQuantity: string;
    expiresAt?: string;
    inputs: Array<{ inputId: string; actualQuantity: string }>;
  }) => Promise<unknown>;
}) {
  const [actualQuantity, setActualQuantity] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open || !batch) return;
    setActualQuantity(String(batch.plannedQuantity));
    setExpiresAt(batch.expiresAt ? batch.expiresAt.slice(0, 16) : "");
    setQuantities(
      Object.fromEntries(batch.inputs.map((line) => [line.id, String(line.plannedQuantity)])),
    );
  }, [batch, open]);
  return (
    <Modal isOpen={open} onClose={onClose} size="md" title="Concluir produção">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!batch) return;
          void onSubmit({
            actualQuantity: numberInput(actualQuantity),
            ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
            inputs: batch.inputs.map((line) => ({
              inputId: line.id,
              actualQuantity: numberInput(quantities[line.id] ?? ""),
            })),
          });
        }}
      >
        <p className="inventory-context-note">
          Informe rendimento e consumo reais. O custo médio do preparado será calculado
          automaticamente.
        </p>
        <Label className="gm-form-field">
          <span>Rendimento real</span>
          <Input
            inputMode="decimal"
            value={actualQuantity}
            onChange={(event) => setActualQuantity(event.target.value)}
            required
          />
        </Label>
        <Label className="gm-form-field">
          <span>Validade final</span>
          <Input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </Label>
        {batch?.inputs.map((line) => (
          <Label className="gm-form-field" key={line.id}>
            <span>Consumo real · {line.plannedQuantity.toLocaleString("pt-BR")} planejado</span>
            <Input
              inputMode="decimal"
              value={quantities[line.id] ?? ""}
              onChange={(event) =>
                setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
              }
              required
            />
          </Label>
        ))}
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              !batch ||
              Number(numberInput(actualQuantity)) <= 0 ||
              batch.inputs.some((line) => Number(numberInput(quantities[line.id] ?? "")) <= 0)
            }
            type="submit"
          >
            {busy ? "Concluindo…" : "Concluir e movimentar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function InterunitTransferModal({
  open,
  busy,
  currentUnitId,
  units,
  items,
  locations,
  lots,
  catalog,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  currentUnitId: string;
  units: SelectOption[];
  items: InventoryItem[];
  locations: StockLocation[];
  lots: InventoryLot[];
  catalog: {
    items: Array<{
      id: string;
      unitId: string;
      name: string;
      sku: string | null;
      barcode: string | null;
    }>;
    locations: Array<{ id: string; unitId: string; name: string }>;
  };
  onClose: () => void;
  onSubmit: (body: {
    destinationUnitId: string;
    reason: string;
    lines: Array<{
      sourceInventoryItemId: string;
      destinationInventoryItemId: string;
      sourceLocationId: string;
      destinationLocationId: string;
      sourceLotId?: string;
      quantity: string;
    }>;
  }) => Promise<unknown>;
}) {
  const [destinationUnitId, setDestinationUnitId] = useState("");
  const [sourceInventoryItemId, setSourceInventoryItemId] = useState("");
  const [destinationInventoryItemId, setDestinationInventoryItemId] = useState("");
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [sourceLotId, setSourceLotId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) return;
    setDestinationUnitId("");
    setSourceInventoryItemId("");
    setDestinationInventoryItemId("");
    setSourceLocationId("");
    setDestinationLocationId("");
    setSourceLotId("");
    setQuantity("");
    setReason("");
  }, [open]);
  useEffect(() => {
    const source = items.find((item) => item.id === sourceInventoryItemId);
    if (!source || !destinationUnitId) return;
    const match = catalog.items.find(
      (item) =>
        item.unitId === destinationUnitId &&
        ((source.barcode && item.barcode === source.barcode) ||
          (source.sku && item.sku === source.sku)),
    );
    setDestinationInventoryItemId(match?.id ?? "");
  }, [catalog.items, destinationUnitId, items, sourceInventoryItemId]);
  return (
    <Modal isOpen={open} onClose={onClose} size="lg" title="Transferir entre unidades">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            destinationUnitId,
            reason: reason.trim(),
            lines: [
              {
                sourceInventoryItemId,
                destinationInventoryItemId,
                sourceLocationId,
                destinationLocationId,
                ...(sourceLotId ? { sourceLotId } : {}),
                quantity: numberInput(quantity),
              },
            ],
          });
        }}
      >
        <p className="inventory-context-note">
          O envio baixa a origem imediatamente; o destino entra somente após conferência parcial ou
          total.
        </p>
        <div className="gm-form-grid inventory-form-grid">
          <Label className="gm-form-field">
            <span>Unidade de destino</span>
            <NativeSelect
              value={destinationUnitId}
              onChange={(event) => {
                setDestinationUnitId(event.target.value);
                setDestinationLocationId("");
              }}
              required
            >
              <option value="">Selecione</option>
              {units
                .filter((unit) => unit.id !== currentUnitId)
                .map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Item na origem</span>
            <NativeSelect
              value={sourceInventoryItemId}
              onChange={(event) => {
                setSourceInventoryItemId(event.target.value);
                setSourceLotId("");
              }}
              required
            >
              <option value="">Selecione</option>
              {items
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Item correspondente no destino</span>
            <NativeSelect
              value={destinationInventoryItemId}
              onChange={(event) => setDestinationInventoryItemId(event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {catalog.items
                .filter((item) => item.unitId === destinationUnitId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Local de origem</span>
            <NativeSelect
              value={sourceLocationId}
              onChange={(event) => {
                setSourceLocationId(event.target.value);
                setSourceLotId("");
              }}
              required
            >
              <option value="">Selecione</option>
              {locations
                .filter((item) => item.active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Local de destino</span>
            <NativeSelect
              value={destinationLocationId}
              onChange={(event) => setDestinationLocationId(event.target.value)}
              required
            >
              <option value="">Selecione</option>
              {catalog.locations
                .filter((item) => item.unitId === destinationUnitId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Lote, se controlado</span>
            <NativeSelect
              value={sourceLotId}
              onChange={(event) => setSourceLotId(event.target.value)}
            >
              <option value="">Sem lote</option>
              {lots
                .filter(
                  (lot) =>
                    lot.inventoryItemId === sourceInventoryItemId &&
                    lot.locationId === sourceLocationId &&
                    lot.quantity > 0,
                )
                .map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.batchCode} · {lot.quantity}
                  </option>
                ))}
            </NativeSelect>
          </Label>
          <Label className="gm-form-field">
            <span>Quantidade</span>
            <Input
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
          </Label>
          <Label className="gm-form-field inventory-form-grid__wide">
            <span>Motivo</span>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              required
            />
          </Label>
        </div>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              !destinationUnitId ||
              !sourceInventoryItemId ||
              !destinationInventoryItemId ||
              !sourceLocationId ||
              !destinationLocationId ||
              Number(numberInput(quantity)) <= 0 ||
              reason.trim().length < 3
            }
            type="submit"
          >
            {busy ? "Enviando…" : "Confirmar envio"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function InterunitReceiptModal({
  open,
  busy,
  transfer,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  transfer: InterunitTransfer | null;
  onClose: () => void;
  onSubmit: (body: {
    note: string;
    lines: Array<{ lineId: string; quantity: string }>;
  }) => Promise<unknown>;
}) {
  const [note, setNote] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open || !transfer) return;
    setNote("");
    setQuantities(
      Object.fromEntries(
        transfer.lines
          .filter((line) => line.quantityReceived < line.quantitySent)
          .map((line) => [line.id, String(line.quantitySent - line.quantityReceived)]),
      ),
    );
  }, [open, transfer]);
  const pending = transfer?.lines.filter((line) => line.quantityReceived < line.quantitySent) ?? [];
  return (
    <Modal isOpen={open} onClose={onClose} size="md" title="Conferir transferência">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            note: note.trim(),
            lines: pending
              .filter((line) => Number(numberInput(quantities[line.id] ?? "0")) > 0)
              .map((line) => ({
                lineId: line.id,
                quantity: numberInput(quantities[line.id] ?? "0"),
              })),
          });
        }}
      >
        <p className="inventory-context-note">
          Informe apenas o que chegou agora. O saldo restante continuará em trânsito.
        </p>
        {pending.map((line) => (
          <Label className="gm-form-field" key={line.id}>
            <span>
              Receber · restante{" "}
              {(line.quantitySent - line.quantityReceived).toLocaleString("pt-BR")}
            </span>
            <Input
              inputMode="decimal"
              max={line.quantitySent - line.quantityReceived}
              min="0"
              value={quantities[line.id] ?? ""}
              onChange={(event) =>
                setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
              }
            />
          </Label>
        ))}
        <Label className="gm-form-field">
          <span>Conferência/divergência</span>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            minLength={3}
            required
          />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              busy ||
              note.trim().length < 3 ||
              !pending.some((line) => Number(numberInput(quantities[line.id] ?? "0")) > 0)
            }
            type="submit"
          >
            {busy ? "Recebendo…" : "Registrar recebimento"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function InventoryClosingModal({
  open,
  busy,
  locations,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  locations: StockLocation[];
  onClose: () => void;
  onSubmit: (body: {
    period: string;
    locationId?: string;
    shiftReference?: string;
    notes?: string;
  }) => Promise<unknown>;
}) {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [locationId, setLocationId] = useState("");
  const [shiftReference, setShiftReference] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!open) return;
    setPeriod(new Date().toISOString().slice(0, 7));
    setLocationId("");
    setShiftReference("");
    setNotes("");
  }, [open]);
  return (
    <Modal isOpen={open} onClose={onClose} size="sm" title="Fechar estoque do mês">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            period,
            ...(locationId ? { locationId } : {}),
            ...(shiftReference.trim() ? { shiftReference: shiftReference.trim() } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          });
        }}
      >
        <p className="inventory-context-note">
          O fechamento registra um snapshot imutável do físico, reservado, custo médio e valor por
          local.
        </p>
        <Label className="gm-form-field">
          <span>Competência</span>
          <Input
            type="month"
            max={new Date().toISOString().slice(0, 7)}
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            required
          />
        </Label>
        <Label className="gm-form-field">
          <span>Setor</span>
          <NativeSelect value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">Todos os setores</option>
            {locations
              .filter((location) => location.active)
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
          </NativeSelect>
        </Label>
        <Label className="gm-form-field">
          <span>Turno/referência</span>
          <Input
            maxLength={80}
            placeholder="Ex.: noite-2026-08-20"
            value={shiftReference}
            onChange={(event) => setShiftReference(event.target.value)}
          />
        </Label>
        <Label className="gm-form-field">
          <span>Observações</span>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Label>
        <div className="inventory-modal-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button disabled={busy || !period} type="submit">
            {busy ? "Fechando…" : "Criar fechamento imutável"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function LocationItemSettingModal({
  open,
  busy,
  items,
  locations,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  items: InventoryItem[];
  locations: StockLocation[];
  onClose: () => void;
  onSubmit: (body: {
    locationId: string;
    inventoryItemId: string;
    minimumQuantity: string;
    targetQuantity: string;
    transferUnitLabel?: string;
    unitsPerTransferUnit: string;
  }) => Promise<unknown>;
}) {
  const [locationId, setLocationId] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [minimum, setMinimum] = useState("0");
  const [target, setTarget] = useState("0");
  const [unitLabel, setUnitLabel] = useState("");
  const [factor, setFactor] = useState("1");
  return (
    <Modal isOpen={open} onClose={onClose} size="sm" title="Meta por setor">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            locationId,
            inventoryItemId,
            minimumQuantity: numberInput(minimum),
            targetQuantity: numberInput(target),
            ...(unitLabel.trim() ? { transferUnitLabel: unitLabel.trim() } : {}),
            unitsPerTransferUnit: numberInput(factor),
          });
        }}
      >
        <Label className="gm-form-field">
          <span>Setor</span>
          <NativeSelect
            required
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value="">Selecione</option>
            {locations
              .filter((location) => location.active)
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
          </NativeSelect>
        </Label>
        <Label className="gm-form-field">
          <span>Item</span>
          <NativeSelect
            required
            value={inventoryItemId}
            onChange={(event) => setInventoryItemId(event.target.value)}
          >
            <option value="">Selecione</option>
            {items
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </NativeSelect>
        </Label>
        <div className="gm-form-grid inventory-form-grid">
          <Label className="gm-form-field">
            <span>Mínimo</span>
            <Input
              inputMode="decimal"
              required
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Meta</span>
            <Input
              inputMode="decimal"
              required
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Unidade de transferência</span>
            <Input
              placeholder="Ex.: caixa"
              value={unitLabel}
              onChange={(event) => setUnitLabel(event.target.value)}
            />
          </Label>
          <Label className="gm-form-field">
            <span>Itens por unidade</span>
            <Input
              inputMode="decimal"
              required
              value={factor}
              onChange={(event) => setFactor(event.target.value)}
            />
          </Label>
        </div>
        <div className="inventory-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              busy ||
              !locationId ||
              !inventoryItemId ||
              Number(numberInput(target)) < Number(numberInput(minimum))
            }
          >
            {busy ? "Salvando…" : "Salvar meta"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function InventoryIssueRouteModal({
  open,
  busy,
  items,
  locations,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  items: InventoryItem[];
  locations: StockLocation[];
  onClose: () => void;
  onSubmit: (body: { productId: string; locationId: string; active: boolean }) => Promise<unknown>;
}) {
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const products = items.filter((item) => item.active && item.kind === "resale" && item.productId);
  return (
    <Modal isOpen={open} onClose={onClose} size="sm" title="Origem da baixa por venda">
      <form
        className="gm-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ productId, locationId, active: true });
        }}
      >
        <p className="inventory-context-note">
          Define de qual setor o produto de revenda será baixado. Sem rota, a venda é bloqueada
          quando houver saldo em mais de um setor.
        </p>
        <Label className="gm-form-field">
          <span>Produto</span>
          <NativeSelect
            required
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">Selecione</option>
            {products.map((item) => (
              <option key={item.id} value={item.productId ?? ""}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="gm-form-field">
          <span>Setor da baixa</span>
          <NativeSelect
            required
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value="">Selecione</option>
            {locations
              .filter((location) => location.active)
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
          </NativeSelect>
        </Label>
        <div className="inventory-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !productId || !locationId}>
            {busy ? "Salvando…" : "Salvar rota"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
