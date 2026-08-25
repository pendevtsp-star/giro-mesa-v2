import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Icon,
  type IconName,
  Input,
  Label,
} from "@giromesa/ui";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import {
  type CatalogProduct,
  type PilotCatalog,
  type PilotCatalogCategory,
  priceToCents,
} from "../../../operations.shared";
import { formatMoney } from "../../../rules";
import { normalizeCatalogStationIds } from "../catalog.stations";
import { CatalogCategoryHeader, CollapsedCategorySummary } from "./CatalogCategoryHeader";

type CatalogProductsPanelProps = {
  archiveCategory: (categoryId: string) => Promise<void> | void;
  archiveProduct: (productId: string) => Promise<void> | void;
  busy: string;
  catalog: PilotCatalog;
  catalogLanguage: "en" | "es" | "pt";
  collapsedCategories: Record<string, boolean>;
  duplicateProduct: (product: CatalogProduct) => void;
  filterStatus: "active" | "all" | "inactive";
  moveCategory: (categoryId: string, direction: "down" | "up") => void;
  moveProduct: (productId: string, direction: "down" | "up") => void;
  openEditCategory: (category: PilotCatalogCategory) => void;
  openNewProductForCategory: (categoryId: string) => void;
  production: boolean;
  quickStockOut: (productId: string) => void;
  restoreDailyStock: (productId: string) => void;
  searchTerm: string;
  selectedAllergenFilter: string;
  selectedTabCategoryId: string;
  setCustomizerSelections: Dispatch<SetStateAction<Record<string, string[]>>>;
  setEditingProduct: Dispatch<SetStateAction<CatalogProduct | null>>;
  setEditingProductDeliveryPrice: Dispatch<SetStateAction<string>>;
  setEditingProductPrice: Dispatch<SetStateAction<string>>;
  setEditingProductReason: Dispatch<SetStateAction<string>>;
  setModifierCustomizerProduct: Dispatch<SetStateAction<CatalogProduct | null>>;
  toggleAvailability: (product: CatalogProduct) => Promise<void> | void;
  toggleCategoryAvailability: (categoryId: string) => Promise<void> | void;
  toggleCategoryCollapse: (categoryId: string) => void;
  updateProductInlineDeliveryPrice: (productId: string, priceCents: number) => void;
  updateProductInlinePrice: (productId: string, priceCents: number) => void;
  viewMode: "grid" | "list" | "table";
};

type ProductCallbacks = Pick<
  CatalogProductsPanelProps,
  | "archiveProduct"
  | "busy"
  | "duplicateProduct"
  | "moveProduct"
  | "production"
  | "quickStockOut"
  | "restoreDailyStock"
  | "toggleAvailability"
> & {
  onEdit: (product: CatalogProduct) => void;
};

const TAGS: Record<string, { icon: IconName; label: string; tone: string }> = {
  bestseller: { icon: "alerts", label: "Mais Vendido", tone: "warning" },
  chef_special: { icon: "check", label: "Chef", tone: "purple" },
  new: { icon: "plus", label: "Novidade", tone: "info" },
  promo: { icon: "finance", label: "Promoção", tone: "pink" },
};

const DIET_LABELS: Record<string, string> = {
  gluten_free: "Sem Glúten",
  lactose_free: "Sem Lactose",
  vegan: "Vegano",
  vegetarian: "Vegetariano",
};

