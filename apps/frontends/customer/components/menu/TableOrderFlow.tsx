import { Button } from "@giromesa/ui";
import type { FormEvent } from "react";
import { type CartItem, cartTotal, formatMoney } from "../../lib/menu";
import type { TableOrder } from "../../lib/table-session";

export type TableOrderState =
  | { status: "idle" | "submitting" }
  | { status: "error"; message: string }
  | { status: "tracking"; order: TableOrder };

const orderStatus: Record<TableOrder["status"], { title: string; copy: string; tone: string }> = {
  draft: {
    title: "Aguardando confirmação",
    copy: "O pedido ainda não foi enviado à produção. A equipe precisa revisar e confirmar.",
    tone: "warning",
  },
  sent: {
    title: "Pedido confirmado",
    copy: "A equipe confirmou o pedido e o enviou para produção.",
    tone: "success",
  },
  canceled: {
    title: "Pedido não confirmado",
    copy: "A equipe recusou ou cancelou esta solicitação. Fale com o garçom para ajustar.",
    tone: "danger",
  },
  preparing: {
    title: "Em preparo",
    copy: "Seu pedido está sendo preparado.",
    tone: "success",
  },
  ready: {
    title: "Pedido pronto",
    copy: "Seu pedido está pronto para ser servido.",
    tone: "success",
  },
  served: {
    title: "Pedido servido",
    copy: "A operação marcou este pedido como servido.",
    tone: "success",
  },
};

export function TableOrderFlow({
  cart,
  state,
  onPlace,
}: {
  cart: CartItem[];
  state: TableOrderState;
  onPlace: () => void;
}) {
  if (state.status === "tracking") {
    const status = orderStatus[state.order.status];
    return (
      <section className={`table-order-receipt ${status.tone}`} aria-live="polite">
        <p>Pedido na mesa</p>
        <h3>{status.title}</h3>
        <span>{status.copy}</span>
        <ul>
          {state.order.items.map((item) => (
            <li key={`${item.name}-${item.quantity}-${item.totalCents}`}>
              <span>
                {item.quantity}× {item.name}
              </span>
              <strong>{formatMoney(item.totalCents)}</strong>
            </li>
          ))}
        </ul>
        <div>
          <span>Total confirmado</span>
          <strong>{formatMoney(state.order.totalCents)}</strong>
        </div>
      </section>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onPlace();
  }

  return (
    <form className="table-order-flow" onSubmit={submit}>
      <div>
        <p className="overline">Pedido na mesa</p>
        <h3>Enviar para confirmação</h3>
        <p>
          A equipe revisará disponibilidade, valores e observações. O pedido só seguirá para a
          cozinha depois da confirmação.
        </p>
      </div>
      {state.status === "error" && (
        <p role="alert" className="checkout-state checkout-state-warning">
          {state.message}
        </p>
      )}
      <div className="cart-summary checkout-total">
        <span>Total estimado</span>
        <strong>{formatMoney(cartTotal(cart))}</strong>
      </div>
      <Button
        className="place-order"
        type="submit"
        disabled={!cart.length || state.status === "submitting"}
      >
        {state.status === "submitting" ? "Enviando para a equipe…" : "Solicitar confirmação"}
      </Button>
    </form>
  );
}
