export function PublicActions({
  menuSlug,
  tableAuthorized,
  pending,
  onCallWaiter,
  onRequestCheck,
  onOpenCart,
}: {
  menuSlug: string;
  tableAuthorized: boolean;
  pending: boolean;
  onCallWaiter: () => void;
  onRequestCheck: () => void;
  onOpenCart: () => void;
}) {
  return (
    <>
      <section className="table-actions" aria-labelledby="table-actions-title">
        <div>
          <p>Precisa da equipe?</p>
          <h2 id="table-actions-title">Atendimento na mesa</h2>
        </div>
        {tableAuthorized ? (
          <div>
            <button type="button" disabled={pending} onClick={onCallWaiter}>
              <span aria-hidden="true">♢</span>Chamar garçom
            </button>
            <button type="button" disabled={pending} onClick={onRequestCheck}>
              <span aria-hidden="true">▤</span>Pedir a conta
            </button>
          </div>
        ) : (
          <p>Leia o QR Code da mesa para chamar a equipe ou pedir a conta.</p>
        )}
      </section>
      <section className="public-services" aria-labelledby="public-services-title">
        <div className="public-services-heading">
          <p>Outros canais</p>
          <h2 id="public-services-title">O que já pode ser feito por aqui</h2>
        </div>
        <div className="service-grid">
          <Service
            title="Reserva"
            state="Solicitação pública"
            action="Solicitar reserva →"
            href={`/m/${menuSlug}/servicos#reserva`}
          >
            Envie uma solicitação persistida para a unidade. A equipe ainda precisa confirmar o
            horário.
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
            Monte o pedido no cardápio, escolha retirada ou entrega própria e pague somente no
            recebimento. Preços e taxa são validados pela unidade.
          </Service>
          <article className="service-card service-card-locked">
            <span className="service-state">Prova de posse pendente</span>
            <h3 className="service-card-title">Saldo de fidelidade</h3>
            <p className="service-card-copy">
              A consulta exige OTP por e-mail ou WhatsApp para não expor perfil e saldo de
              terceiros.
            </p>
          </article>
          <Service
            title="Preferências de comunicação"
            state="Serviço público"
            action="Gerenciar preferência →"
            href="/preferencias"
          >
            Recebeu um link de descadastro? Valide o token no endpoint público de opt-out.
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
  children: React.ReactNode;
}) {
  return (
    <article className="service-card service-card-public">
      <span className="service-state">{state}</span>
      <h3 className="service-card-title">{title}</h3>
      <p className="service-card-copy">{children}</p>
      {href ? (
        <a className="service-card-action" href={href}>
          {action}
        </a>
      ) : (
        <button
          className="service-card-action service-card-button"
          type="button"
          onClick={onAction}
        >
          {action}
        </button>
      )}
    </article>
  );
}
