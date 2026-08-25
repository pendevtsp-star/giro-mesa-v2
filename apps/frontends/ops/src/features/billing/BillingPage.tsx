import { Badge, Button, Card, commercialEntitlementLabels, EmptyState } from "@giromesa/ui";
import { useCallback, useState } from "react";
import { api } from "../../api";
import { dateLabel, type ManagementScope, RemoteGate, useRemote } from "../../management.shared";
import { routeHref } from "../../router";
import { formatMoney } from "../../rules";
import {
  type BillingCycle,
  type BillingSummary,
  outstandingCharge,
  parseBillingCheckout,
  parseBillingSummary,
  parseUpgradeQuote,
  type UpgradeQuote,
} from "./billing";
import "./billing.css";

const statePresentation = {
  draft: {
    label: "Sem assinatura",
    tone: "neutral",
    message: "Escolha um plano publicado para iniciar a assinatura.",
  },
  onboarding: {
    label: "Ativação em andamento",
    tone: "info",
    message: "A configuração da conta ainda está em andamento.",
  },
  trial_active: {
    label: "Período de teste",
    tone: "info",
    message: "Assine antes do fim do teste para manter o acesso sem interrupções.",
  },
  active: {
    label: "Assinatura ativa",
    tone: "success",
    message: "Seu plano está ativo e a renovação segue o ciclo contratado.",
  },
  grace: {
    label: "Pagamento em atraso",
    tone: "warning",
    message: "Regularize a cobrança pendente para evitar restrições no acesso.",
  },
  restricted: {
    label: "Acesso restrito",
    tone: "danger",
    message: "A operação está restrita até a confirmação do pagamento.",
  },
  suspended: {
    label: "Conta suspensa",
    tone: "danger",
    message: "Regularize a cobrança para solicitar a restauração do acesso.",
  },
  canceled: {
    label: "Assinatura cancelada",
    tone: "neutral",
    message: "Escolha um plano para voltar a usar o GiroMesa.",
  },
} as const;

const accessLabels: Record<string, string> = {
  full: "Acesso operacional completo",
  finish_shift: "Somente conclusão do turno",
  read_billing_export_support: "Consulta, cobrança, exportação e suporte",
  none: "Sem acesso operacional",
};

const chargeLabels: Record<string, string> = {
  pending: "Pendente",
  overdue: "Vencida",
  paid: "Paga",
  received: "Recebida",
  confirmed: "Confirmada",
  refunded: "Estornada",
  canceled: "Cancelada",
};

type ActivationItem = NonNullable<BillingSummary["onboarding"]>["missingItems"][number];

const activationPresentation: Record<
  ActivationItem,
  { label: string; description: string; href: string }
> = {
  business: {
    label: "Dados do estabelecimento",
    description: "Identificação, contatos e informações do negócio.",
    href: routeHref("settings"),
  },
  unit: {
    label: "Unidade configurada",
    description: "Endereço, horários e dados operacionais da unidade.",
    href: routeHref("settings"),
  },
  catalog: {
    label: "Cardápio pronto para operar",
    description: "Produtos, categorias, preços e disponibilidade revisados.",
    href: routeHref("catalog"),
  },
  team: {
    label: "Equipe e acessos",
    description: "Pessoas, funções e permissões necessárias cadastradas.",
    href: routeHref("people"),
  },
  production: {
    label: "Fluxo de produção",
    description: "Praças e estações da cozinha preparadas no KDS.",
    href: "#/kds/settings",
  },
  cashier: {
    label: "Caixa e formas de recebimento",
    description: "Regras de caixa e meios aceitos pelo estabelecimento revisados.",
    href: routeHref("cash"),
  },
  fiscalChoice: {
    label: "Decisão sobre emissão fiscal",
    description: "Uso de documentos fiscais definido para a operação.",
    href: "#/fiscal/setup",
  },
  training: {
    label: "Treinamento da equipe",
    description: "Responsáveis orientados para atendimento, produção e caixa.",
    href: routeHref("settings"),
  },
  rehearsal: {
    label: "Ensaio da operação",
    description: "Fluxo completo de pedido, produção e fechamento conferido.",
    href: routeHref("salon"),
  },
};

function chargeTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (["paid", "received", "confirmed"].includes(status)) return "success";
  if (status === "overdue") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

function cycleLabel(cycle: BillingCycle | null) {
  return cycle === "monthly" ? "Mensal" : cycle === "annual" ? "Anual" : "Não contratado";
}

function paymentMethodLabel(method: "credit_card" | "pix" | null) {
  return method === "credit_card" ? "Cartão" : method === "pix" ? "Pix" : "Não informado";
}

export function BillingPage({ scope }: { scope: ManagementScope }) {
  const loader = useCallback((organizationId: string) => api.billing.summary(organizationId), []);
  const remote = useRemote(scope, loader, parseBillingSummary);

  return (
    <RemoteGate remote={remote}>
      {(summary) => (
        <BillingContent
          organizationId={scope.organizationId}
          refresh={remote.retry}
          summary={summary}
        />
      )}
    </RemoteGate>
  );
}

export function BillingContent({
  organizationId,
  refresh,
  summary,
}: {
  organizationId: string;
  refresh: () => void;
  summary: BillingSummary;
}) {
  const [cycle, setCycle] = useState<BillingCycle>(summary.current?.cycle ?? "monthly");
  const [quote, setQuote] = useState<UpgradeQuote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = statePresentation[summary.state];
  const pendingCharge = outstandingCharge(summary);
  const pendingActivation = summary.onboarding?.missingItems ?? [];
  const nextActivation = pendingActivation[0] ? activationPresentation[pendingActivation[0]] : null;
  const activationMessage =
    summary.state === "onboarding" && summary.onboarding
      ? pendingActivation.length === 0
        ? "As etapas iniciais foram concluídas. Finalize a ativação do período de teste."
        : `${pendingActivation.length} ${pendingActivation.length === 1 ? "etapa pendente" : "etapas pendentes"} para liberar o período de teste.`
      : state.message;
  const needsRegularization = ["grace", "restricted", "suspended"].includes(summary.state);
  const unavailableReason =
    summary.actions.unavailableReason ??
    (!summary.actions.onlinePaymentsEnabled ? "Pagamento online ainda não habilitado." : null);

  async function createCheckout(
    key: string,
    input:
      | { intent: "subscribe"; planSlug: string; cycle: BillingCycle }
      | { intent: "regularize"; chargeId: string }
      | { intent: "upgrade"; quoteId: string },
  ) {
    setBusy(key);
    setError(null);
    try {
      const checkout = parseBillingCheckout(
        await api.billing.createCheckout(organizationId, input),
      );
      window.location.assign(checkout.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o checkout.");
    } finally {
      setBusy(null);
    }
  }

  async function quoteUpgrade(targetPlanSlug: string) {
    setBusy(`quote:${targetPlanSlug}`);
    setError(null);
    setQuote(null);
    try {
      setQuote(
        parseUpgradeQuote(await api.billing.createUpgradeQuote(organizationId, targetPlanSlug)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível calcular o upgrade.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="billing-page">
      <Card className={`billing-alert billing-alert--${state.tone}`} role="status">
        <div>
          <Badge tone={state.tone}>{state.label}</Badge>
          <strong>{activationMessage}</strong>
          <span>{accessLabels[summary.access] ?? summary.access}</span>
        </div>
        {summary.state === "active" && summary.current?.renewsAutomatically && (
          <Badge tone="success">Renovação automática</Badge>
        )}
      </Card>

      {summary.state === "onboarding" && summary.onboarding && nextActivation && (
        <Card className="billing-onboarding" aria-labelledby="billing-onboarding-title">
          <header className="billing-onboarding__header">
            <div>
              <span className="eyebrow">Ativação inicial</span>
              <h2 id="billing-onboarding-title">O que falta configurar</h2>
              <p>Estas são as pendências registradas para esta organização.</p>
            </div>
            <Badge tone="warning">
              {pendingActivation.length}{" "}
              {pendingActivation.length === 1 ? "pendência" : "pendências"}
            </Badge>
          </header>
          <ul className="billing-onboarding__list">
            {pendingActivation.map((item) => {
              const presentation = activationPresentation[item];
              return (
                <li key={item}>
                  <div>
                    <strong>{presentation.label}</strong>
                    <span>{presentation.description}</span>
                  </div>
                  <a href={presentation.href}>Abrir</a>
                </li>
              );
            })}
          </ul>
          <div className="billing-onboarding__actions">
            <a className="gm-button gm-button--primary gm-button--sm" href={nextActivation.href}>
              Continuar configuração
            </a>
          </div>
        </Card>
      )}

      {summary.missingSections.length > 0 && (
        <div className="billing-feedback billing-feedback--warning" role="alert">
          Dados parciais: {summary.missingSections.join(", ")} não puderam ser carregados.
        </div>
      )}
      {error && (
        <div className="billing-feedback billing-feedback--danger" role="alert">
          {error}
        </div>
      )}

      {summary.current ? (
        <Card className="billing-current">
          <header>
            <div>
              <span className="eyebrow">
                {summary.current.source === "trial" ? "Plano em teste" : "Plano atual"}
              </span>
              <h2>{summary.current.plan.name}</h2>
            </div>
            <Badge tone={summary.current.source === "trial" ? "info" : "success"}>
              {cycleLabel(summary.current.cycle)}
            </Badge>
          </header>
          <dl className="billing-current__facts">
            <div>
              <dt>Valor contratado</dt>
              <dd>
                {summary.current.priceCents === null
                  ? "Não informado"
                  : formatMoney(summary.current.priceCents)}
              </dd>
            </div>
            <div>
              <dt>
                {summary.current.source === "trial"
                  ? "Fim do teste"
                  : summary.current.renewsAutomatically
                    ? "Próxima renovação"
                    : "Fim do período"}
              </dt>
              <dd>{dateLabel(summary.current.periodEndsAt)}</dd>
            </div>
            <div>
              <dt>Pagamento</dt>
              <dd>{paymentMethodLabel(summary.current.paymentMethod)}</dd>
            </div>
            <div>
              <dt>Unidades incluídas</dt>
              <dd>{summary.current.plan.includedUnits}</dd>
            </div>
          </dl>
          <ul className="billing-entitlements" aria-label="Recursos incluídos no plano atual">
            {summary.current.plan.entitlements.map((item) => (
              <li key={item}>
                {commercialEntitlementLabels[item] ?? "Recurso adicional do plano"}
              </li>
            ))}
          </ul>
          {needsRegularization && pendingCharge && (
            <footer>
              <Button
                disabled={
                  busy !== null ||
                  !summary.actions.onlinePaymentsEnabled ||
                  !summary.actions.canRegularize
                }
                onClick={() =>
                  void createCheckout("regularize", {
                    intent: "regularize",
                    chargeId: pendingCharge.id,
                  })
                }
                title={unavailableReason ?? undefined}
              >
                {busy === "regularize" ? "Abrindo checkout…" : "Regularizar pagamento"}
              </Button>
            </footer>
          )}
        </Card>
      ) : (
        <EmptyState
          icon="◇"
          title="Nenhuma assinatura vigente"
          description="Os planos publicados estão disponíveis abaixo. A ativação ocorre somente após a confirmação do pagamento."
        />
      )}

      {unavailableReason && (
        <div className="billing-feedback billing-feedback--info" role="status">
          {unavailableReason}
        </div>
      )}

      <section aria-labelledby="billing-plans-title" className="billing-section">
        <header className="billing-section__heading">
          <div>
            <h2 id="billing-plans-title">Planos disponíveis</h2>
            <p>Preços e recursos publicados pelo catálogo comercial.</p>
          </div>
          <label>
            Ciclo
            <select
              onChange={(event) => setCycle(event.target.value as BillingCycle)}
              value={cycle}
            >
              <option value="monthly">Mensal</option>
              <option value="annual">Anual</option>
            </select>
          </label>
        </header>

        {summary.plans.length === 0 ? (
          <EmptyState
            icon="◇"
            title="Planos indisponíveis"
            description="Nenhum plano publicado foi retornado pelo servidor."
          />
        ) : (
          <div className="billing-plans">
            {summary.plans.map((plan) => {
              const subscribeIntent =
                summary.current === null ||
                summary.state === "canceled" ||
                (summary.current?.source === "trial" && plan.current);
              const upgradeIntent = plan.upgradeEligible;
              return (
                <Card
                  className={plan.current ? "billing-plan billing-plan--current" : "billing-plan"}
                  key={plan.id}
                >
                  <header>
                    <div>
                      <h3>{plan.name}</h3>
                      <span>{plan.includedUnits} unidade(s) incluída(s)</span>
                    </div>
                    {plan.current && <Badge tone="info">Atual</Badge>}
                  </header>
                  <strong className="billing-plan__price">
                    {formatMoney(
                      cycle === "monthly" ? plan.monthlyPriceCents : plan.annualPriceCents,
                    )}
                    <small>/{cycle === "monthly" ? "mês" : "ano"}</small>
                  </strong>
                  <ul>
                    {plan.entitlements.map((item) => (
                      <li key={item}>
                        {commercialEntitlementLabels[item] ?? "Recurso adicional do plano"}
                      </li>
                    ))}
                  </ul>
                  {subscribeIntent ? (
                    <Button
                      disabled={
                        busy !== null ||
                        !summary.actions.onlinePaymentsEnabled ||
                        !summary.actions.canSubscribe
                      }
                      onClick={() =>
                        void createCheckout(`subscribe:${plan.slug}`, {
                          intent: "subscribe",
                          planSlug: plan.slug,
                          cycle,
                        })
                      }
                      title={unavailableReason ?? undefined}
                    >
                      {busy === `subscribe:${plan.slug}` ? "Abrindo checkout…" : "Assinar agora"}
                    </Button>
                  ) : upgradeIntent ? (
                    <Button
                      disabled={
                        busy !== null ||
                        !summary.actions.onlinePaymentsEnabled ||
                        !summary.actions.canUpgrade
                      }
                      onClick={() => void quoteUpgrade(plan.slug)}
                      title={unavailableReason ?? undefined}
                      variant="secondary"
                    >
                      {busy === `quote:${plan.slug}` ? "Calculando…" : "Fazer upgrade"}
                    </Button>
                  ) : (
                    <Button disabled variant="secondary">
                      {plan.current && summary.current?.renewsAutomatically
                        ? "Renovação automática"
                        : "Indisponível"}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {quote && (
        <Card className="billing-quote" role="status">
          <div>
            <span className="eyebrow">Cotação de upgrade</span>
            <h2>{formatMoney(quote.amountCents)} agora</h2>
            <p>
              Diferença proporcional até {dateLabel(quote.periodEndsAt)}. Cotação válida até{" "}
              {dateLabel(quote.expiresAt)}.
            </p>
          </div>
          <div className="billing-quote__actions">
            <Button onClick={() => setQuote(null)} variant="ghost">
              Cancelar
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() =>
                void createCheckout("upgrade", { intent: "upgrade", quoteId: quote.id })
              }
            >
              {busy === "upgrade" ? "Abrindo checkout…" : "Continuar no checkout"}
            </Button>
          </div>
        </Card>
      )}

      <section aria-labelledby="billing-charges-title" className="billing-section">
        <header className="billing-section__heading">
          <div>
            <h2 id="billing-charges-title">Cobranças recentes</h2>
            <p>Histórico persistido da assinatura da organização.</p>
          </div>
          <Button disabled={busy !== null} onClick={refresh} size="sm" variant="ghost">
            Atualizar
          </Button>
        </header>
        {summary.charges.length === 0 ? (
          <EmptyState
            icon="◇"
            title="Nenhuma cobrança registrada"
            description="As cobranças aparecerão aqui quando forem criadas pelo provedor."
          />
        ) : (
          <Card className="billing-charges">
            <div className="billing-charges__scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Vencimento</th>
                    <th scope="col">Valor</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.charges.map((charge) => (
                    <tr key={charge.id}>
                      <td>{dateLabel(charge.dueAt)}</td>
                      <td>{formatMoney(charge.amountCents)}</td>
                      <td>
                        <Badge tone={chargeTone(charge.status)}>
                          {chargeLabels[charge.status] ?? charge.status}
                        </Badge>
                      </td>
                      <td>{charge.paidAt ? dateLabel(charge.paidAt) : "Não confirmado"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
