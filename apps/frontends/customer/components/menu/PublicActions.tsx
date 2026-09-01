import { Badge, Button, Input, Label } from "@giromesa/ui";
import type { ReactNode } from "react";
import { formatMoney } from "../../lib/menu";
import { type TableConsumption, tableSessionCapabilities } from "../../lib/table-session";

export type ConsumptionState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: TableConsumption };

export function PublicActions({
  sessionStatus,
  tableLabel,
  activeTab,
  presenceCode,
  presenceMessage,
  presencePending,
  pending,
  consumptionOpen,
  consumption,
  onCallWaiter,
  onRequestCheck,
  onToggleConsumption,
  onRefreshConsumption,
  onOpenTableOrder,
  onPresenceCodeChange,
  onConfirmPresence,
}: {
  sessionStatus:
    | "checking"
    | "anonymous"
    | "ready"
    | "expired"
    | "unavailable"
    | "presence_required";
  tableLabel?: string;
  activeTab: boolean;
  presenceCode: string;
  presenceMessage?: string;
  presencePending: boolean;
  pending: "call_waiter" | "request_check" | null;
  consumptionOpen: boolean;
  consumption: ConsumptionState;
  onCallWaiter: () => void;
  onRequestCheck: () => void;
  onToggleConsumption: () => void;
  onRefreshConsumption: () => void;
  onOpenTableOrder: () => void;
  onPresenceCodeChange: (value: string) => void;
  onConfirmPresence: () => void;
}) {
  const ready = sessionStatus === "ready";
  const presenceRequired = sessionStatus === "presence_required";
  const capabilities = tableSessionCapabilities(activeTab);
  return (
    <>
      <section
        className={`table-actions ${ready ? "table-actions-sticky" : ""}`}
        aria-labelledby="table-actions-title"
      >
        <div className="table-actions-heading">
          <div>
            <h2 id="table-actions-title">
              {ready || presenceRequired ? tableLabel : "Use o QR Code da mesa"}
            </h2>
          </div>
          {ready && (
            <Badge tone={activeTab ? "success" : "warning"}>
              {activeTab ? "Comanda ativa" : "Sem comanda"}
            </Badge>
          )}
          {presenceRequired && <Badge tone="warning">Código necessário</Badge>}
        </div>
        {sessionStatus === "checking" ? (
          <p className="table-actions-state" role="status">
            Confirmando a sessão segura da mesa…
          </p>
        ) : sessionStatus === "presence_required" ? (
          <form
            className="table-presence-form"
            onSubmit={(event) => {
              event.preventDefault();
              onConfirmPresence();
            }}
          >
            <p className="table-actions-state">{presenceMessage}</p>
            <Label>
              Código de presença
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) =>
                  onPresenceCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                pattern="\d{6}"
                placeholder="000000"
                required
                value={presenceCode}
              />
            </Label>
            <Button disabled={presencePending || presenceCode.length !== 6} type="submit">
              {presencePending ? "Validando…" : "Confirmar presença"}
            </Button>
          </form>
        ) : ready ? (
          <>
            <div className="table-action-grid">
              <Button
                type="button"
                disabled={!capabilities.callWaiter || pending !== null}
                onClick={onCallWaiter}
              >
                <span aria-hidden="true">◇</span>
                {pending === "call_waiter" ? "Chamando…" : "Chamar garçom"}
              </Button>
              <Button
                type="button"
                disabled={!capabilities.requestCheck || pending !== null}
                onClick={onRequestCheck}
              >
                <span aria-hidden="true">▤</span>
                {pending === "request_check" ? "Enviando…" : "Pedir conta"}
              </Button>
              <Button
                type="button"
                aria-controls="table-consumption"
                aria-expanded={consumptionOpen}
                disabled={!capabilities.viewConsumption}
                onClick={onToggleConsumption}
              >
                <span aria-hidden="true">◫</span>
                Ver consumo
              </Button>
              <Button type="button" disabled={!capabilities.placeOrder} onClick={onOpenTableOrder}>
                <span aria-hidden="true">＋</span>
                Pedir na mesa
              </Button>
            </div>
            {!activeTab && (
              <p className="table-actions-state" role="status">
                Chamar garçom está disponível; consumo, conta e pedido serão liberados quando a
                comanda abrir.
              </p>
            )}
          </>
        ) : (
          <p className="table-actions-state" role="status">
            {sessionStatus === "expired"
              ? "A sessão expirou. Leia novamente o QR Code desta mesa."
              : sessionStatus === "unavailable"
                ? "Não foi possível confirmar a mesa agora. O cardápio continua disponível."
                : "Leia o QR Code da mesa para chamar a equipe, consultar o consumo ou pedir."}
          </p>
        )}
      </section>
      {ready && consumptionOpen && (
        <TableConsumptionPanel state={consumption} onRefresh={onRefreshConsumption} />
      )}
    </>
  );
}

