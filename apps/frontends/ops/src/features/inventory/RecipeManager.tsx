import { Badge, Button, Card, EmptyState } from "@giromesa/ui";
import { type FormEvent, useState } from "react";
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
}: {
  scope: ManagementScope;
  inventory: InventoryData;
}) {
  const recipesRemote = useRemote(scope, api.management.recipes, parseRecipes);
  const catalogRemote = useRemote(scope, api.pilot.catalog, parseRecipeCatalog);
  const [productId, setProductId] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lossPercent, setLossPercent] = useState("0");
  const [components, setComponents] = useState<RecipeComponent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [success, setSuccess] = useState("");
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

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
      setAttempt(null);
      setSuccess("Nova versão ativa criada. A versão anterior foi preservada no histórico.");
      recipesRemote.retry();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível salvar a ficha técnica.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const activeItems = inventory.items.filter((item) => item.active);
  const activeLocations = inventory.locations.filter((location) => location.active);
  const itemById = new Map(inventory.items.map((item) => [item.id, item]));
  const locationById = new Map(inventory.locations.map((location) => [location.id, location]));

  return (
    <RemoteGate remote={catalogRemote}>
      {(catalog) => (
        <RemoteGate remote={recipesRemote}>
          {(recipes) => {
            const activeProducts = catalog.products.filter((product) => product.active);
            const productById = new Map(catalog.products.map((product) => [product.id, product]));
            const prerequisitesReady =
              activeProducts.length > 0 && activeItems.length > 0 && activeLocations.length > 0;
            const orderedRecipes = [...recipes].sort((a, b) =>
              (productById.get(a.productId)?.name ?? a.productId).localeCompare(
                productById.get(b.productId)?.name ?? b.productId,
                "pt-BR",
              ),
            );
            return (
              <Card className="recipe-card">
                <div className="card-header">
                  <div>
                    <p className="eyebrow">Produção e custo</p>
                    <h2>Fichas técnicas versionadas</h2>
                  </div>
                  <Badge tone="info">{recipes.length} ativa(s)</Badge>
                </div>
                <p className="recipe-card__intro">
                  Defina o consumo real de cada venda. Toda alteração cria uma nova versão, sem
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
                      <select
                        disabled={!activeProducts.length || submitting}
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
                      </select>
                    </label>
                    <fieldset
                      className="recipe-component-builder"
                      disabled={!prerequisitesReady || submitting}
                    >
                      <legend>Adicionar componente</legend>
                      <label className="compact-field">
                        Insumo
                        <select
                          onChange={(event) => setInventoryItemId(event.target.value)}
                          value={inventoryItemId}
                        >
                          <option value="">Selecione o insumo</option>
                          {activeItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.unit})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="compact-field">
                        Local de baixa
                        <select
                          onChange={(event) => setLocationId(event.target.value)}
                          value={locationId}
                        >
                          <option value="">Selecione o local</option>
                          {activeLocations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name} ({location.code})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="compact-field">
                        Quantidade por venda
                        <input
                          inputMode="decimal"
                          onChange={(event) => setQuantity(event.target.value)}
                          placeholder="Ex.: 0,250"
                          value={quantity}
                        />
                      </label>
                      <label className="compact-field">
                        Perda prevista (%)
                        <input
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
                                onClick={() =>
                                  setComponents((current) =>
                                    current.filter((candidate) => candidate !== component),
                                  )
                                }
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
                      {submitting ? "Salvando versão…" : "Salvar nova versão"}
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
