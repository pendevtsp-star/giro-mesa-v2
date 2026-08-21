import { type CartItem, cartLineTotal, cartTotal, formatMoney } from "../../lib/menu";
import type { PublicOrderReceipt } from "../../lib/public-order";

export function CartSummary({
  cart,
  receipt,
  fulfillment,
  onQuantity,
}: {
  cart: CartItem[];
  receipt: PublicOrderReceipt | null;
  fulfillment: "pickup" | "delivery";
  onQuantity: (lineId: string, delta: number) => void;
}) {
  if (receipt) {
    return (
      <section className="order-receipt" aria-live="polite">
        <span aria-hidden="true">✓</span>
        <p>Pedido recebido</p>
        <h3>{receipt.protocol}</h3>
        <dl>
          <div>
            <dt>Modalidade</dt>
            <dd>{receipt.fulfillment === "pickup" ? "Retirada" : "Entrega própria"}</dd>
          </div>
          <div>
            <dt>Total confirmado</dt>
            <dd>{formatMoney(receipt.totalCents)}</dd>
          </div>
          <div>
            <dt>Pagamento</dt>
            <dd>Aguardando pagamento na retirada ou entrega</dd>
          </div>
        </dl>
        <p className="service-note">
          Guarde este protocolo. Nenhum pagamento online foi realizado.
        </p>
      </section>
    );
  }

  return (
    <div className="cart-lines">
      {cart.map((line) => (
        <article key={line.lineId}>
          <span className="cart-visual" aria-hidden="true">
            {line.item.visual}
          </span>
          <div>
            <h3>{line.item.name}</h3>
            {line.modifiers.length > 0 && (
              <p>{line.modifiers.map((modifier) => modifier.name).join(", ")}</p>
            )}
            {line.notes && <small>Obs.: {line.notes}</small>}
            <strong>{formatMoney(cartLineTotal(line, fulfillment))}</strong>
          </div>
          <div className="quantity">
            <Button
              type="button"
              aria-label={`Remover uma unidade de ${line.item.name}`}
              onClick={() => onQuantity(line.lineId, -1)}
            >
              −
            </Button>
            <output>{line.quantity}</output>
            <Button
              type="button"
              aria-label={`Adicionar uma unidade de ${line.item.name}`}
              onClick={() => onQuantity(line.lineId, 1)}
            >
              +
            </Button>
          </div>
        </article>
      ))}
      {!cart.length && <p className="checkout-state">Sua seleção está vazia.</p>}
      {cart.length > 0 && (
        <span className="sr-only">Subtotal {formatMoney(cartTotal(cart, fulfillment))}</span>
      )}
    </div>
  );
}

import { Button } from "@giromesa/ui";
