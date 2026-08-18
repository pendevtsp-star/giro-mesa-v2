import { Button, Icon, Modal } from "@giromesa/ui";
import { useState } from "react";

export type WaitlistEntry = {
  id: string;
  name: string;
  partySize: number;
  phone?: string;
  notes?: string;
  createdAt: string;
  preferredRoomId?: string;
};

export function WaitlistDrawer({
  isOpen,
  onClose,
  waitlist,
  onAddEntry,
  onRemoveEntry,
  onSeatParty,
  availableTables = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  waitlist: WaitlistEntry[];
  onAddEntry: (entry: Omit<WaitlistEntry, "id" | "createdAt">) => void;
  onRemoveEntry: (id: string) => void;
  onSeatParty: (entryId: string, tableId: string) => Promise<void>;
  availableTables: { id: string; label: string; seats: number; roomName: string }[];
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [seatingEntryId, setSeatingEntryId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || partySize < 1) return;
    onAddEntry({
      name: name.trim(),
      partySize,
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setName("");
    setPartySize(2);
    setPhone("");
    setNotes("");
    setIsAdding(false);
  }

  async function handleConfirmSeating() {
    if (!seatingEntryId || !selectedTableId) return;
    setSubmitting(true);
    try {
      await onSeatParty(seatingEntryId, selectedTableId);
      setSeatingEntryId(null);
      setSelectedTableId("");
    } finally {
      setSubmitting(false);
    }
  }

  function elapsedMinutes(createdAt: string) {
    const min = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
    return min === 0 ? "agora" : `${min} min`;
  }

  return (
    <Modal
      className="waitlist-modal"
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={`Fila de Espera & Recepção (${waitlist.length} grupos)`}
    >
      <div className="waitlist-container">
        {/* Top bar with Add button */}
        <div className="waitlist-top-bar">
          <div className="waitlist-summary">
            <strong>{waitlist.reduce((sum, e) => sum + e.partySize, 0)} pessoas aguardando</strong>
            <small>{availableTables.length} mesas livres no salão</small>
          </div>
          <Button
            onClick={() => setIsAdding((curr) => !curr)}
            size="sm"
            variant={isAdding ? "ghost" : "primary"}
          >
            <Icon name={isAdding ? "x" : "plus"} size={14} />
            <span>{isAdding ? "Cancelar" : "Novo Cliente na Fila"}</span>
          </Button>
        </div>

        {/* Add Entry Form */}
        {isAdding && (
          <form className="waitlist-form" onSubmit={handleCreate}>
            <h4>Adicionar à Lista de Espera</h4>
            <div className="waitlist-form-grid">
              <label>
                Nome do Titular
                <input
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Mariana Silva"
                  required
                  value={name}
                />
              </label>

              <label>
                Qtd. Pessoas
                <input
                  max={50}
                  min={1}
                  onChange={(e) => setPartySize(Number(e.target.value))}
                  required
                  type="number"
                  value={partySize}
                />
              </label>

              <label>
                WhatsApp / Telefone (opcional)
                <input
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(31) 99999-0000"
                  value={phone}
                />
              </label>

              <label>
                Observações
                <input
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex.: Prefere varanda / com criança"
                  value={notes}
                />
              </label>
            </div>
            <div className="waitlist-form-actions">
              <Button disabled={!name.trim()} size="sm" type="submit" variant="primary">
                Confirmar na Fila
              </Button>
            </div>
          </form>
        )}

        {/* Seating Dialog Step */}
        {seatingEntryId && (
          <div className="waitlist-seating-box">
            <h4>
              Alocar Mesa para:{" "}
              <strong>{waitlist.find((w) => w.id === seatingEntryId)?.name}</strong> (
              {waitlist.find((w) => w.id === seatingEntryId)?.partySize} pessoas)
            </h4>
            <div className="waitlist-seating-grid">
              <label>
                Selecione a Mesa Livre:
                <select
                  aria-label="Mesa livre compatível"
                  onChange={(e) => setSelectedTableId(e.target.value)}
                  value={selectedTableId}
                >
                  <option value="">Selecione a mesa…</option>
                  {availableTables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} ({t.seats} lugares · {t.roomName})
                    </option>
                  ))}
                </select>
              </label>
              <div className="waitlist-seating-actions">
                <Button onClick={() => setSeatingEntryId(null)} size="sm" variant="ghost">
                  Cancelar
                </Button>
                <Button
                  disabled={submitting || !selectedTableId}
                  onClick={() => void handleConfirmSeating()}
                  size="sm"
                  variant="primary"
                >
                  {submitting ? "Alocando…" : "Sentar e Abrir Mesa"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Waitlist entries */}
        <div className="waitlist-list">
          {waitlist.length === 0 ? (
            <div className="waitlist-empty">
              <Icon name="check" size={24} />
              <strong>Fila de espera vazia</strong>
              <small>Nenhum grupo aguardando no momento.</small>
            </div>
          ) : (
            waitlist.map((entry, idx) => (
              <div className="waitlist-card" key={entry.id}>
                <div className="waitlist-card__pos">
                  <span>#{idx + 1}</span>
                </div>
                <div className="waitlist-card__info">
                  <div className="waitlist-card__header">
                    <strong>{entry.name}</strong>
                    <span className="waitlist-party-badge">
                      <Icon name="user" size={12} />
                      {entry.partySize} {entry.partySize === 1 ? "pessoa" : "pessoas"}
                    </span>
                    <span className="waitlist-time-badge">
                      <Icon name="clock" size={12} />
                      {elapsedMinutes(entry.createdAt)}
                    </span>
                  </div>
                  {entry.phone && <small className="waitlist-phone">WhatsApp: {entry.phone}</small>}
                  {entry.notes && <p className="waitlist-notes">Obs: {entry.notes}</p>}
                </div>
                <div className="waitlist-card__actions">
                  <Button
                    disabled={availableTables.length === 0}
                    onClick={() => {
                      setSeatingEntryId(entry.id);
                      setSelectedTableId(availableTables[0]?.id ?? "");
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    Alocar Mesa
                  </Button>
                  <button
                    aria-label="Remover da fila"
                    className="waitlist-remove-btn"
                    onClick={() => onRemoveEntry(entry.id)}
                    type="button"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="waitlist-footer">
          <Button onClick={onClose} variant="ghost">
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
