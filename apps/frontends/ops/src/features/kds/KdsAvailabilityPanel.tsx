// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Badge, Button, Card, EmptyState, Input, Modal, Textarea } from "@giromesa/ui";
import { type FormEvent, useMemo, useState } from "react";
import type { KdsAllDayItem, KdsProductAvailability } from "../../operations.shared";

export interface KdsAvailabilityChange {
  productId: string;
  productName: string;
  available: boolean;
  reason: string;
  resetAt?: string | null;
  dailyStock?: number | null;
}

interface AvailabilityRow extends Omit<KdsProductAvailability, "status"> {
  status: KdsProductAvailability["status"] | "unknown";
  published: boolean;
}

function availabilityTone(status: AvailabilityRow["status"]) {
  if (status === "available") return "success" as const;
  if (status === "limited") return "warning" as const;
  if (status === "unavailable") return "danger" as const;
  return "neutral" as const;
}

function availabilityLabel(product: AvailabilityRow): string {
  if (product.status === "unavailable") return "Esgotado";
  if (product.status === "limited") {
    return product.remainingQuantity === null
      ? "Venda limitada"
      : `${product.remainingQuantity} restantes`;
  }
  if (product.status === "available") return "Disponível";
  return "Estado não publicado";
}

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

export function KdsAvailabilityPanel({
  busyKeys,
  canManage,
  cloudUnavailable,
  errors,
  fallbackProducts,
  onChange,
  products,
}: {
  busyKeys: Set<string>;
  canManage: boolean;
  cloudUnavailable: boolean;
  errors: Record<string, string>;
  fallbackProducts: KdsAllDayItem[];
  onChange: (change: KdsAvailabilityChange) => Promise<boolean>;
  products: KdsProductAvailability[];
}) {
  const [query, setQuery] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [targetStatus, setTargetStatus] = useState<"available" | "limited" | "unavailable">(
    "unavailable",
  );
  const [reason, setReason] = useState("");
  const [remainingQuantity, setRemainingQuantity] = useState(1);
  const [reactivation, setReactivation] = useState<"manual" | "end_of_shift" | "scheduled">(
    "manual",
  );
  const [resetAt, setResetAt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const rows = useMemo(() => {
    const byId = new Map<string, AvailabilityRow>();
    for (const product of products) byId.set(product.productId, { ...product, published: true });
    for (const product of fallbackProducts) {
      if (!product.productId || byId.has(product.productId)) continue;
      byId.set(product.productId, {
        productId: product.productId,
        productName: product.productName,
        status: "unknown",
        available: true,
        dailyStock: null,
        soldToday: null,
        remainingQuantity: null,
        autoDeductStock: null,
        reason: null,
        updatedByIdentityId: null,
        updatedAt: null,
        resetAt: null,
        published: false,
      });
    }
    return [...byId.values()].sort((left, right) =>
      left.productName.localeCompare(right.productName, "pt-BR"),
    );
  }, [fallbackProducts, products]);
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const visibleProducts = rows.filter(
    (product) =>
      normalizedQuery.length === 0 ||
      product.productName.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
  );
  const unavailableProducts = rows.filter((product) => product.status === "unavailable");
  const selectedProduct = rows.find((product) => product.productId === selectedProductId) ?? null;
  const busy = selectedProduct
    ? busyKeys.has(`product:${selectedProduct.productId}:availability`)
    : false;

  function openEditor(
    product: AvailabilityRow,
    requestedStatus: "available" | "limited" | "unavailable" = product.status === "unknown"
      ? "unavailable"
      : product.status,
  ) {
    setSelectedProductId(product.productId);
    setTargetStatus(requestedStatus);
    setReason(product.reason ?? "");
    setRemainingQuantity(Math.max(1, product.remainingQuantity ?? 1));
    setReactivation(product.resetAt ? "scheduled" : "manual");
    setResetAt(toLocalDateTime(product.resetAt));
    setConfirmed(false);
  }

  function closeEditor() {
    if (busy) return;
    setSelectedProductId(null);
    setConfirmed(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedProduct || reason.trim().length < 3 || !confirmed) return;
    const scheduledResetAt =
      targetStatus === "unavailable" && reactivation !== "manual" && resetAt
        ? new Date(resetAt).toISOString()
        : targetStatus === "unavailable"
          ? null
          : undefined;
    const dailyStock =
      targetStatus === "limited"
        ? (selectedProduct.soldToday ?? 0) + Math.max(0, Math.floor(remainingQuantity))
        : targetStatus === "available"
          ? null
          : undefined;
    setSubmitting(true);
    const accepted = await onChange({
      productId: selectedProduct.productId,
      productName: selectedProduct.productName,
      available: targetStatus !== "unavailable",
      reason: reason.trim(),
      ...(scheduledResetAt === undefined ? {} : { resetAt: scheduledResetAt }),
      ...(dailyStock === undefined ? {} : { dailyStock }),
    });
    setSubmitting(false);
    if (accepted) {
      setSelectedProductId(null);
      setConfirmed(false);
    }
  }

  return (
    <Card className="kds-settings-card kds-availability" data-kds-availability>
      <header className="kds-settings-card__header">
        <div>
          <span className="gm-pill">Operação da unidade</span>
          <h2>Central de disponibilidade</h2>
          <p>
            Esgote, limite ou libere produtos em todos os canais desta unidade. “86” aparece apenas
            como código auxiliar de cozinha.
          </p>
        </div>
        <Badge tone={unavailableProducts.length > 0 ? "danger" : "success"}>
          {unavailableProducts.length > 0
            ? `${unavailableProducts.length} esgotado(s)`
            : "Tudo disponível"}
        </Badge>
      </header>

      {unavailableProducts.length > 0 && (
        <section aria-labelledby="kds-unavailable-title" className="kds-unavailable-list">
          <h3 id="kds-unavailable-title">Indisponíveis agora</h3>
          <ul>
            {unavailableProducts.map((product) => (
              <li key={product.productId}>
                <span>
                  <strong>{product.productName}</strong>
                  <small>
                    {product.reason ?? "Motivo não publicado"}
                    {product.resetAt
                      ? ` · volta prevista ${new Date(product.resetAt).toLocaleString("pt-BR")}`
                      : " · retorno manual"}
                  </small>
                </span>
                {canManage && (
                  <Button
                    disabled={cloudUnavailable}
                    onClick={() => openEditor(product, "available")}
                    size="sm"
                    variant="secondary"
                  >
                    Voltar a vender
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <label className="gm-form-field" htmlFor="kds-availability-search">
        <span>Pesquisar produto</span>
        <Input
          className="gm-form-control"
          id="kds-availability-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ex.: risoto, cerveja, sobremesa"
          type="search"
          value={query}
        />
      </label>

      {visibleProducts.length === 0 ? (
        <EmptyState
          description="A lista será atualizada quando o servidor publicar produtos ou houver demanda no KDS."
          icon="◇"
          title="Nenhum produto encontrado"
        />
      ) : (
        <ul className="kds-availability-products">
          {visibleProducts.slice(0, 40).map((product) => (
            <li key={product.productId}>
              <span>
                <strong>{product.productName}</strong>
                {!product.published && <small>Estado legado ainda não publicado</small>}
              </span>
              <Badge tone={availabilityTone(product.status)}>{availabilityLabel(product)}</Badge>
              {canManage && (
                <Button
                  disabled={cloudUnavailable}
                  onClick={() => openEditor(product)}
                  size="sm"
                  variant="ghost"
                >
                  Alterar
                </Button>
              )}
              {errors[`product:${product.productId}:availability`] && (
                <small className="kds-action-error" role="alert">
                  {errors[`product:${product.productId}:availability`]}
                </small>
              )}
            </li>
          ))}
        </ul>
      )}

      {!canManage && (
        <p className="kds-settings-scope-note">
          Consulta liberada. Alterações exigem perfil gerente ou proprietário.
        </p>
      )}
      {cloudUnavailable && (
        <p className="kds-inline-alert" role="status">
          Alterar disponibilidade exige conexão; nenhum estado será simulado localmente.
        </p>
      )}

      <Modal
        isOpen={selectedProduct !== null}
        onClose={closeEditor}
        size="sm"
        title={
          selectedProduct ? `Disponibilidade — ${selectedProduct.productName}` : "Disponibilidade"
        }
      >
        {selectedProduct && (
          <form className="kds-availability-form" onSubmit={submit}>
            <fieldset>
              <legend>Estado de venda</legend>
              <label>
                <input
                  checked={targetStatus === "available"}
                  name="availability-status"
                  onChange={() => setTargetStatus("available")}
                  type="radio"
                />
                Disponível sem limite
              </label>
              <label>
                <input
                  checked={targetStatus === "limited"}
                  name="availability-status"
                  onChange={() => setTargetStatus("limited")}
                  type="radio"
                />
                Limite restante
              </label>
              <label>
                <input
                  checked={targetStatus === "unavailable"}
                  name="availability-status"
                  onChange={() => setTargetStatus("unavailable")}
                  type="radio"
                />
                Esgotado <small>(código 86)</small>
              </label>
            </fieldset>

            {targetStatus === "limited" && (
              <label className="gm-form-field" htmlFor="kds-availability-remaining">
                <span>Quantidade restante que pode ser vendida</span>
                <Input
                  className="gm-form-control"
                  id="kds-availability-remaining"
                  min={0}
                  onChange={(event) => setRemainingQuantity(Number(event.target.value))}
                  required
                  step={1}
                  type="number"
                  value={remainingQuantity}
                />
                <small>
                  O GiroMesa considera {selectedProduct.soldToday ?? 0} venda(s) já registradas
                  hoje.
                </small>
              </label>
            )}

            {targetStatus === "unavailable" && (
              <fieldset>
                <legend>Reativação</legend>
                <label>
                  <input
                    checked={reactivation === "manual"}
                    name="availability-reactivation"
                    onChange={() => setReactivation("manual")}
                    type="radio"
                  />
                  Manual
                </label>
                <label>
                  <input
                    checked={reactivation === "end_of_shift"}
                    name="availability-reactivation"
                    onChange={() => setReactivation("end_of_shift")}
                    type="radio"
                  />
                  No fim do turno
                </label>
                <label>
                  <input
                    checked={reactivation === "scheduled"}
                    name="availability-reactivation"
                    onChange={() => setReactivation("scheduled")}
                    type="radio"
                  />
                  Em um horário
                </label>
              </fieldset>
            )}

            {targetStatus === "unavailable" && reactivation !== "manual" && (
              <label className="gm-form-field" htmlFor="kds-availability-reset-at">
                <span>
                  {reactivation === "end_of_shift"
                    ? "Horário de encerramento deste turno"
                    : "Data e horário para voltar a vender"}
                </span>
                <Input
                  className="gm-form-control"
                  id="kds-availability-reset-at"
                  min={toLocalDateTime(new Date().toISOString())}
                  onChange={(event) => setResetAt(event.target.value)}
                  required
                  type="datetime-local"
                  value={resetAt}
                />
              </label>
            )}

            <label className="gm-form-field" htmlFor="kds-availability-reason">
              <span>Motivo</span>
              <Textarea
                className="gm-form-control"
                id="kds-availability-reason"
                maxLength={500}
                minLength={3}
                onChange={(event) => setReason(event.target.value)}
                required
                rows={3}
                value={reason}
              />
            </label>

            <label className="kds-availability-confirmation">
              <input
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                type="checkbox"
              />
              <span>
                Confirmo a alteração para toda a unidade e seus canais. Pedidos ativos já enviados à
                produção serão preservados.
              </span>
            </label>

            <div className="kds-item-operation-form__actions">
              <Button onClick={closeEditor} type="button" variant="ghost">
                Voltar
              </Button>
              <Button
                disabled={busy || submitting || !confirmed || reason.trim().length < 3}
                type="submit"
              >
                {busy || submitting ? "Confirmando…" : "Confirmar disponibilidade"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}
