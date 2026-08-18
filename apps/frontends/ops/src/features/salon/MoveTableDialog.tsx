import { Button, Icon, Modal } from "@giromesa/ui";
import { useState } from "react";
import { formatMoney } from "../../rules";

export type AvailableTableOption = {
  id: string;
  label: string;
  seats: number;
  roomName: string;
  isOccupied: boolean;
  totalCents?: number;
};

export function MoveTableDialog({
  isOpen,
  onClose,
  currentTableLabel,
  availableTables,
  onMoveTable,
  onTransferItems,
  tabItems = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  currentTableLabel: string;
  availableTables: AvailableTableOption[];
  onMoveTable: (targetTableId: string) => Promise<void>;
  onTransferItems?: (targetTableId: string, itemIds: string[]) => Promise<void>;
  tabItems?: { id: string; name: string; quantity: number; totalPriceCents: number }[];
}) {
  const [mode, setMode] = useState<"entire_tab" | "items">("entire_tab");
  const [selectedTargetTableId, setSelectedTargetTableId] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const freeTables = availableTables.filter((t) => !t.isOccupied);
  const occupiedTables = availableTables.filter((t) => t.isOccupied);
  const canTransferItems = Boolean(onTransferItems && tabItems.length > 0);

  async function handleConfirm() {
    if (!selectedTargetTableId) return;
    setSubmitting(true);
    try {
      if (mode === "entire_tab") {
        await onMoveTable(selectedTargetTableId);
      } else if (onTransferItems && selectedItemIds.length > 0) {
        await onTransferItems(selectedTargetTableId, selectedItemIds);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      className="move-table-modal"
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={`${canTransferItems ? "Transferência e mudança" : "Mudar mesa"} — ${currentTableLabel}`}
    >
      <div className="move-table-container">
        {/* Toggle Mode */}
        {canTransferItems && (
          <div className="move-table-mode-toggle">
            <button
              className={`move-table-mode-btn ${mode === "entire_tab" ? "active" : ""}`}
              onClick={() => setMode("entire_tab")}
              type="button"
            >
              <Icon name="salon" size={14} />
              <span>Mudar Comanda de Mesa</span>
            </button>
            <button
              className={`move-table-mode-btn ${mode === "items" ? "active" : ""}`}
              onClick={() => setMode("items")}
              type="button"
            >
              <Icon name="list" size={14} />
              <span>Transferir Itens Específicos</span>
            </button>
          </div>
        )}

        {/* Entire Tab Move */}
        {mode === "entire_tab" && (
          <div className="move-table-section">
            <p className="move-table-hint">
              A comanda inteira e todos os pedidos serão transferidos para a nova mesa. A mesa atual
              ({currentTableLabel}) será liberada.
            </p>
            <label className="move-table-select-label">
              <span>Selecione a Mesa de Destino (Livre):</span>
              <select
                aria-label="Mesa de destino livre"
                onChange={(e) => setSelectedTargetTableId(e.target.value)}
                value={selectedTargetTableId}
              >
                <option value="">Selecione uma mesa livre…</option>
                {freeTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({t.seats} lugares · {t.roomName})
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* Item Transfer Move */}
        {mode === "items" && (
          <div className="move-table-section">
            <p className="move-table-hint">
              Selecione os itens da comanda atual para transferir para outra mesa em atendimento:
            </p>

            <div className="move-table-items-list">
              {tabItems.length === 0 ? (
                <p className="move-table-empty">Nenhum item nesta comanda.</p>
              ) : (
                tabItems.map((item) => (
                  <label className="move-table-item-checkbox" key={item.id}>
                    <input
                      checked={selectedItemIds.includes(item.id)}
                      onChange={(e) =>
                        setSelectedItemIds((curr) =>
                          e.target.checked
                            ? [...curr, item.id]
                            : curr.filter((id) => id !== item.id),
                        )
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>
                        {item.quantity}x {item.name}
                      </strong>
                      <small>{formatMoney(item.totalPriceCents)}</small>
                    </span>
                  </label>
                ))
              )}
            </div>

            <label className="move-table-select-label">
              <span>Transferir para a Mesa:</span>
              <select
                aria-label="Mesa de destino"
                onChange={(e) => setSelectedTargetTableId(e.target.value)}
                value={selectedTargetTableId}
              >
                <option value="">Selecione a mesa de destino…</option>
                {occupiedTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} (Ocupada · {t.roomName} · Consumo:{" "}
                    {t.totalCents ? formatMoney(t.totalCents) : "R$ 0,00"})
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="move-table-actions">
          <Button onClick={onClose} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={
              submitting ||
              !selectedTargetTableId ||
              (mode === "items" && selectedItemIds.length === 0)
            }
            onClick={() => void handleConfirm()}
            variant="primary"
          >
            {submitting
              ? "Transferindo…"
              : mode === "entire_tab"
                ? "Confirmar Mudança de Mesa"
                : "Transferir Itens Selecionados"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
