import type { RefObject } from "react";
import { formatMoney, type MenuItem, type Modifier, type ModifierGroup } from "../../lib/menu";

export function ProductDetail({
  dialogRef,
  selected,
  selection,
  notes,
  quantity,
  unitPrice,
  onClose,
  onDismiss,
  onToggleModifier,
  onNotes,
  onQuantity,
  onAdd,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  selected: MenuItem | null;
  selection: Record<string, Modifier[]>;
  notes: string;
  quantity: number;
  unitPrice: number;
  onClose: () => void;
  onDismiss: () => void;
  onToggleModifier: (group: ModifierGroup, modifier: Modifier) => void;
  onNotes: (notes: string) => void;
  onQuantity: (quantity: number) => void;
  onAdd: () => void;
}) {
  return (
    <dialog className="product-dialog" ref={dialogRef} onClose={onDismiss}>
      {selected && (
        <div className="dialog-shell">
          <div className={`product-hero food-${selected.id}`}>
            <span aria-hidden="true">
              {selected.imageUrl ? (
                // biome-ignore lint/performance/noImgElement: the API media host is configured at runtime.
                <img src={selected.imageUrl} alt="" decoding="async" />
              ) : (
                selected.visual
              )}
            </span>
            <button type="button" aria-label="Fechar" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="dialog-content">
            <p className="overline">{selected.category}</p>
            <h2>{selected.name}</h2>
            <p>{selected.description}</p>
            <strong className="base-price">{formatMoney(selected.priceCents)}</strong>
            {selected.modifierGroups?.map((group) => (
              <fieldset key={group.id}>
                <legend>
                  {group.name}
                  <small>{group.required ? "Obrigatório" : `Até ${group.maxSelections}`}</small>
                </legend>
                {group.options.map((option) => (
                  <label key={option.id}>
                    <input
                      type={group.maxSelections === 1 ? "radio" : "checkbox"}
                      name={group.id}
                      checked={Boolean(selection[group.id]?.some((item) => item.id === option.id))}
                      onChange={() => onToggleModifier(group, option)}
                    />
                    <span>{option.name}</span>
                    <b>{option.priceCents ? `+ ${formatMoney(option.priceCents)}` : "incluído"}</b>
                  </label>
                ))}
              </fieldset>
            ))}
            <label className="notes">
              Alguma observação?
              <textarea
                rows={2}
                maxLength={180}
                value={notes}
                onChange={(event) => onNotes(event.target.value)}
                placeholder="Ex.: sem cebola"
              />
            </label>
            <div className="add-row">
              <div className="quantity">
                <span className="sr-only">Quantidade</span>
                <button
                  type="button"
                  aria-label="Diminuir quantidade"
                  onClick={() => onQuantity(Math.max(1, quantity - 1))}
                >
                  −
                </button>
                <output>{quantity}</output>
                <button
                  type="button"
                  aria-label="Aumentar quantidade"
                  onClick={() => onQuantity(quantity + 1)}
                >
                  +
                </button>
              </div>
              <button
                className="add-button"
                type="button"
                disabled={!selected.available}
                onClick={onAdd}
              >
                {selected.available ? (
                  <>
                    Adicionar <b>{formatMoney(unitPrice * quantity)}</b>
                  </>
                ) : (
                  "Indisponível agora"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