function TableConsumptionPanel({
  state,
  onRefresh,
}: {
  state: ConsumptionState;
  onRefresh: () => void;
}) {
  return (
    <section
      id="table-consumption"
      className="table-consumption"
      aria-labelledby="consumption-title"
    >
      <header>
        <div>
          <p>Comanda atual</p>
          <h2 id="consumption-title">Seu consumo</h2>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={state.status === "loading"}
          onClick={onRefresh}
        >
          Atualizar
        </Button>
      </header>
      {(state.status === "idle" || state.status === "loading") && (
        <p className="consumption-state" role="status">
          Consultando itens confirmados…
        </p>
      )}
      {state.status === "error" && (
        <p className="consumption-state consumption-error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "ready" && (
        <>
          {state.data.items.length ? (
            <ul className="consumption-lines">
              {state.data.items.map((item) => (
                <li key={`${item.name}-${item.quantity}-${item.totalCents}`}>
                  <span>
                    <b>{item.quantity}×</b> {item.name}
                  </span>
                  <strong>{formatMoney(item.totalCents)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="consumption-state">A comanda ainda não possui itens confirmados.</p>
          )}
          <dl className="consumption-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatMoney(state.data.subtotalCents)}</dd>
            </div>
            <div>
              <dt>Total atual</dt>
              <dd>{formatMoney(state.data.totalCents)}</dd>
            </div>
          </dl>
          <p className="consumption-note">
            Valores atualizados pela operação; itens em aprovação podem ainda não aparecer.
          </p>
        </>
      )}
    </section>
  );
}

export function PublicServices({
  menuSlug,
  onOpenCart,
}: {
  menuSlug: string;
  onOpenCart: () => void;
}) {
  return (
    <>
      <section className="public-services" aria-labelledby="public-services-title">
        <div className="public-services-heading">
          <p>Outros canais</p>
          <h2 id="public-services-title">Retirada, delivery e serviços</h2>
        </div>
        <div className="service-grid">
          <Service
            title="Reserva"
            state="Solicitação pública"
            action="Solicitar reserva →"
            href={`/m/${menuSlug}/servicos#reserva`}
          >
            Envie uma solicitação para a unidade. A equipe ainda precisa confirmar o horário.
          </Service>
          <Service
            title="Fila de espera"
            state="Solicitação pública"
            action="Entrar na fila →"
            href={`/m/${menuSlug}/servicos#fila`}
          >
            Registre a intenção de entrar na fila, sem promessa automática de tempo ou mesa.
          </Service>
          <Service
            title="Cupom"
            state="Validação pública"
            action="Validar cupom →"
            href={`/m/${menuSlug}/servicos#cupom`}
          >
            Confira uma estimativa sem consumir o cupom. A aplicação final ocorre na comanda.
          </Service>
          <Service
            title="Delivery e retirada"
            state="Pedido persistido"
            action="Revisar pedido →"
            onAction={onOpenCart}
          >
            Este fluxo é separado do pedido da mesa. Escolha retirada ou entrega própria e pague no
            recebimento.
          </Service>
          <article className="service-card service-card-locked">
            <Badge tone="warning">Prova de posse pendente</Badge>
            <h3 className="service-card-title">Saldo de fidelidade</h3>
            <p className="service-card-copy">
              A consulta exige OTP para não expor perfil e saldo de terceiros.
            </p>
          </article>
          <Service
            title="Preferências de comunicação"
            state="Serviço público"
            action="Gerenciar preferência →"
            href="/preferencias"
          >
            Recebeu um link de descadastro? Valide o token no serviço público de opt-out.
          </Service>
        </div>
      </section>
      <footer className="menu-footer">
        <b>
          <span>G</span> GiroMesa
        </b>
        <p>Cardápio digital · valores em reais</p>
        <a href="/privacidade">Privacidade</a> · <a href="/preferencias">Comunicações</a>
      </footer>
    </>
  );
}

function Service({
  title,
  state,
  action,
  href,
  onAction,
  children,
}: {
  title: string;
  state: string;
  action: string;
  href?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <article className="service-card service-card-public">
      <Badge tone="info">{state}</Badge>
      <h3 className="service-card-title">{title}</h3>
      <p className="service-card-copy">{children}</p>
      {href ? (
        <a className="service-card-action" href={href}>
          {action}
        </a>
      ) : (
        <Button
          className="service-card-action service-card-button"
          type="button"
          onClick={onAction}
        >
          {action}
        </Button>
      )}
    </article>
  );
}
