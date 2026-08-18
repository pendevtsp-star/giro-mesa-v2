import { Badge, Button, Icon } from "@giromesa/ui";
import type { PendingStockProductSuggestion } from "../../../operations.shared";
import { formatMoney } from "../../../rules";

type StockInboxProps = {
  isOpen: boolean;
  suggestions: PendingStockProductSuggestion[];
  onConfigure: (suggestion: PendingStockProductSuggestion) => void;
  onDismiss: (suggestionId: string) => void;
  onIncludeAll: () => void;
  onToggle: () => void;
};

export function StockInbox({
  isOpen,
  suggestions,
  onConfigure,
  onDismiss,
  onIncludeAll,
  onToggle,
}: StockInboxProps) {
  if (suggestions.length === 0) return null;

  return (
    <section className="catalog-stock-inbox" aria-labelledby="catalog-stock-inbox-title">
      <div className="catalog-stock-inbox__header">
        <div className="catalog-stock-inbox__heading">
          <span className="catalog-stock-inbox__icon">
            <Icon name="catalog" size={18} />
          </span>
          <div>
            <div className="catalog-stock-inbox__title-row">
              <h3 id="catalog-stock-inbox-title">Inbox de Mercadorias do Estoque</h3>
              <Badge tone="info">{suggestions.length} novos itens recebidos</Badge>
            </div>
            <p>
              Novos produtos de revenda deram entrada nas compras e estão prontos para inclusão
              imediata no cardápio com preço sugerido.
            </p>
          </div>
        </div>

        <div className="catalog-stock-inbox__actions">
          <Button onClick={onIncludeAll} size="sm" variant="primary">
            <Icon name="check" size={14} />
            <span>Adicionar Todos ({suggestions.length})</span>
          </Button>
          <button
            aria-controls="catalog-stock-inbox-items"
            aria-expanded={isOpen}
            className="catalog-card-icon-btn"
            onClick={onToggle}
            title={isOpen ? "Minimizar Inbox" : "Expandir Inbox"}
            type="button"
          >
            <Icon name={isOpen ? "arrow-up" : "arrow-down"} size={14} />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="catalog-stock-inbox__grid" id="catalog-stock-inbox-items">
          {suggestions.map((suggestion) => {
            const margin =
              suggestion.suggestedPriceCents > 0
                ? Math.round(
                    ((suggestion.suggestedPriceCents - suggestion.stockCostCents) /
                      suggestion.suggestedPriceCents) *
                      100,
                  )
                : 0;

            return (
              <article className="catalog-stock-inbox__item" key={suggestion.id}>
                <div>
                  <div className="catalog-stock-inbox__item-heading">
                    <div>
                      <strong>{suggestion.name}</strong>
                      <span>
                        {suggestion.suggestedCategoryName} • EAN: {suggestion.eanBarcode}
                      </span>
                    </div>
                    <span className="catalog-stock-inbox__stock">
                      {suggestion.currentStockUnits} {suggestion.unit}s
                    </span>
                  </div>

                  <div className="catalog-stock-inbox__prices">
                    <span>
                      Custo: <strong>{formatMoney(suggestion.stockCostCents)}</strong>
                    </span>
                    <span>
                      Venda sugerida:{" "}
                      <strong className="catalog-stock-inbox__suggested-price">
                        {formatMoney(suggestion.suggestedPriceCents)}
                      </strong>
                    </span>
                    <span className="catalog-stock-inbox__margin">({margin}% margem)</span>
                  </div>
                  <small className="catalog-stock-inbox__source">
                    {suggestion.receivedDate} • {suggestion.supplier}
                  </small>
                </div>

                <div className="catalog-stock-inbox__item-actions">
                  <Button
                    className="catalog-stock-inbox__configure"
                    onClick={() => onConfigure(suggestion)}
                    size="sm"
                    variant="secondary"
                  >
                    <Icon name="plus" size={13} />
                    <span>Configurar & Incluir</span>
                  </Button>
                  <button
                    aria-label={`Dispensar sugestão de ${suggestion.name}`}
                    className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                    onClick={() => onDismiss(suggestion.id)}
                    title="Dispensar sugestão"
                    type="button"
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
