// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Badge, Button, Card, EmptyState, Icon, Input, NativeSelect, Textarea } from "@giromesa/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api";
import {
  type GrowthScope,
  moneyToCents,
  number,
  parseCampaigns,
  parseCustomers,
  RemoteGate,
  record,
  useRemote,
} from "../../growth.shared";

export function RealCrmPage({ scope }: { scope: GrowthScope }) {
  const customers = useRemote(
    scope,
    () => api.growth.customers(scope.organizationId),
    parseCustomers,
  );
  const campaigns = useRemote(
    scope,
    () => api.growth.campaigns(scope.organizationId),
    parseCampaigns,
  );
  const [balanceByCustomer, setBalanceByCustomer] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [consentCustomerId, setConsentCustomerId] = useState("");
  const [consentDecision, setConsentDecision] = useState<"granted" | "withdrawn">("granted");
  const [consentChannel, setConsentChannel] = useState<"email" | "whatsapp" | "all">("all");
  const [policyVersion, setPolicyVersion] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignChannel, setCampaignChannel] = useState<"email" | "whatsapp">("email");
  const [campaignSubject, setCampaignSubject] = useState("");
  const [campaignContent, setCampaignContent] = useState("");
  const [loyaltyMode, setLoyaltyMode] = useState<"points" | "cashback">("points");
  const [loyaltyRate, setLoyaltyRate] = useState("");
  const [loyaltyMinimum, setLoyaltyMinimum] = useState("0");
  const [couponCode, setCouponCode] = useState("");
  const [couponType, setCouponType] = useState<"fixed" | "percentage">("fixed");
  const [couponValue, setCouponValue] = useState("");
  const [segmentName, setSegmentName] = useState("");
  const [segmentKind, setSegmentKind] = useState<"all" | "marketing_opt_in">("marketing_opt_in");
  async function loadBalance(customerId: string) {
    setBusy(customerId);
    setFeedback("");
    try {
      const payload = record(await api.growth.loyaltyBalance(scope.organizationId, customerId));
      setBalanceByCustomer((value) => ({ ...value, [customerId]: number(payload.balance) }));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível consultar o saldo.");
    } finally {
      setBusy("");
    }
  }
  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("new-customer");
    setFeedback("");
    try {
      await api.growth.createCustomer(scope.organizationId, {
        defaultUnitId: scope.unitId,
        name: customerName.trim(),
        email: customerEmail.trim() || undefined,
        phone: customerPhone.trim() || undefined,
      });
      setCustomerName("");
      setCustomerEmail("");
      setCustomerPhone("");
      setFeedback("Cliente cadastrado. Consentimento de marketing continua separado.");
      customers.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível cadastrar o cliente.");
    } finally {
      setBusy("");
    }
  }
  async function recordConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("consent");
    setFeedback("");
    try {
      await api.growth.recordConsent(scope.organizationId, consentCustomerId, {
        decision: consentDecision,
        purpose: "marketing",
        channel: consentChannel,
        source: "ops-crm",
        legalBasis: "consent",
        policyVersion: policyVersion.trim(),
      });
      setFeedback(
        consentDecision === "granted"
          ? "Consentimento registrado com trilha de auditoria."
          : "Retirada de consentimento registrada.",
      );
      customers.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível registrar a decisão.");
    } finally {
      setBusy("");
    }
  }
  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("campaign");
    setFeedback("");
    try {
      await api.growth.createCampaign(scope.organizationId, {
        unitId: scope.unitId,
        name: campaignName.trim(),
        channel: campaignChannel,
        subject: campaignChannel === "email" ? campaignSubject.trim() : undefined,
        content: campaignContent.trim(),
      });
      setCampaignName("");
      setCampaignSubject("");
      setCampaignContent("");
      setFeedback("Campanha salva como rascunho. Nenhum envio foi iniciado.");
      campaigns.retry();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível criar a campanha.");
    } finally {
      setBusy("");
    }
  }
  async function createLoyaltyProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("loyalty");
    setFeedback("");
    try {
      await api.growth.createLoyaltyProgram(scope.organizationId, {
        mode: loyaltyMode,
        rate: Number(loyaltyRate.replace(",", ".")),
        minimumOrderCents: moneyToCents(loyaltyMinimum),
        active: true,
      });
      setFeedback("Programa de fidelidade configurado.");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível configurar fidelidade.",
      );
    } finally {
      setBusy("");
    }
  }
  async function createCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("coupon");
    setFeedback("");
    try {
      await api.growth.createCoupon(scope.organizationId, {
        unitId: scope.unitId,
        code: couponCode.trim().toUpperCase(),
        type: couponType,
        value:
          couponType === "fixed"
            ? moneyToCents(couponValue)
            : Math.round(Number(couponValue.replace(",", ".")) * 100),
        minimumOrderCents: 0,
        channels: ["direct"],
        unitIds: [scope.unitId],
        perCustomerLimit: 1,
        active: true,
      });
      setCouponCode("");
      setCouponValue("");
      setFeedback("Cupom criado para esta unidade.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível criar o cupom.");
    } finally {
      setBusy("");
    }
  }
  async function createSegment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("segment");
    setFeedback("");
    try {
      await api.growth.createSegment(scope.organizationId, {
        name: segmentName.trim(),
        filters: { kind: segmentKind },
        active: true,
      });
      setSegmentName("");
      setFeedback("Segmento salvo para uso em campanhas.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível criar o segmento.");
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="growth-stack">
      {feedback && (
        <p className="form-feedback" role="status">
          {feedback}
        </p>
      )}
      <details className="action-panel">
        <summary>
          <span>
            <strong>Novo cliente</strong>
            <small>O cadastro não concede consentimento de marketing automaticamente.</small>
          </span>
          <Icon name="plus" size={18} />
        </summary>
        <form className="action-form" onSubmit={(event) => void createCustomer(event)}>
          <label>
            Nome
            <Input
              minLength={2}
              onChange={(event) => setCustomerName(event.target.value)}
              required
              value={customerName}
            />
          </label>
          <label>
            E-mail
            <Input
              onChange={(event) => setCustomerEmail(event.target.value)}
              type="email"
              value={customerEmail}
            />
          </label>
          <label>
            Telefone
            <Input
              minLength={8}
              onChange={(event) => setCustomerPhone(event.target.value)}
              type="tel"
              value={customerPhone}
            />
          </label>
          <Button
            disabled={busy === "new-customer" || customerName.trim().length < 2}
            type="submit"
          >
            {busy === "new-customer" ? "Salvando…" : "Cadastrar cliente"}
          </Button>
        </form>
      </details>
      <details className="action-panel">
        <summary>
          <span>
            <strong>Consentimento de marketing</strong>
            <small>Registre concessão ou retirada sem alterar o cadastro do cliente.</small>
          </span>
          <Icon name="plus" size={18} />
        </summary>
        <form className="action-form" onSubmit={(event) => void recordConsent(event)}>
          <label className="action-form__wide">
            Cliente
            <NativeSelect
              onChange={(event) => setConsentCustomerId(event.target.value)}
              required
              value={consentCustomerId}
            >
              <option value="">Selecione</option>
              {customers.state.status === "ready" &&
                customers.state.data.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
            </NativeSelect>
          </label>
          <label>
            Decisão
            <NativeSelect
              onChange={(event) =>
                setConsentDecision(event.target.value as "granted" | "withdrawn")
              }
              value={consentDecision}
            >
              <option value="granted">Conceder</option>
              <option value="withdrawn">Retirar</option>
            </NativeSelect>
          </label>
          <label>
            Canal
            <NativeSelect
              onChange={(event) =>
                setConsentChannel(event.target.value as "email" | "whatsapp" | "all")
              }
              value={consentChannel}
            >
              <option value="all">E-mail e WhatsApp</option>
              <option value="email">E-mail</option>
              <option value="whatsapp">WhatsApp</option>
            </NativeSelect>
          </label>
          <label className="action-form__wide">
            Versão da política aceita
            <Input
              maxLength={40}
              onChange={(event) => setPolicyVersion(event.target.value)}
              placeholder="Ex.: privacidade-2026-08"
              required
              value={policyVersion}
            />
          </label>
          <Button
            disabled={busy === "consent" || !consentCustomerId || !policyVersion.trim()}
            type="submit"
          >
            {busy === "consent" ? "Registrando…" : "Registrar decisão"}
          </Button>
        </form>
      </details>
      <details className="action-panel">
        <summary>
          <span>
            <strong>Nova campanha</strong>
            <small>
              Crie o rascunho; o envio continua separado e depende de provedor homologado.
            </small>
          </span>
          <Icon name="plus" size={18} />
        </summary>
        <form className="action-form" onSubmit={(event) => void createCampaign(event)}>
          <label>
            Nome interno
            <Input
              minLength={2}
              onChange={(event) => setCampaignName(event.target.value)}
              required
              value={campaignName}
            />
          </label>
          <label>
            Canal
            <NativeSelect
              onChange={(event) => setCampaignChannel(event.target.value as "email" | "whatsapp")}
              value={campaignChannel}
            >
              <option value="email">E-mail</option>
              <option value="whatsapp">WhatsApp</option>
            </NativeSelect>
          </label>
          {campaignChannel === "email" && (
            <label className="action-form__wide">
              Assunto
              <Input
                minLength={2}
                onChange={(event) => setCampaignSubject(event.target.value)}
                required
                value={campaignSubject}
              />
            </label>
          )}
          <label className="action-form__wide">
            Conteúdo
            <Textarea
              maxLength={5000}
              minLength={2}
              onChange={(event) => setCampaignContent(event.target.value)}
              required
              rows={4}
              value={campaignContent}
            />
          </label>
          <Button
            disabled={
              busy === "campaign" ||
              campaignName.trim().length < 2 ||
              campaignContent.trim().length < 2 ||
              (campaignChannel === "email" && campaignSubject.trim().length < 2)
            }
            type="submit"
          >
            {busy === "campaign" ? "Salvando…" : "Salvar rascunho"}
          </Button>
        </form>
      </details>
      <div className="quick-actions-grid">
        <details className="action-panel">
          <summary>
            <span>
              <strong>Programa de fidelidade</strong>
              <small>Configure pontos ou cashback da organização.</small>
            </span>
            <Icon name="plus" size={18} />
          </summary>
          <form className="action-form" onSubmit={(event) => void createLoyaltyProgram(event)}>
            <label>
              Modalidade
              <NativeSelect
                onChange={(event) => setLoyaltyMode(event.target.value as "points" | "cashback")}
                value={loyaltyMode}
              >
                <option value="points">Pontos</option>
                <option value="cashback">Cashback</option>
              </NativeSelect>
            </label>
            <label>
              Taxa
              <Input
                inputMode="decimal"
                onChange={(event) => setLoyaltyRate(event.target.value)}
                required
                value={loyaltyRate}
              />
            </label>
            <label>
              Pedido mínimo
              <Input
                inputMode="decimal"
                onChange={(event) => setLoyaltyMinimum(event.target.value)}
                required
                value={loyaltyMinimum}
              />
            </label>
            <Button
              disabled={busy === "loyalty" || Number(loyaltyRate.replace(",", ".")) <= 0}
              type="submit"
            >
              Salvar programa
            </Button>
          </form>
        </details>
        <details className="action-panel">
          <summary>
            <span>
              <strong>Novo cupom</strong>
              <small>Crie benefício limitado à unidade atual.</small>
            </span>
            <Icon name="plus" size={18} />
          </summary>
          <form className="action-form" onSubmit={(event) => void createCoupon(event)}>
            <label>
              Código
              <Input
                minLength={3}
                onChange={(event) =>
                  setCouponCode(event.target.value.replace(/[^A-Za-z0-9_-]/g, ""))
                }
                required
                value={couponCode}
              />
            </label>
            <label>
              Tipo
              <NativeSelect
                onChange={(event) => setCouponType(event.target.value as "fixed" | "percentage")}
                value={couponType}
              >
                <option value="fixed">Valor fixo</option>
                <option value="percentage">Percentual</option>
              </NativeSelect>
            </label>
            <label>
              {couponType === "fixed" ? "Valor" : "Percentual"}
              <Input
                inputMode="decimal"
                onChange={(event) => setCouponValue(event.target.value)}
                required
                value={couponValue}
              />
            </label>
            <Button
              disabled={busy === "coupon" || couponCode.length < 3 || !couponValue}
              type="submit"
            >
              Criar cupom
            </Button>
          </form>
        </details>
        <details className="action-panel">
          <summary>
            <span>
              <strong>Novo segmento</strong>
              <small>Defina o público elegível para campanhas.</small>
            </span>
            <Icon name="plus" size={18} />
          </summary>
          <form className="action-form" onSubmit={(event) => void createSegment(event)}>
            <label>
              Nome
              <Input
                minLength={2}
                onChange={(event) => setSegmentName(event.target.value)}
                required
                value={segmentName}
              />
            </label>
            <label>
              Filtro
              <NativeSelect
                onChange={(event) =>
                  setSegmentKind(event.target.value as "all" | "marketing_opt_in")
                }
                value={segmentKind}
              >
                <option value="marketing_opt_in">Marketing autorizado</option>
                <option value="all">Todos os clientes</option>
              </NativeSelect>
            </label>
            <Button disabled={busy === "segment" || segmentName.trim().length < 2} type="submit">
              Salvar segmento
            </Button>
          </form>
        </details>
      </div>
      <div className="ops-grid">
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Relacionamento</p>
              <h2>Clientes e fidelidade</h2>
            </div>
          </div>
          <RemoteGate remote={customers}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<Icon name="crm" size={28} />}
                  title="Sem clientes"
                  description="O cadastro de clientes ainda não possui registros."
                />
              ) : (
                <div className="data-list">
                  {rows.map((row) => (
                    <article className="data-row" key={row.id}>
                      <div>
                        <strong>{row.name}</strong>
                        <small>{row.email ?? row.phone ?? "Sem contato"}</small>
                        <Badge tone={row.marketingOptIn ? "success" : "neutral"}>
                          {row.marketingOptIn ? "Marketing autorizado" : "Sem opt-in"}
                        </Badge>
                      </div>
                      <div className="data-row__end">
                        {balanceByCustomer[row.id] === undefined ? (
                          <Button
                            disabled={busy === row.id}
                            onClick={() => void loadBalance(row.id)}
                            size="sm"
                            variant="secondary"
                          >
                            Ver saldo
                          </Button>
                        ) : (
                          <strong>{balanceByCustomer[row.id]} ponto(s)</strong>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )
            }
          </RemoteGate>
        </Card>
        <Card>
          <div className="section-title">
            <div>
              <p className="eyebrow">Campanhas</p>
              <h2>Status persistido</h2>
            </div>
          </div>
          <p className="muted">
            O status abaixo vem do banco. “Bloqueada” não significa envio realizado; normalmente
            indica ausência de provedor homologado.
          </p>
          <RemoteGate remote={campaigns}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState
                  icon={<Icon name="alerts" size={28} />}
                  title="Sem campanhas"
                  description="Nenhuma campanha foi criada para esta organização."
                />
              ) : (
                <div className="data-list">
                  {rows.map((row) => (
                    <article className="data-row" key={row.id}>
                      <div>
                        <strong>{row.name}</strong>
                        <small>
                          {row.channel}
                          {row.subject ? ` · ${row.subject}` : ""}
                        </small>
                      </div>
                      <Badge
                        tone={
                          row.status === "sent"
                            ? "success"
                            : row.status === "blocked"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {row.status}
                      </Badge>
                    </article>
                  ))}
                </div>
              )
            }
          </RemoteGate>
        </Card>
      </div>
    </div>
  );
}
