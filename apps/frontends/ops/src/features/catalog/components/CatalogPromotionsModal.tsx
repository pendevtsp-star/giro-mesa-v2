import { Button, Icon, Input, Label, Modal, NativeSelect } from "@giromesa/ui";
import { type CSSProperties, type Dispatch, type SetStateAction, useState } from "react";
import { api } from "../../../api";
import {
  type CatalogPromotionRule,
  type PilotCatalog,
  type PilotScope,
  priceToCents,
} from "../../../operations.shared";
import { formatMoney } from "../../../rules";

type FeedbackTone = "danger" | "success";

type CatalogPromotionsModalProps = {
  busy: string;
  catalog: PilotCatalog;
  completeCreateAttempt: (operation: string) => void;
  createAttemptKey: (operation: string, body: unknown) => string;
  feedback: (message: string, tone?: FeedbackTone) => void;
  onClose: () => void;
  onRetry?: () => void;
  open: boolean;
  scope: PilotScope;
  setBusy: Dispatch<SetStateAction<string>>;
};

const tabsStyle: CSSProperties = {
  display: "flex",
  borderBottom: "1px solid var(--gm-border)",
  gap: 8,
};

const panelStyle: CSSProperties = {
  padding: "14px 16px",
  background: "var(--gm-surface-soft)",
  borderRadius: 10,
  border: "1px solid var(--gm-border)",
};

const campaignPanelStyle: CSSProperties = {
  ...panelStyle,
  padding: "16px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const cardStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 8,
  border: "1px solid var(--gm-border)",
  background: "var(--gm-surface)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const fieldTitleStyle: CSSProperties = {
  fontSize: "0.78rem",
  fontWeight: 700,
  color: "var(--gm-ink)",
  display: "block",
  marginBottom: 6,
};

const chipContainerStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    border: "none",
    background: "transparent",
    borderBottom: active ? "2px solid var(--gm-brand)" : "2px solid transparent",
    color: active ? "var(--gm-brand)" : "var(--gm-muted)",
    fontWeight: 700,
    fontSize: "0.88rem",
    cursor: "pointer",
  };
}

function chipStyle(active: boolean, accent = "var(--gm-brand)"): CSSProperties {
  return {
    fontSize: "0.76rem",
    padding: "4px 10px",
    borderRadius: 9999,
    border: active ? `1.5px solid ${accent}` : "1px solid var(--gm-border)",
    background: active ? `color-mix(in srgb, ${accent} 15%, transparent)` : "var(--gm-surface)",
    color: "var(--gm-ink)",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
  };
}

const weekDays = [
  { day: 0, label: "Dom" },
  { day: 1, label: "Seg" },
  { day: 2, label: "Ter" },
  { day: 3, label: "Qua" },
  { day: 4, label: "Qui" },
  { day: 5, label: "Sex" },
  { day: 6, label: "Sáb" },
] as const;

