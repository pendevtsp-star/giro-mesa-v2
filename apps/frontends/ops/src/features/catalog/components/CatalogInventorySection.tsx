import { useState } from "react";
import { api } from "../../../api";
import { parseInventory, RemoteGate, useRemote } from "../../../management.shared";
import type { CatalogProduct, PilotScope } from "../../../operations.shared";
import { routeHref } from "../../../router";
import { formatMoney } from "../../../rules";
import { RecipeManager } from "../../inventory/RecipeManager";

export function CatalogInventorySection({
  product,
  scope,
  onSaved,
}: {
  product: CatalogProduct;
  scope: PilotScope;
  onSaved?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const inventory = product.inventory;
  const cost = inventory?.estimatedCostCents;
  const quantity = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  return (
    <details
      className="gm-disclosure catalog-sub-accordion min-h-min"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Estoque e ficha técnica · opcional</summary>
      <div className="gm-disclosure__content catalog-sub-accordion__content">
        {inventory?.inventoryItemId ? (
          <p>
            Vinculado a <strong>{inventory.itemName}</strong> · 1 {inventory.stockUnit} por venda.
            {inventory.physicalQuantity != null && (
              <>
                {" "}
                Saldo físico: {quantity(inventory.physicalQuantity)} {inventory.stockUnit}.
              </>
            )}
            {inventory.availableQuantity != null && (
              <>
                {" "}
                Disponível após reservas e bloqueios: {quantity(inventory.availableQuantity)}{" "}
                {inventory.stockUnit}.
              </>
            )}
          </p>
        ) : product.productType === "resale" ? (
          <p>
            Sem vínculo de baixa física. No Estoque, edite o item de revenda e selecione este
            produto.
          </p>
        ) : (
          <p>
            {inventory?.recipeVersion
              ? `Ficha ativa: versão ${inventory.recipeVersion}, com ${inventory.componentCount} insumo(s).`
              : "Sem ficha técnica: o produto continua disponível para venda, sem baixa automática de insumos."}
          </p>
        )}
        {cost != null ? (
          <p>
            {inventory?.costSource === "recipe"
              ? "Custo estimado da ficha"
              : "Custo médio do estoque"}
            : <strong>{formatMoney(cost)}</strong>. Margem bruta estimada: Salão{" "}
            {formatMoney(product.priceCents - cost)} · Delivery{" "}
            {formatMoney((product.deliveryPriceCents ?? product.priceCents) - cost)}. Antes de taxas
            e demais despesas. Os preços de venda não são alterados automaticamente.
          </p>
        ) : (
          <p className="catalog-price-note">
            Custo do estoque ainda não disponível. Registre custos nas entradas para calcular a
            margem estimada.
          </p>
        )}
        <a href={routeHref("inventory")}>Abrir estoque e locais</a>
        {product.recipe.length > 0 && (
          <details className="gm-disclosure">
            <summary>Composição anterior · somente referência</summary>
            <p>
              Este cadastro antigo não controla a baixa física. Vincule os insumos na ficha abaixo
              se desejar usar esse controle.
            </p>
            <ul>
              {product.recipe.map((component, index) => (
                <li key={component.componentId ?? `${component.name}-${index}`}>
                  {component.name} · {component.quantity} {component.unit}
                </li>
              ))}
            </ul>
          </details>
        )}
        {expanded && product.productType !== "resale" && (
          <CatalogRecipeEditor
            key={product.id}
            productId={product.id}
            scope={scope}
            onSaved={onSaved}
          />
        )}
      </div>
    </details>
  );
}

function CatalogRecipeEditor({
  productId,
  scope,
  onSaved,
}: {
  productId: string;
  scope: PilotScope;
  onSaved?: () => void;
}) {
  const remote = useRemote(scope, api.management.inventory, parseInventory);
  return (
    <RemoteGate remote={remote}>
      {(inventory) => (
        <RecipeManager
          initialProductId={productId}
          inventory={inventory}
          scope={scope}
          onSaved={onSaved}
        />
      )}
    </RemoteGate>
  );
}
