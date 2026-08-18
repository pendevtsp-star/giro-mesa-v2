export const SPEED_KITCHEN_CHIPS = [
  "Sem cebola",
  "Gelo e limão",
  "Ao ponto",
  "Bem passado",
  "Mal passado",
  "Urgente",
  "Para viagem",
  "Sem sal",
  "Molho à parte",
  "Sem gelo",
  "Caprichado",
] as const;

export function QuickOrderChips({ onSelectChip }: { onSelectChip: (chip: string) => void }) {
  return (
    <div className="speed-kitchen-chips">
      <small className="speed-kitchen-chips__label">Obs. Rápidas:</small>
      <div className="speed-kitchen-chips__list">
        {SPEED_KITCHEN_CHIPS.map((chip) => (
          <button
            className="speed-chip-btn"
            key={chip}
            onClick={() => onSelectChip(chip)}
            type="button"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