export function CatalogPromotionsModal({
  busy,
  catalog,
  completeCreateAttempt,
  createAttemptKey,
  feedback,
  onClose,
  onRetry,
  open,
  scope,
  setBusy,
}: CatalogPromotionsModalProps) {
  const [tab, setTab] = useState<"combos" | "happyhour">("combos");
  const [comboName, setComboName] = useState("");
  const [comboDescription, setComboDescription] = useState("");
  const [comboPrice, setComboPrice] = useState("");
  const [comboProductIds, setComboProductIds] = useState<string[]>([]);
  const [promotionProductSearch, setPromotionProductSearch] = useState("");
  const [promotionName, setPromotionName] = useState("");
  const [promotionType, setPromotionType] = useState<"percentage" | "fixed_price">("percentage");
  const [promotionValue, setPromotionValue] = useState("25");
  const [promotionDays, setPromotionDays] = useState<number[]>([2, 3, 4, 5]);
  const [promotionStart, setPromotionStart] = useState("17:30");
  const [promotionEnd, setPromotionEnd] = useState("20:30");
  const [promotionCategoryIds, setPromotionCategoryIds] = useState<string[]>([]);
  const [promotionProductIds, setPromotionProductIds] = useState<string[]>([]);
  const [promotionSalon, setPromotionSalon] = useState(true);
  const [promotionQr, setPromotionQr] = useState(true);
  const [promotionDelivery, setPromotionDelivery] = useState(false);

  async function createCombo() {
    const priceCents = priceToCents(comboPrice);
    const body = {
      name: comboName.trim(),
      description: comboDescription.trim() || undefined,
      priceCents,
      active: true,
      items: comboProductIds.map((productId) => ({ productId, quantity: 1 })),
    };
    if (
      body.name.length < 2 ||
      comboPrice.trim() === "" ||
      priceCents < 0 ||
      body.items.length === 0
    )
      return;

    setBusy("combo");
    feedback("");
    try {
      await api.pilot.createCombo(
        scope.organizationId,
        scope.unitId,
        body,
        createAttemptKey("combo", body),
      );
      completeCreateAttempt("combo");
      onRetry?.();
      setComboName("");
      setComboDescription("");
      setComboPrice("");
      setComboProductIds([]);
      feedback(`Combo "${body.name}" criado com sucesso.`);
    } catch (error) {
      feedback(
        error instanceof Error ? error.message : "Não foi possível criar o combo.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  async function removeCombo(id: string) {
    setBusy(`combo-${id}`);
    try {
      await api.pilot.archiveCombo(scope.organizationId, scope.unitId, id);
      onRetry?.();
      feedback("Combo removido.");
    } catch (error) {
      feedback(error instanceof Error ? error.message : "Falha ao remover combo.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function savePromotion() {
    const name = promotionName.trim();
    if (name.length < 2 || promotionDays.length === 0) return;
    const displayValue = Number(promotionValue.replace(",", "."));
    if (!Number.isFinite(displayValue) || displayValue <= 0) {
      feedback("Informe um desconto válido.", "danger");
      return;
    }
    const rule: Omit<CatalogPromotionRule, "id"> = {
      name,
      discountType: promotionType,
      discountValue: promotionType === "percentage" ? displayValue : Math.round(displayValue * 100),
      daysOfWeek: promotionDays,
      startTime: promotionStart,
      endTime: promotionEnd,
      categoryIds: promotionCategoryIds,
      productIds: promotionProductIds,
      channels: {
        salon: promotionSalon,
        qrMesa: promotionQr,
        delivery: promotionDelivery,
      },
      active: true,
    };
    setBusy("promotion");
    try {
      const body = {
        name: rule.name,
        discountType: (rule.discountType === "amount_off" ? "fixed_price" : rule.discountType) as
          | "percentage"
          | "fixed_price",
        discountValue:
          rule.discountType === "percentage"
            ? Math.round(rule.discountValue * 100)
            : rule.discountValue,
        categoryIds: rule.categoryIds ?? [],
        productIds: rule.productIds ?? [],
        comboIds: [],
        channels: [
          ...(rule.channels.salon ? (["salon"] as const) : []),
          ...(rule.channels.qrMesa ? (["qr"] as const) : []),
          ...(rule.channels.delivery ? (["delivery"] as const) : []),
        ],
        daysOfWeek: rule.daysOfWeek,
        startTime: rule.startTime,
        endTime: rule.endTime,
        active: rule.active,
      };
      await api.pilot.createPromotion(
        scope.organizationId,
        scope.unitId,
        body,
        createAttemptKey("promotion", body),
      );
      completeCreateAttempt("promotion");
      onRetry?.();
      setPromotionName("");
      feedback(`Campanha "${name}" criada com sucesso.`);
    } catch (error) {
      feedback(error instanceof Error ? error.message : "Falha ao salvar promoção.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function togglePromotion(promotion: CatalogPromotionRule) {
    setBusy(`promotion-${promotion.id}`);
    try {
      await api.pilot.updatePromotion(scope.organizationId, scope.unitId, promotion.id, {
        active: !promotion.active,
      });
      onRetry?.();
      feedback(promotion.active ? "Campanha pausada." : "Campanha ativada.");
    } catch (error) {
      feedback(error instanceof Error ? error.message : "Falha ao atualizar promoção.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function removePromotion(id: string) {
    setBusy(`promotion-${id}`);
    try {
      await api.pilot.archivePromotion(scope.organizationId, scope.unitId, id);
      onRetry?.();
      feedback("Campanha removida.");
    } catch (error) {
      feedback(error instanceof Error ? error.message : "Falha ao remover promoção.", "danger");
    } finally {
      setBusy("");
    }
  }

  const standaloneTotal = comboProductIds.reduce(
    (total, id) => total + (catalog.products.find((product) => product.id === id)?.priceCents ?? 0),
    0,
  );
  const comboPriceCents = priceToCents(comboPrice) || 0;
  const savings =
    standaloneTotal > comboPriceCents && comboPriceCents > 0
      ? standaloneTotal - comboPriceCents
      : 0;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Gestão de Combos & Promoções de Horário"
      size="lg"
    >
      <div className="catalog-stack catalog-stack--16">
        <div style={tabsStyle}>
          <Button
            type="button"
            aria-pressed={tab === "combos"}
            onClick={() => setTab("combos")}
            style={tabStyle(tab === "combos")}
          >
            Combos Especiais ({catalog.combos.length})
          </Button>
          <Button
            type="button"
            aria-pressed={tab === "happyhour"}
            onClick={() => setTab("happyhour")}
            style={tabStyle(tab === "happyhour")}
          >
            Promoções & Happy Hour
          </Button>
        </div>

        {tab === "combos" ? (
          <div className="catalog-stack catalog-stack--14" role="tabpanel">
            <div style={panelStyle}>
              <strong style={fieldTitleStyle}>+ Criar Novo Combo Inteligente</strong>
              <div className="catalog-combo-form-grid">
                <Input
                  placeholder="Nome do Combo (Ex: Combo Casal, Burger + Refri...)"
                  aria-label="Nome do combo"
                  value={comboName}
                  onChange={(event) => setComboName(event.target.value)}
                  className="catalog-control-36"
                />
                <Input
                  placeholder="Preço Promocional do Combo (R$)"
                  aria-label="Preço promocional do combo"
                  inputMode="decimal"
                  data-currency="brl"
                  value={comboPrice}
                  onChange={(event) => setComboPrice(event.target.value)}
                  className="catalog-control-36"
                />
              </div>
              <Input
                placeholder="Descrição do combo (Ex: 1 Hambúrguer + 1 Batata + 1 Bebida com 20% de economia)"
                aria-label="Descrição do combo"
                value={comboDescription}
                onChange={(event) => setComboDescription(event.target.value)}
                className="catalog-control-36"
                style={{ width: "100%", marginBottom: 10 }}
              />

              <div>
                <span style={fieldTitleStyle}>Selecione os Produtos Inclusos no Combo:</span>
                <div style={chipContainerStyle}>
                  {catalog.products
                    .filter((product) => product.active)
                    .map((product) => {
                      const selected = comboProductIds.includes(product.id);
                      return (
                        <Button
                          key={product.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            setComboProductIds((current) =>
                              selected
                                ? current.filter((id) => id !== product.id)
                                : [...current, product.id],
                            )
                          }
                          style={chipStyle(selected)}
                        >
                          {selected ? "✓ " : "+ "}
                          {product.name} ({formatMoney(product.priceCents)})
                        </Button>
                      );
                    })}
                </div>
              </div>

              {comboProductIds.length > 0 && (
                <div
                  className="catalog-between"
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: "1px dashed var(--gm-border)",
                  }}
                >
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "var(--gm-muted)" }}>
                      Valor avulso: {formatMoney(standaloneTotal)}
                    </span>
                    {savings > 0 && (
                      <span
                        style={{
                          fontSize: "0.78rem",
                          color: "var(--gm-success)",
                          fontWeight: 700,
                          marginLeft: 10,
                        }}
                      >
                        Economia para o cliente: {formatMoney(savings)} (
                        {Math.round((savings / standaloneTotal) * 100)}% OFF)
                      </span>
                    )}
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={
                      busy === "combo" ||
                      comboName.trim().length < 2 ||
                      comboPrice.trim() === "" ||
                      priceToCents(comboPrice) < 0 ||
                      comboProductIds.length === 0
                    }
                    onClick={() => void createCombo()}
                  >
                    <Icon name="check" size={13} />
                    <span>{busy === "combo" ? "Salvando…" : "Salvar Combo"}</span>
                  </Button>
                </div>
              )}
            </div>

            <div className="catalog-stack catalog-stack--8">
              {catalog.combos.map((combo) => (
                <div key={combo.id} style={cardStyle}>
                  <div>
                    <strong style={{ fontSize: "0.95rem", color: "var(--gm-ink)" }}>
                      {combo.name}
                    </strong>
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--gm-brand)",
                        fontWeight: 800,
                        marginLeft: 10,
                      }}
                    >
                      {formatMoney(combo.priceCents)}
                    </span>
                    {combo.description && (
                      <p className="catalog-muted-copy-tight" style={{ marginTop: 4 }}>
                        {combo.description}
                      </p>
                    )}
                    <div className="catalog-wrap-6" style={{ marginTop: 6 }}>
                      {combo.items.map((item) => {
                        const product = catalog.products.find(
                          (candidate) => candidate.id === item.productId,
                        );
                        return (
                          <span
                            key={item.productId}
                            style={{
                              fontSize: "0.7rem",
                              padding: "2px 6px",
                              background: "var(--gm-surface-soft)",
                              borderRadius: 4,
                              color: "var(--gm-muted)",
                            }}
                          >
                            {item.quantity}x {product?.name || "Item"}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <Button
                    type="button"
                    className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                    disabled={busy === `combo-${combo.id}`}
                    onClick={() => void removeCombo(combo.id)}
                    title="Excluir combo"
                  >
                    <Icon name="x" size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="catalog-stack catalog-stack--16" role="tabpanel">
            <div style={campaignPanelStyle}>
              <strong style={{ fontSize: "0.9rem", color: "var(--gm-ink)" }}>
                + Criar Nova Campanha de Happy Hour / Promoção Programada
              </strong>
              <div className="catalog-grid-main">
                <Label className="catalog-field catalog-field--compact">
                  Nome da Campanha *
                  <Input
                    placeholder="Ex: Happy Hour Chopp & Petiscos..."
                    value={promotionName}
                    onChange={(event) => setPromotionName(event.target.value)}
                    className="catalog-control-36"
                  />
                </Label>
                <Label className="catalog-field catalog-field--compact">
                  Tipo de Desconto
                  <NativeSelect
                    value={promotionType}
                    onChange={(event) =>
                      setPromotionType(event.target.value as "percentage" | "fixed_price")
                    }
                    className="catalog-control-36"
                  >
                    <option value="percentage">% de Desconto</option>
                    <option value="fixed_price">Preço Fixo Promocional (R$)</option>
                  </NativeSelect>
                </Label>
                <Label className="catalog-field catalog-field--compact">
                  {promotionType === "percentage"
                    ? "% de desconto *"
                    : "Preço promocional final (R$) *"}
                  <Input
                    placeholder={promotionType === "percentage" ? "Ex: 25 (para 25%)" : "Ex: 12,00"}
                    value={promotionValue}
                    onChange={(event) => setPromotionValue(event.target.value)}
                    className="catalog-control-36"
                  />
                </Label>
              </div>

              <div>
                <span style={fieldTitleStyle}>Dias da Semana Válidos:</span>
                <div className="catalog-wrap-6">
                  {weekDays.map(({ day, label }) => {
                    const selected = promotionDays.includes(day);
                    return (
                      <Button
                        key={day}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setPromotionDays((current) =>
                            selected
                              ? current.filter((candidate) => candidate !== day)
                              : [...current, day].sort((left, right) => left - right),
                          )
                        }
                        style={{ ...chipStyle(selected), borderRadius: 6, padding: "6px 14px" }}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="catalog-grid-main" style={{ alignItems: "flex-end" }}>
                <Label className="catalog-field catalog-field--compact">
                  Horário de Início
                  <Input
                    type="time"
                    value={promotionStart}
                    onChange={(event) => setPromotionStart(event.target.value)}
                    className="catalog-control-36"
                  />
                </Label>
                <Label className="catalog-field catalog-field--compact">
                  Horário de Fim
                  <Input
                    type="time"
                    value={promotionEnd}
                    onChange={(event) => setPromotionEnd(event.target.value)}
                    className="catalog-control-36"
                  />
                </Label>
                <div className="catalog-inline-center-10" style={{ height: 36 }}>
                  <Label className="catalog-clickable-row">
                    <input
                      className="accent-primary"
                      type="checkbox"
                      checked={promotionSalon}
                      onChange={(event) => setPromotionSalon(event.target.checked)}
                    />
                    Salão
                  </Label>
                  <Label className="catalog-clickable-row">
                    <input
                      className="accent-primary"
                      type="checkbox"
                      checked={promotionQr}
                      onChange={(event) => setPromotionQr(event.target.checked)}
                    />
                    QR Mesa
                  </Label>
                  <Label className="catalog-clickable-row">
                    <input
                      className="accent-primary"
                      type="checkbox"
                      checked={promotionDelivery}
                      onChange={(event) => setPromotionDelivery(event.target.checked)}
                    />
                    Delivery
                  </Label>
                </div>
              </div>

              <div className="catalog-stack catalog-stack--8">
                <span style={{ ...fieldTitleStyle, marginBottom: 0 }}>
                  1. Aplicar por Categoria Inteira (Opcional):
                </span>
                <div style={chipContainerStyle}>
                  {catalog.categories.map((category) => {
                    const selected = promotionCategoryIds.includes(category.id);
                    return (
                      <Button
                        key={category.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setPromotionCategoryIds((current) =>
                            selected
                              ? current.filter((id) => id !== category.id)
                              : [...current, category.id],
                          )
                        }
                        style={chipStyle(selected)}
                      >
                        {selected ? "✓ Categoria: " : "+ Categoria: "}
                        {category.name}
                      </Button>
                    );
                  })}
                </div>

                <div style={{ marginTop: 4 }}>
                  <div className="catalog-between" style={{ marginBottom: 4 }}>
                    <span style={{ ...fieldTitleStyle, marginBottom: 0 }}>
                      2. Ou Selecionar Produtos Específicos:
                    </span>
                    <Input
                      placeholder="Filtrar prato..."
                      aria-label="Filtrar produtos da promoção"
                      value={promotionProductSearch}
                      onChange={(event) => setPromotionProductSearch(event.target.value)}
                      className="catalog-input-compact"
                    />
                  </div>
                  <div
                    style={{
                      ...chipContainerStyle,
                      maxHeight: 120,
                      overflowY: "auto",
                      padding: 4,
                      background: "var(--gm-surface)",
                      borderRadius: 6,
                      border: "1px solid var(--gm-border)",
                    }}
                  >
                    {catalog.products
                      .filter(
                        (product) =>
                          !promotionProductSearch ||
                          product.name.toLowerCase().includes(promotionProductSearch.toLowerCase()),
                      )
                      .map((product) => {
                        const selected = promotionProductIds.includes(product.id);
                        const categoryName = catalog.categories.find(
                          (category) => category.id === product.categoryId,
                        )?.name;
                        return (
                          <Button
                            key={product.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              setPromotionProductIds((current) =>
                                selected
                                  ? current.filter((id) => id !== product.id)
                                  : [...current, product.id],
                              )
                            }
                            style={{
                              ...chipStyle(selected, "#6366f1"),
                              borderRadius: 6,
                              padding: "3px 8px",
                              background: selected
                                ? "rgba(99, 102, 241, 0.15)"
                                : "var(--gm-surface-soft)",
                              color: selected ? "var(--gm-ink)" : "var(--gm-muted)",
                            }}
                          >
                            {selected ? "✓ " : "+ "}
                            {product.name}{" "}
                            <small style={{ opacity: 0.7 }}>
                              ({categoryName} • {formatMoney(product.priceCents)})
                            </small>
                          </Button>
                        );
                      })}
                  </div>
                </div>
              </div>

              <div
                className="catalog-actions-end"
                style={{ paddingTop: 8, borderTop: "1px dashed var(--gm-border)" }}
              >
                <Button
                  variant="primary"
                  size="sm"
                  disabled={promotionName.trim().length < 2 || promotionDays.length === 0}
                  onClick={() => void savePromotion()}
                >
                  <Icon name="check" size={13} />
                  <span>Salvar Regra de Happy Hour</span>
                </Button>
              </div>
            </div>

            <strong style={{ fontSize: "0.86rem", color: "var(--gm-ink)" }}>
              Campanhas Configuradas ({(catalog.promotions || []).length})
            </strong>
            <div className="catalog-stack catalog-stack--8">
              {(catalog.promotions || []).map((promotion) => {
                const daysNames = promotion.daysOfWeek
                  .map((day) => weekDays[day]?.label)
                  .join(", ");
                return (
                  <div key={promotion.id} style={cardStyle}>
                    <div>
                      <div className="catalog-inline-center-8">
                        <strong style={{ fontSize: "0.92rem", color: "var(--gm-ink)" }}>
                          {promotion.name}
                        </strong>
                        <span
                          style={{
                            fontSize: "0.72rem",
                            background: "rgba(245, 158, 11, 0.12)",
                            color: "#d97706",
                            border: "1px solid rgba(245, 158, 11, 0.3)",
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontWeight: 700,
                          }}
                        >
                          {promotion.discountType === "percentage"
                            ? `${promotion.discountValue}% OFF`
                            : `Preço Especial ${formatMoney(promotion.discountValue)}`}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: "0.76rem",
                          color: "var(--gm-muted)",
                          display: "block",
                          marginTop: 2,
                        }}
                      >
                        {daysNames} • {promotion.startTime} às {promotion.endTime} •{" "}
                        {[
                          promotion.channels.salon && "Salão",
                          promotion.channels.qrMesa && "QR Mesa",
                          promotion.channels.delivery && "Delivery",
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </div>
                    <div className="catalog-wrap-6">
                      <Button
                        type="button"
                        className={`catalog-card-btn ${
                          promotion.active ? "catalog-card-btn--pause" : "catalog-card-btn--active"
                        }`}
                        style={{ height: 30, fontSize: "0.74rem" }}
                        disabled={busy === `promotion-${promotion.id}`}
                        onClick={() => void togglePromotion(promotion)}
                      >
                        <Icon name={promotion.active ? "minus" : "check"} size={12} />
                        <span>{promotion.active ? "Pausar" : "Ativar"}</span>
                      </Button>
                      <Button
                        type="button"
                        className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                        disabled={busy === `promotion-${promotion.id}`}
                        onClick={() => void removePromotion(promotion.id)}
                        title="Excluir campanha"
                      >
                        <Icon name="x" size={13} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="catalog-actions-end">
          <Button variant="primary" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
