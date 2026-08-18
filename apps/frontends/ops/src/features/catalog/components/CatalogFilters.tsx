import { Icon, SearchField } from "@giromesa/ui";
import type { ChangeEvent } from "react";
import type { CatalogProduct, PilotCatalogCategory } from "../../../operations.shared";

export type CatalogStatusFilter = "active" | "all" | "inactive";
export type CatalogViewMode = "grid" | "list" | "table";

type CatalogFiltersProps = {
  categories: PilotCatalogCategory[];
  dietFilter: string;
  products: CatalogProduct[];
  production: boolean;
  search: string;
  selectedCategoryId: string;
  status: CatalogStatusFilter;
  viewMode: CatalogViewMode;
  onCategoryChange: (categoryId: string) => void;
  onDietFilterChange: (filter: string) => void;
  onSearchChange: (value: string) => void;
  onStatusChange: (status: CatalogStatusFilter) => void;
  onViewModeChange: (viewMode: CatalogViewMode) => void;
};

const DIET_FILTERS = [
  { id: "all", label: "Todos os Itens" },
  { id: "gluten_free", label: "Sem Glúten" },
  { id: "lactose_free", label: "Sem Lactose" },
  { id: "vegan", label: "Vegano / Vegetariano" },
  { id: "seafood_free", label: "Sem Frutos do Mar" },
];

const VIEW_MODES: Array<{
  icon: "finance" | "grid" | "list";
  label: string;
  value: CatalogViewMode;
}> = [
  { icon: "list", label: "Visualização em lista", value: "list" },
  { icon: "grid", label: "Visualização em grade de fotos", value: "grid" },
  { icon: "finance", label: "Tabela com edição rápida de preços", value: "table" },
];

export function CatalogFilters({
  categories,
  dietFilter,
  products,
  search,
  selectedCategoryId,
  status,
  viewMode,
  onCategoryChange,
  onDietFilterChange,
  onSearchChange,
  onStatusChange,
  onViewModeChange,
}: CatalogFiltersProps) {
  return (
    <section className="catalog-filters" aria-label="Filtros e visualização do cardápio">
      <div className="catalog-filters__main">
        <div className="catalog-category-tabs" role="tablist" aria-label="Categorias">
          <CategoryTab
            active={selectedCategoryId === "all"}
            count={products.length}
            label="Todas"
            onClick={() => onCategoryChange("all")}
          />
          {categories.map((category) => (
            <CategoryTab
              active={selectedCategoryId === category.id}
              count={products.filter((product) => product.categoryId === category.id).length}
              key={category.id}
              label={category.name}
              onClick={() => onCategoryChange(category.id)}
            />
          ))}
        </div>

        <div className="catalog-filters__controls">
          <fieldset className="catalog-view-switcher">
            <legend className="catalog-visually-hidden">Visualização</legend>
            {VIEW_MODES.map((mode) => (
              <button
                aria-label={mode.label}
                aria-pressed={viewMode === mode.value}
                className="catalog-view-switcher__button"
                data-active={viewMode === mode.value}
                key={mode.value}
                onClick={() => onViewModeChange(mode.value)}
                title={mode.label}
                type="button"
              >
                <Icon name={mode.icon} size={16} />
              </button>
            ))}
          </fieldset>

          <select
            aria-label="Status dos produtos"
            className="catalog-filters__status"
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              onStatusChange(event.target.value as CatalogStatusFilter)
            }
            value={status}
          >
            <option value="active">Apenas Ativos</option>
            <option value="inactive">Apenas Inativos</option>
            <option value="all">Todos os Status</option>
          </select>

          <SearchField
            className="catalog-filters__search"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar produtos..."
            value={search}
          />
        </div>
      </div>

      <div className="catalog-diet-filters">
        <span className="catalog-diet-filters__label">Filtro de Dieta & Segurança:</span>
        {DIET_FILTERS.map((diet) => {
          const active = dietFilter === diet.id;
          return (
            <button
              aria-pressed={active}
              className="catalog-diet-filters__chip"
              data-active={active}
              key={diet.id}
              onClick={() => onDietFilterChange(diet.id)}
              type="button"
            >
              {active && <Icon name="check" size={11} />}
              <span>{diet.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CategoryTab({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className="catalog-category-tabs__tab"
      data-active={active}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <span>{label}</span>
      <span className="catalog-category-tabs__count">{count}</span>
    </button>
  );
}