export function CatalogProductsPanel(props: CatalogProductsPanelProps) {
  const {
    archiveCategory,
    busy,
    catalog,
    collapsedCategories,
    filterStatus,
    moveCategory,
    openEditCategory,
    openNewProductForCategory,
    searchTerm,
    selectedAllergenFilter,
    selectedTabCategoryId,
    toggleCategoryAvailability,
    toggleCategoryCollapse,
  } = props;

  if (catalog.products.length === 0) {
    return (
      <EmptyState
        description="Crie uma categoria, uma estação de produção e depois o produto."
        icon={<Icon name="catalog" size={28} />}
        title="Catálogo pronto para o primeiro produto"
      />
    );
  }

  return (
    <div className="ops-grid ops-grid--catalog">
      {catalog.categories
        .filter(
          (category) => selectedTabCategoryId === "all" || category.id === selectedTabCategoryId,
        )
        .map((category) => {
          const items = catalog.products.filter((product) =>
            matchesProduct(product, category.id, filterStatus, searchTerm, selectedAllergenFilter),
          );

          if (items.length === 0 && (searchTerm !== "" || selectedAllergenFilter !== "all")) {
            return null;
          }

          return (
            <section className="catalog-products-category" key={category.id}>
              <CatalogCategoryHeader
                busy={busy === "archive-category"}
                category={category}
                collapsed={Boolean(collapsedCategories[category.id])}
                items={items}
                onArchive={() => void archiveCategory(category.id)}
                onCreateProduct={() => openNewProductForCategory(category.id)}
                onEdit={() => openEditCategory(category)}
                onMove={(direction) => moveCategory(category.id, direction)}
                onToggleAvailability={() => void toggleCategoryAvailability(category.id)}
                onToggleCollapsed={() => toggleCategoryCollapse(category.id)}
                showReorder
              />

              {collapsedCategories[category.id] ? (
                <CollapsedCategorySummary
                  itemCount={items.length}
                  onExpand={() => toggleCategoryCollapse(category.id)}
                />
              ) : items.length === 0 ? (
                <div className="catalog-products-empty">
                  Nenhum produto cadastrado nesta categoria.
                </div>
              ) : (
                <ProductView items={items} props={props} />
              )}
            </section>
          );
        })}
    </div>
  );
}

function ProductView({
  items,
  props,
}: {
  items: CatalogProduct[];
  props: CatalogProductsPanelProps;
}) {
  const onEdit = (product: CatalogProduct) => {
    props.setEditingProduct({ ...product, description: product.description || "" });
    props.setEditingProductPrice((product.priceCents / 100).toFixed(2).replace(".", ","));
    props.setEditingProductDeliveryPrice(
      product.deliveryPriceCents
        ? (product.deliveryPriceCents / 100).toFixed(2).replace(".", ",")
        : "",
    );
    props.setEditingProductReason("");
  };

  const callbacks: ProductCallbacks = { ...props, onEdit };

  if (props.viewMode === "table") {
    return (
      <ProductTable
        callbacks={callbacks}
        catalogLanguage={props.catalogLanguage}
        items={items}
        onUpdateDeliveryPrice={props.updateProductInlineDeliveryPrice}
        onUpdatePrice={props.updateProductInlinePrice}
      />
    );
  }

  if (props.viewMode === "grid") {
    return (
      <ProductGrid callbacks={callbacks} catalogLanguage={props.catalogLanguage} items={items} />
    );
  }

  return (
    <ProductList
      callbacks={callbacks}
      catalog={props.catalog}
      items={items}
      onCustomize={(product) => {
        props.setModifierCustomizerProduct(product);
        props.setCustomizerSelections({});
      }}
    />
  );
}

