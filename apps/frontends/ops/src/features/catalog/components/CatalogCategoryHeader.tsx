import { Button, Icon } from "@giromesa/ui";
import type { CatalogProduct, PilotCatalogCategory } from "../../../operations.shared";
import { formatMoney } from "../../../rules";

type CatalogCategoryHeaderProps = {
  busy: boolean;
  category: PilotCatalogCategory;
  collapsed: boolean;
  items: CatalogProduct[];
  onArchive: () => void;
  onCreateProduct: () => void;
  onEdit: () => void;
  onMove: (direction: "down" | "up") => void;
  onToggleAvailability: () => void;
  onToggleCollapsed: () => void;
  showReorder: boolean;
};

export function CatalogCategoryHeader({
  busy,
  category,
  collapsed,
  items,
  onArchive,
  onCreateProduct,
  onEdit,
  onMove,
  onToggleAvailability,
  onToggleCollapsed,
  showReorder,
}: CatalogCategoryHeaderProps) {
  const activeCount = items.filter((product) => product.available && product.active).length;
  const pausedCount = items.length - activeCount;
  const allPaused = items.length > 0 && activeCount === 0;
  const prices = items
    .map((product) => product.priceCents)
    .filter((price): price is number => typeof price === "number" && price > 0);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  return (
    <div className="catalog-category-header catalog-category-header--detailed">
      <div className="catalog-category-header__left">
        <div className="catalog-category-header__identity">
          <Button
            aria-expanded={!collapsed}
            className="catalog-card-icon-btn catalog-category-header__collapse"
            onClick={onToggleCollapsed}
            title={
              collapsed ? "Expandir produtos desta categoria" : "Recolher produtos desta categoria"
            }
            type="button"
          >
            <Icon name={collapsed ? "arrow-down" : "arrow-up"} size={14} />
          </Button>
          <div>
            <div className="catalog-category-header__title-row">
              <h2>{category.name}</h2>
              <div className="catalog-category-header__metadata">
                <span className="catalog-category-header__count">
                  {items.length} {items.length === 1 ? "item" : "itens"} ({activeCount} ativos
                  {pausedCount > 0 ? ` • ${pausedCount} pausados` : ""})
                </span>
                {minPrice > 0 && (
                  <span className="catalog-category-header__price-range">
                    {minPrice === maxPrice
                      ? formatMoney(minPrice)
                      : `${formatMoney(minPrice)} – ${formatMoney(maxPrice)}`}
                  </span>
                )}
                {category.schedule && (
                  <span className="catalog-category-header__schedule">
                    <Icon name="clock" size={11} />
                    <span>
                      {category.schedule.startTime} - {category.schedule.endTime}
                    </span>
                  </span>
                )}
                {category.channels && (
                  <span className="catalog-category-header__channels">
                    {[
                      category.channels.salon && "Salão",
                      category.channels.qrMesa && "QR Mesa",
                      category.channels.delivery && "Delivery",
                    ]
                      .filter(Boolean)
                      .join(" • ")}
                  </span>
                )}
              </div>
            </div>
            {category.description && <p>{category.description}</p>}
          </div>
        </div>
      </div>

      <div className="catalog-category-header__actions">
        {items.length > 0 && (
          <Button
            className="catalog-category-header__action"
            onClick={onToggleAvailability}
            size="sm"
            title={
              allPaused
                ? "Ativar todos os itens desta categoria"
                : "Pausar todos os itens desta categoria"
            }
            variant="secondary"
          >
            <Icon name={allPaused ? "check" : "minus"} size={12} />
            <span>{allPaused ? "Ativar Categoria" : "Pausar Categoria"}</span>
          </Button>
        )}

        <Button
          className="catalog-category-header__action"
          onClick={onCreateProduct}
          size="sm"
          title={`Adicionar novo produto direto em ${category.name}`}
          variant="secondary"
        >
          <Icon name="plus" size={12} />
          <span>+ Item</span>
        </Button>

        {showReorder && (
          <fieldset className="catalog-category-header__order">
            <legend className="gm-sr-only">Reordenar categoria</legend>
            <Button
              aria-label="Mover categoria para cima"
              className="catalog-card-icon-btn"
              onClick={() => onMove("up")}
              title="Mover categoria para cima"
              type="button"
            >
              <Icon name="arrow-up" size={13} />
            </Button>
            <Button
              aria-label="Mover categoria para baixo"
              className="catalog-card-icon-btn"
              onClick={() => onMove("down")}
              title="Mover categoria para baixo"
              type="button"
            >
              <Icon name="arrow-down" size={13} />
            </Button>
          </fieldset>
        )}

        <Button
          aria-label={`Configurar ${category.name}`}
          className="catalog-card-icon-btn"
          onClick={onEdit}
          title="Configurar detalhes, canais e horários da categoria"
          type="button"
        >
          <Icon name="settings" size={14} />
        </Button>
        <Button
          aria-label={`Excluir ${category.name}`}
          className="catalog-card-icon-btn catalog-card-icon-btn--danger"
          disabled={busy}
          onClick={onArchive}
          title="Excluir Categoria"
          type="button"
        >
          <Icon name="x" size={14} />
        </Button>
      </div>
    </div>
  );
}

export function CollapsedCategorySummary({
  itemCount,
  onExpand,
}: {
  itemCount: number;
  onExpand: () => void;
}) {
  return (
    <div className="catalog-category-collapsed">
      <span>{itemCount} itens recolhidos nesta categoria.</span>
      <Button onClick={onExpand} size="sm" variant="ghost">
        Expandir Itens
      </Button>
    </div>
  );
}
