import type { Dispatch, SetStateAction } from "react";
import { type CartItem, cartTotal, formatMoney } from "../../lib/menu";
import type { PublicOrderOptions } from "../../lib/public-order";

export type AddressState = {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
};

export type OrderOptionsState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; data: PublicOrderOptions };

export function OrderFlow({
  cart,
  options,
  fulfillment,
  customerName,
  customerPhone,
  deliveryZone,
  address,
  privacyAccepted,
  pending,
  canPlace,
  onFulfillment,
  onCustomerName,
  onCustomerPhone,
  onDeliveryZone,
  setAddress,
  onPrivacy,
  onPlace,
}: {
  cart: CartItem[];
  options: OrderOptionsState;
  fulfillment: "pickup" | "delivery";
  customerName: string;
  customerPhone: string;
  deliveryZone: string;
  address: AddressState;
  privacyAccepted: boolean;
  pending: boolean;
  canPlace: boolean;
  onFulfillment: (value: "pickup" | "delivery") => void;
  onCustomerName: (value: string) => void;
  onCustomerPhone: (value: string) => void;
  onDeliveryZone: (value: string) => void;
  setAddress: Dispatch<SetStateAction<AddressState>>;
  onPrivacy: (value: boolean) => void;
  onPlace: () => void;
}) {
  const selectedZone =
    options.status === "ready"
      ? options.data.deliveryZones.find((zone) => zone.name === deliveryZone)
      : undefined;
  const belowMinimum =
    fulfillment === "delivery" &&
    Boolean(selectedZone && cartTotal(cart, fulfillment) < selectedZone.minimumOrderCents);
  const setField = (field: keyof AddressState, value: string) =>
    setAddress((current) => ({ ...current, [field]: value }));

  return (
    <>
      <section className="checkout-form" aria-labelledby="checkout-title">
        <div>
          <p className="overline">Dados do pedido</p>
          <h3 id="checkout-title">Como você quer receber?</h3>
        </div>
        {options.status === "loading" && (
          <p className="checkout-state">Consultando modalidades da unidade…</p>
        )}
        {options.status === "unavailable" && (
          <p className="checkout-state checkout-state-warning">
            Esta unidade ainda não habilitou pedidos públicos.
          </p>
        )}
        {options.status === "ready" && (
          <>
            <fieldset className="fulfillment-options">
              <legend className="sr-only">Modalidade do pedido</legend>
              <label>
                <input
                  type="radio"
                  name="fulfillment"
                  checked={fulfillment === "pickup"}
                  onChange={() => onFulfillment("pickup")}
                />
                <span>
                  <b>Retirada</b>
                  <small>Sem taxa de entrega</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="fulfillment"
                  checked={fulfillment === "delivery"}
                  disabled={options.status === "ready" && options.data.deliveryZones.length === 0}
                  onChange={() => onFulfillment("delivery")}
                />
                <span>
                  <b>Entrega própria</b>
                  <small>Taxa conforme a região</small>
                </span>
              </label>
            </fieldset>
            <div className="checkout-grid checkout-grid-two">
              <label>
                Nome
                <input
                  required
                  autoComplete="name"
                  value={customerName}
                  onChange={(event) => onCustomerName(event.target.value)}
                  placeholder="Quem receberá o pedido"
                />
              </label>
              <label>
                Celular
                <input
                  required
                  inputMode="tel"
                  autoComplete="tel"
                  value={customerPhone}
                  onChange={(event) => onCustomerPhone(event.target.value)}
                  placeholder="(00) 00000-0000"
                />
              </label>
            </div>
            {fulfillment === "delivery" && (
              <div className="delivery-fields">
                <label>
                  Região de entrega
                  <select
                    required
                    value={deliveryZone}
                    onChange={(event) => onDeliveryZone(event.target.value)}
                  >
                    {options.status === "ready" &&
                      options.data.deliveryZones.map((zone) => (
                        <option key={zone.name} value={zone.name}>
                          {zone.name} · {formatMoney(zone.feeCents)}
                        </option>
                      ))}
                  </select>
                </label>
                {belowMinimum && (
                  <p className="checkout-state checkout-state-warning">
                    Pedido mínimo desta região: {formatMoney(selectedZone?.minimumOrderCents ?? 0)}.
                  </p>
                )}
                <div className="checkout-grid checkout-grid-address">
                  <label className="checkout-street">
                    Rua
                    <input
                      required
                      autoComplete="address-line1"
                      value={address.street}
                      onChange={(event) => setField("street", event.target.value)}
                    />
                  </label>
                  <label>
                    Número
                    <input
                      required
                      value={address.number}
                      onChange={(event) => setField("number", event.target.value)}
                    />
                  </label>
                  <label>
                    Complemento
                    <input
                      autoComplete="address-line2"
                      value={address.complement}
                      onChange={(event) => setField("complement", event.target.value)}
                    />
                  </label>
                  <label>
                    Bairro
                    <input
                      required
                      value={address.neighborhood}
                      onChange={(event) => setField("neighborhood", event.target.value)}
                    />
                  </label>
                  <label>
                    Cidade
                    <input
                      required
                      autoComplete="address-level2"
                      value={address.city}
                      onChange={(event) => setField("city", event.target.value)}
                    />
                  </label>
                  <label>
                    UF
                    <input
                      required
                      maxLength={2}
                      autoComplete="address-level1"
                      value={address.state}
                      onChange={(event) => setField("state", event.target.value.toUpperCase())}
                    />
                  </label>
                  <label>
                    CEP
                    <input
                      required
                      inputMode="numeric"
                      autoComplete="postal-code"
                      value={address.postalCode}
                      onChange={(event) => setField("postalCode", event.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}
            <div className="payment-callout">
              <span aria-hidden="true">▣</span>
              <div>
                <b>Pagamento na {fulfillment === "pickup" ? "retirada" : "entrega"}</b>
                <small>O GiroMesa não solicitará cartão nem Pix nesta etapa.</small>
              </div>
            </div>
            <label className="privacy-check">
              <input
                type="checkbox"
                checked={privacyAccepted}
                onChange={(event) => onPrivacy(event.target.checked)}
              />
              <span>
                Aceito o uso dos dados para preparar e entregar este pedido, conforme a{" "}
                <a href="/privacidade" target="_blank" rel="noreferrer">
                  Política de Privacidade
                </a>
                .
              </span>
            </label>
          </>
        )}
      </section>
      <div className="cart-summary checkout-total">
        <span>Total estimado</span>
        <strong>
          {formatMoney(
            cartTotal(cart, fulfillment) +
              (fulfillment === "delivery" ? (selectedZone?.feeCents ?? 0) : 0),
          )}
        </strong>
        {fulfillment === "delivery" && selectedZone && (
          <small>Inclui {formatMoney(selectedZone.feeCents)} de entrega.</small>
        )}
      </div>
      <p className="service-note">
        O servidor confirma preços, disponibilidade, pedido mínimo e taxa antes de registrar.
      </p>
      <button
        className="place-order"
        type="button"
        disabled={!canPlace || !cart.length || pending || belowMinimum}
        onClick={onPlace}
      >
        {pending ? "Registrando pedido…" : "Confirmar pedido"}
      </button>
    </>
  );
}