function ProductTable({
  callbacks,
  catalogLanguage,
  items,
  onUpdateDeliveryPrice,
  onUpdatePrice,
}: {
  callbacks: ProductCallbacks;
  catalogLanguage: CatalogProductsPanelProps["catalogLanguage"];
  items: CatalogProduct[];
  onUpdateDeliveryPrice: (productId: string, priceCents: number) => void;
  onUpdatePrice: (productId: string, priceCents: number) => void;
}) {
  return (
    <div className="catalog-products-table-shell">
      <DataTable caption="Produtos do cardápio" className="catalog-products-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Item / Prato</th>
            <th>Preço Salão (R$)</th>
            <th>Preço Delivery (R$)</th>
            <th>CMV %</th>
            <th>Margem</th>
            <th className="catalog-products-table__actions-heading">Ações Rápidas</th>
          </tr>
        </thead>
        <tbody>
          {items.map((product) => {
            const cost = product.costCents || 0;
            const cmv = product.priceCents > 0 ? Math.round((cost / product.priceCents) * 100) : 0;
            const margin = product.priceCents - cost;

            return (
              <tr data-available={product.available} key={product.id}>
                <td>
                  <Button
                    className="catalog-products-table__status"
                    data-available={product.available}
                    onClick={() => void callbacks.toggleAvailability(product)}
                    title="Clique para pausar ou ativar"
                    type="button"
                  >
                    {product.available ? "Ativo" : "Pausado"}
                  </Button>
                </td>
                <td>
                  <div className="catalog-products-table__identity">
                    {product.imageUrl && <img alt={product.name} src={product.imageUrl} />}
                    <div>
                      <strong>{translatedName(product, catalogLanguage)}</strong>
                      <div className="gm-observability-row">
                        {product.ncm && <span>NCM {product.ncm}</span>}
                        {!!product.modifierGroupIds?.length && (
                          <span className="gm-pill" data-tone="positive">
                            {product.modifierGroupIds.length} opcionais
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <QuickPriceInput
                    defaultValue={product.priceCents}
                    onCommit={(priceCents) =>
                      priceCents > 0 && onUpdatePrice(product.id, priceCents)
                    }
                    title="Edição rápida: digite e clique fora para salvar"
                  />
                </td>
                <td>
                  <QuickPriceInput
                    defaultValue={product.deliveryPriceCents}
                    onCommit={(priceCents) => onUpdateDeliveryPrice(product.id, priceCents)}
                    placeholder="—"
                    title="Preço Delivery: digite e clique fora para salvar"
                  />
                </td>
                <td>
                  <strong className="catalog-products-table__cmv" data-tone={cmvTone(cmv)}>
                    {cmv > 0 ? `${cmv}%` : "—"}
                  </strong>
                </td>
                <td>
                  <strong>{margin > 0 ? formatMoney(margin) : "—"}</strong>
                </td>
                <td>
                  <ProductIconActions callbacks={callbacks} product={product} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </div>
  );
}

function QuickPriceInput({
  defaultValue,
  onCommit,
  placeholder,
  title,
}: {
  defaultValue?: number | null;
  onCommit: (priceCents: number) => void;
  placeholder?: string;
  title: string;
}) {
  const confirmedValue =
    defaultValue == null ? "" : (defaultValue / 100).toFixed(2).replace(".", ",");
  const [value, setValue] = useState(confirmedValue);

  useEffect(() => setValue(confirmedValue), [confirmedValue]);

  return (
    <Label className="catalog-quick-price">
      <span>R$</span>
      <Input
        onBlur={() => {
          onCommit(priceToCents(value));
          setValue(confirmedValue);
        }}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        title={title}
        type="text"
        value={value}
      />
    </Label>
  );
}

function ProductList({
  callbacks,
  catalog,
  items,
  onCustomize,
}: {
  callbacks: ProductCallbacks;
  catalog: PilotCatalog;
  items: CatalogProduct[];
  onCustomize: (product: CatalogProduct) => void;
}) {
  return (
    <div className="catalog-product-list">
      {items.map((product) => (
        <Card
          className={`catalog-product-card ${!product.available ? "catalog-product-card--unavailable" : ""}`}
          key={product.id}
        >
          <div className="catalog-product-card__header">
            <div className="catalog-product-card__main">
              {product.imageUrl && (
                <img
                  alt={product.name}
                  className="catalog-product-card__thumbnail"
                  src={product.imageUrl}
                />
              )}
              <div className="catalog-product-card__info">
                <ProductMetadata catalog={catalog} onCustomize={onCustomize} product={product} />
                <h3 className="catalog-product-card__title">{product.name}</h3>
                <p className="catalog-product-card__desc">
                  {product.description ?? "Sem descrição"}
                </p>
              </div>
            </div>
            <div className="catalog-product-card__price">
              <strong>{formatMoney(product.priceCents)}</strong>
              {product.deliveryPriceCents != null && (
                <small>Delivery: {formatMoney(product.deliveryPriceCents)}</small>
              )}
            </div>
          </div>
          <div className="catalog-product-card__actions">
            <ProductOperationalActions callbacks={callbacks} product={product} />
            <ProductIconActions callbacks={callbacks} product={product} showMove />
          </div>
        </Card>
      ))}
    </div>
  );
}

function ProductGrid({
  callbacks,
  catalogLanguage,
  items,
}: {
  callbacks: ProductCallbacks;
  catalogLanguage: CatalogProductsPanelProps["catalogLanguage"];
  items: CatalogProduct[];
}) {
  return (
    <div className="catalog-product-grid">
      {items.map((product) => (
        <Card
          className="catalog-product-grid__card"
          data-available={product.available}
          key={product.id}
        >
          <div>
            {product.imageUrl ? (
              <div className="catalog-product-grid__media">
                <img alt={product.name} src={product.imageUrl} />
                {!!product.tags?.length && (
                  <div className="catalog-product-grid__tags">
                    {product.tags.map((tag) => (
                      <span key={tag}>{TAGS[tag]?.label ?? tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="catalog-product-grid__placeholder">
                <Icon name="catalog" size={32} />
              </div>
            )}
            <div className="catalog-product-grid__content">
              <div className="catalog-product-grid__heading">
                <h3>{translatedName(product, catalogLanguage)}</h3>
                <strong>{formatMoney(product.priceCents)}</strong>
              </div>
              {translatedDescription(product, catalogLanguage) && (
                <p>{translatedDescription(product, catalogLanguage)}</p>
              )}
              <div className="gm-observability-row">
                {product.productType === "resale" && (
                  <span className="gm-pill" data-tone="info">
                    Revenda
                  </span>
                )}
                {product.estimatedPrepTimeMinutes != null && (
                  <span className="gm-pill">
                    <Icon name="clock" size={11} /> {product.estimatedPrepTimeMinutes}m
                  </span>
                )}
                {product.costCents != null && product.priceCents > 0 && (
                  <span className="gm-pill" data-tone="positive">
                    Margem {marginPercent(product)}%
                  </span>
                )}
                {product.deliveryPriceCents != null && (
                  <span className="gm-pill">Deliv: {formatMoney(product.deliveryPriceCents)}</span>
                )}
              </div>
            </div>
          </div>
          <div className="catalog-product-grid__actions">
            <ProductOperationalActions callbacks={callbacks} product={product} compact />
            <ProductIconActions callbacks={callbacks} product={product} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function ProductMetadata({
  catalog,
  onCustomize,
  product,
}: {
  catalog: PilotCatalog;
  onCustomize: (product: CatalogProduct) => void;
  product: CatalogProduct;
}) {
  const promotion = catalog.promotions?.find(
    (candidate) =>
      candidate.active &&
      (candidate.categoryIds?.includes(product.categoryId) ||
        candidate.productIds?.includes(product.id)),
  );
  const promotionPrice = promotion ? discountedPrice(product.priceCents, promotion) : null;
  const margin = marginPercent(product);

  return (
    <div className="gm-observability-row catalog-product-metadata">
      {promotionPrice != null && (
        <span
          className="gm-pill"
          data-tone="warning"
          title={`Happy Hour "${promotion?.name}" ativo!`}
        >
          <Icon name="finance" size={11} /> Happy Hour: {formatMoney(promotionPrice)}
        </span>
      )}
      {!!product.sizes?.length && <span className="gm-pill">{product.sizes.length} tamanhos</span>}
      {product.spiciness && product.spiciness !== "none" && (
        <span className="gm-pill" data-tone="danger">
          {spicinessLabel(product.spiciness)}
        </span>
      )}
      {product.dietaryTags?.map((tag) => (
        <span className="gm-pill" data-tone="positive" key={tag}>
          {DIET_LABELS[tag] ?? tag}
        </span>
      ))}
      {!!product.modifierGroupIds?.length && (
        <Button
          className="gm-pill gm-pill--button"
          data-tone="positive"
          onClick={() => onCustomize(product)}
          title="Ver e simular opcionais disponíveis para este prato"
          type="button"
        >
          <Icon name="list" size={11} /> {product.modifierGroupIds.length} opcionais
        </Button>
      )}
      {product.tags?.map((tag) => {
        const definition = TAGS[tag];
        return definition ? (
          <span className="gm-pill" data-tone={definition.tone} key={tag}>
            <Icon name={definition.icon} size={11} /> {definition.label}
          </span>
        ) : null;
      })}
      {product.productType === "resale" && (
        <span className="gm-pill" data-tone="info">
          <Icon name="catalog" size={12} /> Revenda
          {product.currentStockUnits != null ? ` (${product.currentStockUnits} un em estoque)` : ""}
        </span>
      )}
      {product.eanBarcode && <span className="gm-pill">EAN: {product.eanBarcode}</span>}
      {product.availabilitySchedule?.windows[0] && (
        <span className="gm-pill" data-tone="purple">
          <Icon name="clock" size={12} /> {product.availabilitySchedule.windows[0].start} -{" "}
          {product.availabilitySchedule.windows[0].end}
        </span>
      )}
      {product.dailyStockRemaining != null && (
        <span
          className="gm-pill"
          data-tone={product.dailyStockRemaining === 0 ? "danger" : "warning"}
        >
          <Icon name="alerts" size={12} />
          {product.dailyStockRemaining === 0
            ? "Esgotado por hoje"
            : `Restam ${product.dailyStockRemaining} un`}
        </span>
      )}
      {product.estimatedPrepTimeMinutes != null && (
        <span className="gm-pill">
          <Icon name="clock" size={12} /> {product.estimatedPrepTimeMinutes} min
        </span>
      )}
      {product.costCents != null && product.priceCents > 0 && (
        <span
          className="gm-pill"
          data-tone={margin >= 60 ? "positive" : "warning"}
          title={`Custo: ${formatMoney(product.costCents)}`}
        >
          <Icon name="finance" size={12} /> Margem {margin}%
        </span>
      )}
      {!!product.suggestedProductIds?.length && (
        <span className="gm-pill" data-tone="info">
          <Icon name="catalog" size={12} /> {product.suggestedProductIds.length} Sugestão(ões)
        </span>
      )}
      {normalizeCatalogStationIds(product.stationIds ?? []).map((stationId) => {
        const stationName =
          catalog.stations.find((station) => station.id === stationId)?.name ?? "não identificada";
        return (
          <span className="gm-pill" key={stationId}>
            <Icon name="salon" size={12} /> Estação: {stationName}
          </span>
        );
      })}
      {!!product.allergenIds?.length && (
        <span className="gm-pill" data-tone="danger">
          <Icon name="alert-circle" size={12} /> {product.allergenIds.length} Alergênico(s)
        </span>
      )}
    </div>
  );
}

function ProductOperationalActions({
  callbacks,
  compact = false,
  product,
}: {
  callbacks: ProductCallbacks;
  compact?: boolean;
  product: CatalogProduct;
}) {
  return (
    <div className="catalog-product-card__actions-left">
      <Button
        className={`catalog-card-btn ${product.available ? "catalog-card-btn--pause" : "catalog-card-btn--active"}`}
        disabled={callbacks.busy === `toggle-${product.id}`}
        onClick={() => void callbacks.toggleAvailability(product)}
        title={product.available ? "Pausar vendas deste item" : "Ativar vendas deste item"}
        type="button"
      >
        <Icon name={product.available ? "minus" : "check"} size={13} />
        <span>{product.available ? "Pausar" : "Ativar"}</span>
      </Button>
      {!compact &&
        (product.dailyStockRemaining === 0 ? (
          <Button
            className="catalog-card-btn catalog-card-btn--active"
            onClick={() => callbacks.restoreDailyStock(product.id)}
            type="button"
          >
            <Icon name="plus" size={13} /> <span>Reabastecer</span>
          </Button>
        ) : (
          <Button
            className="catalog-card-btn catalog-card-btn--stockout"
            onClick={() => callbacks.quickStockOut(product.id)}
            type="button"
          >
            <Icon name="alerts" size={13} /> <span>Esgotar Hoje</span>
          </Button>
        ))}
    </div>
  );
}

function ProductIconActions({
  callbacks,
  product,
  showMove = false,
}: {
  callbacks: ProductCallbacks;
  product: CatalogProduct;
  showMove?: boolean;
}) {
  return (
    <div className="catalog-product-card__actions-right">
      {showMove && (
        <>
          <IconButton
            label="Mover produto para cima"
            name="arrow-up"
            onClick={() => callbacks.moveProduct(product.id, "up")}
          />
          <IconButton
            label="Mover produto para baixo"
            name="arrow-down"
            onClick={() => callbacks.moveProduct(product.id, "down")}
          />
        </>
      )}
      <IconButton
        label="Duplicar Produto"
        name="copy"
        onClick={() => callbacks.duplicateProduct(product)}
      />
      <IconButton
        label="Editar Produto & Histórico"
        name="settings"
        onClick={() => callbacks.onEdit(product)}
      />
      <IconButton
        danger
        disabled={callbacks.busy === `archive-product-${product.id}`}
        label="Inativar Produto"
        name="x"
        onClick={() => void callbacks.archiveProduct(product.id)}
      />
    </div>
  );
}

function IconButton({
  danger = false,
  disabled = false,
  label,
  name,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  name: IconName;
  onClick: () => void;
}) {
  return (
    <Button
      className={`catalog-card-icon-btn ${danger ? "catalog-card-icon-btn--danger" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={name} size={14} />
    </Button>
  );
}

function matchesProduct(
  product: CatalogProduct,
  categoryId: string,
  status: CatalogProductsPanelProps["filterStatus"],
  searchTerm: string,
  dietFilter: string,
) {
  if (product.categoryId !== categoryId) return false;
  if (status === "active" && !product.active) return false;
  if (status === "inactive" && product.active) return false;
  if (
    searchTerm &&
    !product.name.toLowerCase().includes(searchTerm) &&
    !product.description?.toLowerCase().includes(searchTerm)
  ) {
    return false;
  }

  const allergens = product.allergenIds?.map((allergen) => allergen.toLowerCase()) ?? [];
  const blockedTerms: Record<string, string[]> = {
    gluten_free: ["glúten", "gluten", "trigo"],
    lactose_free: ["leite", "lactose", "derivados"],
    seafood_free: ["camarão", "peixe", "crustáceos", "frutos do mar"],
    vegan: ["leite", "ovo", "carne", "peixe"],
  };
  return !(blockedTerms[dietFilter] ?? []).some((term) =>
    allergens.some((allergen) => allergen.includes(term)),
  );
}

function translatedName(product: CatalogProduct, language: "en" | "es" | "pt") {
  if (language === "en") return product.translations?.en?.name || product.name;
  if (language === "es") return product.translations?.es?.name || product.name;
  return product.name;
}

function translatedDescription(product: CatalogProduct, language: "en" | "es" | "pt") {
  if (language === "en") return product.translations?.en?.description || product.description;
  if (language === "es") return product.translations?.es?.description || product.description;
  return product.description;
}

function discountedPrice(
  priceCents: number,
  promotion: NonNullable<PilotCatalog["promotions"]>[number],
) {
  if (promotion.discountType === "percentage") {
    return Math.round(priceCents * (1 - promotion.discountValue / 100));
  }
  if (promotion.discountType === "fixed_price") return promotion.discountValue;
  return Math.max(0, priceCents - promotion.discountValue);
}

function marginPercent(product: CatalogProduct) {
  if (product.costCents == null || product.priceCents <= 0) return 0;
  return Math.round(((product.priceCents - product.costCents) / product.priceCents) * 100);
}

function cmvTone(cmv: number) {
  if (cmv > 40) return "danger";
  if (cmv > 32) return "warning";
  return "positive";
}

function spicinessLabel(spiciness: NonNullable<CatalogProduct["spiciness"]>) {
  if (spiciness === "mild") return "Picância Suave";
  if (spiciness === "medium") return "Picante";
  return "Muito Picante";
}
