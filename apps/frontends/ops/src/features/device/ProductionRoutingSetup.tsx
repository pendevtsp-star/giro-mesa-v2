import { Badge, Button, Callout, Card, NativeSelect } from "@giromesa/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ProductionPrintingStation } from "../../api";
import { type CatalogProduct, type PilotCatalog, parsePilotCatalog } from "../../operations.shared";

type RoutingState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; catalog: PilotCatalog };

export function productConfigForStation(product: CatalogProduct, stationId: string) {
  return {
    priceCents: product.priceCents,
    deliveryPriceCents: product.deliveryPriceCents ?? null,
    costCents: product.costCents ?? null,
    available: product.available,
    stationIds: [stationId],
    stationRouting: [{ stationId, stage: 1 }],
    availabilitySchedule: product.availabilitySchedule ?? null,
    dailyStock: product.dailyStockLimit ?? null,
    autoDeductStock: product.autoDeductStock ?? false,
  };
}

export function shouldApplyCategoryDestination(product: CatalogProduct, stationId: string) {
  return (
    product.stationIds.length <= 1 &&
    (product.stationIds.length !== 1 || product.stationIds[0] !== stationId)
  );
}

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível carregar a distribuição do cardápio.";
}

export function ProductionRoutingSetup({
  canManage,
  onReadinessChange,
  organizationId,
  stations,
  unitId,
}: {
  canManage: boolean;
  onReadinessChange: (ready: boolean) => void;
  organizationId: string;
  stations: ProductionPrintingStation[];
  unitId: string;
}) {
  const [remote, setRemote] = useState<RoutingState>({ status: "loading" });
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<
    { tone: "success" | "danger"; message: string } | undefined
  >();

  const load = useCallback(async () => {
    setRemote({ status: "loading" });
    try {
      const catalog = parsePilotCatalog(await api.pilot.catalog(organizationId, unitId));
      setRemote({ status: "ready", catalog });
      setDestinations(
        Object.fromEntries(
          catalog.categories.map((category) => [category.id, category.defaultStationId ?? ""]),
        ),
      );
    } catch (error) {
      setRemote({ status: "error", message: message(error) });
    }
  }, [organizationId, unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeProducts = useMemo(
    () =>
      remote.status === "ready" ? remote.catalog.products.filter((product) => product.active) : [],
    [remote],
  );
  const missingProducts = activeProducts.filter((product) => product.stationIds.length === 0);
  const routingReady = activeProducts.length > 0 && missingProducts.length === 0;

  useEffect(() => {
    onReadinessChange(routingReady);
  }, [onReadinessChange, routingReady]);

  const changes = useMemo(() => {
    if (remote.status !== "ready") return { categories: 0, products: 0, exceptions: 0 };
    const categories = remote.catalog.categories.filter(
      (category) => (destinations[category.id] || null) !== (category.defaultStationId ?? null),
    ).length;
    const products = activeProducts.filter((product) => {
      const stationId = destinations[product.categoryId];
      return Boolean(stationId && shouldApplyCategoryDestination(product, stationId));
    }).length;
    const exceptions = activeProducts.filter(
      (product) => destinations[product.categoryId] && product.stationIds.length > 1,
    ).length;
    return { categories, products, exceptions };
  }, [activeProducts, destinations, remote]);

  async function save() {
    if (!canManage || remote.status !== "ready") return;
    setBusy(true);
    setFeedback(undefined);
    try {
      // ponytail: reuse the existing audited PUTs; add a server-side batch only if catalog size makes this measurable.
      for (const category of remote.catalog.categories) {
        const stationId = destinations[category.id] || null;
        if (stationId !== (category.defaultStationId ?? null)) {
          await api.pilot.updateCategory(organizationId, unitId, category.id, {
            defaultStationId: stationId,
          });
        }
        if (!stationId) continue;
        for (const product of activeProducts.filter(
          (item) =>
            item.categoryId === category.id && shouldApplyCategoryDestination(item, stationId),
        )) {
          await api.pilot.updateProductUnitConfig(
            organizationId,
            unitId,
            product.id,
            productConfigForStation(product, stationId),
          );
        }
      }
      setFeedback({
        tone: "success",
        message: "Destinos salvos. Os próximos pedidos seguirão esta distribuição.",
      });
      await load();
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: `${message(error)} As alterações já confirmadas foram mantidas; tente salvar novamente.`,
      });
    } finally {
      setBusy(false);
    }
  }

  if (remote.status === "loading") return <p role="status">Carregando o cardápio…</p>;
  if (remote.status === "error") {
    return (
      <Callout tone="danger">
        <strong>Não foi possível abrir o cardápio</strong>
        <p>{remote.message}</p>
        <Button onClick={() => void load()} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      </Callout>
    );
  }

  if (stations.length === 0) {
    return (
      <Callout tone="warning">
        <strong>Crie primeiro uma área de preparo</strong>
        <p>O cardápio precisa saber se cada item vai para o bar, cozinha ou outra área.</p>
      </Callout>
    );
  }

  return (
    <section className="production-routing" aria-labelledby="production-routing-title">
      <div className="production-printers__section-heading">
        <div>
          <h3 id="production-routing-title">Onde cada categoria será preparada?</h3>
          <p>Todos os itens da categoria passarão a seguir o destino escolhido.</p>
        </div>
        <Badge tone={routingReady ? "success" : "warning"}>
          {routingReady ? "Cardápio distribuído" : `${missingProducts.length} item(ns) sem destino`}
        </Badge>
      </div>

      <div className="production-routing__list">
        {remote.catalog.categories.map((category) => {
          const productCount = activeProducts.filter(
            (product) => product.categoryId === category.id,
          ).length;
          return (
            <Card className="production-routing__row" key={category.id}>
              <label htmlFor={`production-category-${category.id}`}>
                <strong>{category.name}</strong>
                <small>{productCount} item(ns)</small>
              </label>
              <NativeSelect
                disabled={!canManage || busy}
                id={`production-category-${category.id}`}
                onChange={(event) =>
                  setDestinations((current) => ({
                    ...current,
                    [category.id]: event.target.value,
                  }))
                }
                value={destinations[category.id] ?? ""}
              >
                <option value="">Escolha onde preparar</option>
                {stations
                  .filter((station) => station.active)
                  .map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name}
                    </option>
                  ))}
              </NativeSelect>
            </Card>
          );
        })}
      </div>

      {changes.products > 0 && (
        <Callout tone="info">
          <strong>Revise antes de salvar</strong>
          <p>{changes.products} item(ns) serão movidos para a área escolhida.</p>
        </Callout>
      )}
      {changes.exceptions > 0 && (
        <Callout tone="info">
          <strong>Rotas especiais serão preservadas</strong>
          <p>
            {changes.exceptions} item(ns) já passam por mais de uma área e não serão alterados por
            esta configuração em lote.
          </p>
        </Callout>
      )}
      {feedback && (
        <Callout tone={feedback.tone}>
          <p>{feedback.message}</p>
        </Callout>
      )}
      {canManage && (
        <div className="production-routing__actions">
          <Button
            disabled={busy || (changes.categories === 0 && changes.products === 0)}
            onClick={() => void save()}
          >
            {busy ? "Salvando destinos…" : "Salvar destinos"}
          </Button>
        </div>
      )}
    </section>
  );
}
