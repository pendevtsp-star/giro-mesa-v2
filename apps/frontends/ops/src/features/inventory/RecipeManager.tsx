// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Badge, Button, Card, EmptyState, Input, NativeSelect } from "@giromesa/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import {
  dateLabel,
  type InventoryData,
  type ManagementScope,
  parseRecipeCatalog,
  parseRecipes,
  type RecipeComponent,
  RemoteGate,
  recipeLossToBasisPoints,
  recipeQuantityToMilli,
  useRemote,
} from "../../management.shared";

function recipeQuantityLabel(quantityMilli: number): string {
  return (quantityMilli / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

export function RecipeManager({
  scope,
  inventory,
  initialProductId,
  onSaved,
}: {
  scope: ManagementScope;
  inventory: InventoryData;
  initialProductId?: string;
  onSaved?: () => void;
}) {
  const recipesRemote = useRemote(scope, api.management.recipes, parseRecipes);
  const catalogRemote = useRemote(scope, api.pilot.catalog, parseRecipeCatalog);
  const [productId, setProductId] = useState(initialProductId ?? "");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lossPercent, setLossPercent] = useState("0");
  const [components, setComponents] = useState<RecipeComponent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [success, setSuccess] = useState("");
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);
  const [deactivation, setDeactivation] = useState<{
    recipeId: string;
    productId: string;
    key: string;
  } | null>(null);
  const loadedProductId = useRef<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (recipesRemote.state.status !== "ready") return;
    if (loadedProductId.current === productId && dirty.current) return;
    const recipe = recipesRemote.state.data.find((candidate) => candidate.productId === productId);
    loadedProductId.current = productId;
    dirty.current = false;
    setComponents(recipe?.components.map((component) => ({ ...component })) ?? []);
    setAttempt(null);
  }, [productId, recipesRemote.state]);

  function addComponent() {
    setFeedback("");
    setSuccess("");
    try {
      if (
        !activeItems.some((item) => item.id === inventoryItemId) ||
        !activeLocations.some((location) => location.id === locationId)
      ) {
        throw new Error("Selecione um insumo e o local de baixa.");
      }
      if (
        components.some(
          (component) =>
            component.inventoryItemId === inventoryItemId && component.locationId === locationId,
        )
      ) {
        throw new Error("Este insumo já foi incluído para o local selecionado.");
      }
      setComponents((current) => [
        ...current,
        {
          inventoryItemId,
          locationId,
          quantityMilli: recipeQuantityToMilli(quantity),
          lossBasisPoints: recipeLossToBasisPoints(lossPercent),
        },
      ]);
      dirty.current = true;
      setInventoryItemId("");
      setQuantity("");
      setLossPercent("0");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível incluir o componente.",
      );
    }
  }

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    setSuccess("");
    if (!productId) {
      setFeedback("Selecione o produto vendido por esta ficha técnica.");
      return;
    }
    if (
      catalogRemote.state.status !== "ready" ||
      !catalogRemote.state.data.products.some(
        (product) => product.id === productId && product.active,
      )
    ) {
      setFeedback("O produto selecionado não está mais ativo no catálogo.");
      return;
    }
    if (!components.length) {
      setFeedback("Inclua ao menos um componente antes de salvar.");
      return;
    }
    const body = { productId, components };
    const fingerprint = JSON.stringify(body);
    const currentAttempt =
      attempt?.fingerprint === fingerprint ? attempt : { fingerprint, key: crypto.randomUUID() };
    setAttempt(currentAttempt);
    setSubmitting(true);
    try {
      await api.management.configureRecipe(
        scope.organizationId,
        scope.unitId,
        body,
        currentAttempt.key,
      );
      setComponents([]);
      dirty.current = false;
      setAttempt(null);
      setSuccess("Nova versão ativa criada. A versão anterior foi preservada no histórico.");
      recipesRemote.retry();
      onSaved?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível salvar a ficha técnica.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const activeItems = inventory.items.filter((item) => item.active && item.kind === "ingredient");
  const activeLocations = inventory.locations.filter((location) => location.active);
  const itemById = new Map(inventory.items.map((item) => [item.id, item]));
  const locationById = new Map(inventory.locations.map((location) => [location.id, location]));

  async function deactivateRecipe() {
    if (!deactivation || submitting) return;
    setSubmitting(true);
    setFeedback("");
    setSuccess("");
    try {
      await api.management.deactivateRecipe(
        scope.organizationId,
        scope.unitId,
        deactivation.productId,
        deactivation.key,
      );
      if (productId === deactivation.productId) {
        dirty.current = false;
        setComponents([]);
        setAttempt(null);
      }
      setDeactivation(null);
      setSuccess(
        "Ficha desativada. O histórico foi preservado e as próximas vendas ficam sem baixa dos insumos desta ficha.",
      );
      recipesRemote.retry();
      onSaved?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível desativar a ficha técnica.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RemoteGate remote={catalogRemote}>
      {(catalog) => (
        <RemoteGate remote={recipesRemote}>
          {(recipes) => {
            const activeProducts = catalog.products.filter((product) => product.active);
            const productById = new Map(catalog.products.map((product) => [product.id, product]));
            const prerequisitesReady =
              activeProducts.length > 0 && activeItems.length > 0 && activeLocations.length > 0;
            const orderedRecipes = recipes
              .filter((recipe) => !initialProductId || recipe.productId === initialProductId)
              .sort((a, b) =>
                (productById.get(a.productId)?.name ?? a.productId).localeCompare(
                  productById.get(b.productId)?.name ?? b.productId,
                  "pt-BR",
                ),
              );
            return (
              <Card aria-busy={submitting} className="recipe-card">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Produção e custo</p>
                    <h2>Fichas técnicas versionadas</h2>
                  </div>
                  <Badge tone="info">{recipes.length} ativa(s)</Badge>
                </div>
                <p className="recipe-card__intro">
                  Opcional: o produto pode ser vendido sem ficha técnica. Configure os insumos para
                  acompanhar o consumo real de cada venda. Toda alteração cria uma nova versão, sem
                  reescrever o histórico operacional.
                </p>
                {!prerequisitesReady && (
                  <p className="auth-message auth-message--error" role="alert">
                    {!activeProducts.length
                      ? "Cadastre ao menos um produto ativo no catálogo. "
                      : ""}
                    {!activeItems.length ? "Cadastre ao menos um insumo ativo. " : ""}
                    {!activeLocations.length ? "Cadastre ao menos um local de estoque ativo." : ""}
                  </p>
                )}
                <div className="recipe-layout">
                  <form className="recipe-form" onSubmit={saveRecipe}>
                    <label className="compact-field">
                      Produto vendido
                      <NativeSelect
                        disabled={Boolean(initialProductId) || !activeProducts.length || submitting}
                        onChange={(event) => {
                          setProductId(event.target.value);
                          setSuccess("");
                        }}
                        value={productId}
                      >
                        <option value="">Selecione o produto</option>
                        {activeProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                    <fieldset
                      className="recipe-component-builder"
                      disabled={!prerequisitesReady || submitting}
                    >
                      <legend>Adicionar componente</legend>
                      <label className="compact-field">
                        Insumo
                        <NativeSelect
                          onChange={(event) => setInventoryItemId(event.target.value)}
                          value={inventoryItemId}
                        >
                          <option value="">Selecione o insumo</option>
                          {activeItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.unit})
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                      <label className="compact-field">
                        Local de baixa
                        <NativeSelect
                          onChange={(event) => setLocationId(event.target.value)}
                          value={locationId}
                        >
                          <option value="">Selecione o local</option>
                          {activeLocations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name} ({location.code})
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                      <label className="compact-field">
                        Quantidade por venda
                        <Input
                          inputMode="decimal"
                          onChange={(event) => setQuantity(event.target.value)}
                          placeholder="Ex.: 0,250"
                          value={quantity}
                        />
                      </label>
                      <label className="compact-field">
                        Perda prevista (%)
                        <Input
                          inputMode="decimal"
                          onChange={(event) => setLossPercent(event.target.value)}
                          placeholder="Ex.: 2,50"
                          value={lossPercent}
                        />
                      </label>
                      <Button onClick={addComponent} size="sm" variant="secondary">
                        Adicionar componente
                      </Button>
                    </fieldset>
                    {components.length > 0 && (
                      <ul className="recipe-draft" aria-label="Componentes da nova versão">
                        {components.map((component) => {
                          const item = itemById.get(component.inventoryItemId);
                          const location = locationById.get(component.locationId);
                          return (
                            <li
                              className="recipe-component-row"
                              key={`${component.inventoryItemId}:${component.locationId}`}
                            >
                              <span>
                                <strong>{item?.name ?? "Insumo indisponível"}</strong>
                                <small>{location?.name ?? "Local indisponível"}</small>
                              </span>
                              <span>
                                {recipeQuantityLabel(component.quantityMilli)} {item?.unit ?? "un."}
                                {component.lossBasisPoints > 0
                                  ? ` + ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(component.lossBasisPoints / 100)}% de perda`
                                  : ""}
                              </span>
                              <Button
                                aria-label={`Remover ${item?.name ?? "componente"}`}
                                disabled={submitting}
                                onClick={() => {
                                  dirty.current = true;
                                  setComponents((current) =>
                                    current.filter((candidate) => candidate !== component),
                                  );
                                }}
                                size="sm"
                                variant="ghost"
                              >
                                Remover
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {feedback && (
                      <p className="auth-message auth-message--error" role="alert">
                        {feedback}
                      </p>
                    )}
                    {success && (
                      <p className="auth-message" role="status">
                        {success}
                      </p>
                    )}
                    <Button disabled={!prerequisitesReady || submitting} type="submit">
                      {submitting ? "Aguarde…" : "Salvar nova versão"}
                    </Button>
                  </form>
                  <section className="recipe-versions" aria-labelledby="active-recipes-title">
                    <div className="recipe-versions__header">
                      <h3 id="active-recipes-title">Versões ativas</h3>
                      <small>Apenas a configuração vigente de cada produto</small>
                    </div>
                    {orderedRecipes.length ? (
                      <div className="recipe-version-list">
                        {orderedRecipes.map((recipe) => (
                          <article className="recipe-version" key={recipe.id}>
                            <div>
                              <strong>
                                {productById.get(recipe.productId)?.name ?? "Produto indisponível"}
                              </strong>
                              <small>Vigente desde {dateLabel(recipe.validFrom)}</small>
                            </div>
                            <Badge tone="success">Versão {recipe.version}</Badge>
                            <ul>
                              {recipe.components.map((component) => {
                                const item = itemById.get(component.inventoryItemId);
                                const location = locationById.get(component.locationId);
                                return (
                                  <li key={`${component.inventoryItemId}:${component.locationId}`}>
                                    <span>
                                      {item?.name ?? "Insumo indisponível"} ·{" "}
                                      {location?.name ?? "Local indisponível"}
                                    </span>
                                    <strong>
                                      {recipeQuantityLabel(component.quantityMilli)}{" "}
                                      {item?.unit ?? "un."}
                                      {component.lossBasisPoints > 0
                                        ? ` + ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(component.lossBasisPoints / 100)}%`
                                        : ""}
                                    </strong>
                                  </li>
                                );
                              })}
                            </ul>
                            {deactivation?.recipeId === recipe.id ? (
                              <div className="gm-form-stack">
                                <p role="alert">
                                  Desativar a ficha de{" "}
                                  {productById.get(recipe.productId)?.name ?? "este produto"}? As
                                  próximas vendas ficam sem baixa automática dos insumos desta
                                  ficha. Pedidos anteriores e histórico serão preservados.
                                </p>
                                <div className="inventory-command-bar__actions">
                                  <Button
                                    disabled={submitting}
                                    onClick={deactivateRecipe}
                                    size="sm"
                                    variant="danger"
                                  >
                                    {submitting ? "Desativando…" : "Confirmar desativação"}
                                  </Button>
                                  <Button
                                    disabled={submitting}
                                    onClick={() => setDeactivation(null)}
                                    size="sm"
                                    variant="secondary"
                                  >
                                    Manter ficha
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button
                                disabled={submitting}
                                onClick={() => {
                                  setFeedback("");
                                  setSuccess("");
                                  setDeactivation({
                                    recipeId: recipe.id,
                                    productId: recipe.productId,
                                    key: crypto.randomUUID(),
                                  });
                                }}
                                size="sm"
                                variant="secondary"
                              >
                                Desativar ficha técnica
                              </Button>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        description="Selecione um produto, adicione os insumos consumidos e salve a primeira versão."
                        icon="≡"
                        title="Nenhuma ficha técnica ativa"
                      />
                    )}
                  </section>
                </div>
              </Card>
            );
          }}
        </RemoteGate>
      )}
    </RemoteGate>
  );
}
