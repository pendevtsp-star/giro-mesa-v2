import { Button, Input, Label, NativeSelect } from "@giromesa/ui";
import { useState } from "react";
import { api } from "../../../api";
import { type InventoryItem, parseInventory, useRemote } from "../../../management.shared";
import type { PilotScope } from "../../../operations.shared";

export function CatalogInventoryPicker({
  scope,
  value,
  onChange,
}: {
  scope: PilotScope;
  value: string;
  onChange: (item: InventoryItem | null) => void;
}) {
  const inventory = useRemote(scope, api.management.inventory, parseInventory);
  const [search, setSearch] = useState("");
  const items = inventory.state.status === "ready" ? inventory.state.data.items : [];
  const selected = items.find((item) => item.id === value);
  const query = search.trim().toLocaleLowerCase("pt-BR");
  const matches = items.filter(
    (item) =>
      item.active &&
      item.kind === "resale" &&
      item.unit.toLowerCase() === "un" &&
      (item.id === value ||
        [item.name, item.sku, item.barcode].some((text) =>
          text?.toLocaleLowerCase("pt-BR").includes(query),
        )),
  );
  const quantity =
    inventory.state.status === "ready" && selected
      ? inventory.state.data.balances
          .filter((balance) => balance.inventoryItemId === selected.id)
          .reduce((total, balance) => total + balance.quantity, 0)
      : 0;

  return (
    <fieldset className="action-form__wide gm-form-stack min-w-0">
      <legend>Vínculo com o estoque</legend>
      <p className="catalog-text-muted">
        Use uma bebida já cadastrada. Cada venda baixa 1 un do item selecionado.
      </p>
      {inventory.state.status === "loading" && <p role="status">Carregando estoque…</p>}
      {inventory.state.status === "error" && (
        <div role="alert">
          <p>{inventory.state.message}</p>
          <Button type="button" variant="secondary" onClick={inventory.retry}>
            Tentar novamente
          </Button>
        </div>
      )}
      {inventory.state.status === "ready" && (
        <>
          <div className="gm-form-grid gm-form-grid--split">
            <Label className="gm-field items-stretch">
              Buscar no estoque
              <Input
                type="search"
                placeholder="Nome, código interno ou código de barras"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Label>
            <Label className="gm-field items-stretch">
              Item de estoque
              <NativeSelect
                value={value}
                onChange={(event) =>
                  onChange(items.find((item) => item.id === event.target.value) ?? null)
                }
              >
                <option value="">Vincular depois</option>
                {matches.map((item) => (
                  <option key={item.id} value={item.id} disabled={Boolean(item.productId)}>
                    {item.name}
                    {item.sku ? ` · ${item.sku}` : ""}
                    {item.productId ? " · Já vinculado ao cardápio" : ""}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          </div>
          {selected ? (
            <p role="status">
              Saldo físico: {quantity.toLocaleString("pt-BR")} un · Compra:{" "}
              {selected.purchaseToStockFactor.toLocaleString("pt-BR")} un por{" "}
              {selected.purchaseUnit || "unidade comprada"}. Para bebidas retornáveis, configure a
              embalagem em Editar Produto &amp; Histórico após salvar.
            </p>
          ) : (
            <p>
              Sem vínculo, as vendas deste produto não baixam um item de revenda do estoque.{" "}
              <a href="#/inventory">Cadastre a bebida em Estoque</a> como Produto de revenda, com
              unidade de estoque un. Depois, selecione-a aqui.
            </p>
          )}
          {matches.length === 0 && (
            <p role="status">Nenhum item de revenda em unidades encontrado.</p>
          )}
        </>
      )}
    </fieldset>
  );
}
