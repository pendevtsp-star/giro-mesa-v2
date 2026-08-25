import { Button, Input, Label, NativeSelect } from "@giromesa/ui";
import type { Dispatch, FormEvent, SetStateAction } from "react";
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
  error,
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
  error?: string;
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
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onPlace();
  };

  return (
    <form className="public-order-flow" onSubmit={submit}>
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
        {error && (
          <p className="checkout-state checkout-state-warning" role="alert">
            {error}
          </p>
        )}
        {options.status === "ready" && (
          <>
            <fieldset className="fulfillment-options">
              <legend className="sr-only">Modalidade do pedido</legend>
              <Label>
                <Input
                  type="radio"
                  name="fulfillment"
                  checked={fulfillment === "pickup"}
                  onChange={() => onFulfillment("pickup")}
                />
                <span>
                  <b>Retirada</b>
                  <small>Sem taxa de entrega</small>
                </span>
              </Label>
              <Label>
                <Input
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
              </Label>
            </fieldset>
            <div className="checkout-grid checkout-grid-two">
              <Label>
                Nome
                <Input
                  required
                  name="customerName"
                  minLength={2}
                  autoComplete="name"
                  value={customerName}
                  onChange={(event) => onCustomerName(event.target.value)}
                  placeholder="Quem receberá o pedido"
                />
              </Label>
              <Label>
                Celular
                <Input
                  required
                  name="customerPhone"
                  minLength={10}
                  inputMode="tel"
                  autoComplete="tel"
                  value={customerPhone}
                  onChange={(event) => onCustomerPhone(event.target.value)}
                  placeholder="(00) 00000-0000"
                />
              </Label>
            </div>
            {fulfillment === "delivery" && (
              <div className="delivery-fields">
                <Label>
                  Região de entrega
                  <NativeSelect
                    required
                    name="deliveryZone"
                    value={deliveryZone}
                    onChange={(event) => onDeliveryZone(event.target.value)}
                  >
                    {options.status === "ready" &&
                      options.data.deliveryZones.map((zone) => (
                        <option key={zone.name} value={zone.name}>
                          {zone.name} · {formatMoney(zone.feeCents)}
                        </option>
                      ))}
                  </NativeSelect>
                </Label>
                {belowMinimum && (
                  <p className="checkout-state checkout-state-warning">
                    Pedido mínimo desta região: {formatMoney(selectedZone?.minimumOrderCents ?? 0)}.
                  </p>
                )}
                <div className="checkout-grid checkout-grid-address">
                  <Label className="checkout-street">
                    Rua
                    <Input
                      required
                      name="street"
                      autoComplete="address-line1"
                      value={address.street}
                      onChange={(event) => setField("street", event.target.value)}
                    />
                  </Label>
                  <Label>
                    Número
                    <Input
                      required
                      name="number"
                      value={address.number}
                      onChange={(event) => setField("number", event.target.value)}
                    />
                  </Label>
                  <Label>
                    Complemento
                    <Input
                      autoComplete="address-line2"
                      name="complement"
                      value={address.complement}
                      onChange={(event) => setField("complement", event.target.value)}
                    />
                  </Label>
                  <Label>
                    Bairro
                    <Input
                      required
                      name="neighborhood"
                      value={address.neighborhood}
                      onChange={(event) => setField("neighborhood", event.target.value)}
                    />
                  </Label>
                  <Label>
                    Cidade
                    <Input
                      required
                      name="city"
                      autoComplete="address-level2"
                      value={address.city}
                      onChange={(event) => setField("city", event.target.value)}
                    />
                  </Label>
                  <Label>
                    UF
                    <Input
                      required
                      name="state"
                      maxLength={2}
                      autoComplete="address-level1"
                      value={address.state}
                      onChange={(event) => setField("state", event.target.value.toUpperCase())}
                    />
                  </Label>
                  <Label>
                    CEP
                    <Input
                      required
                      name="postalCode"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      value={address.postalCode}
                      onChange={(event) => setField("postalCode", event.target.value)}
                    />
                  </Label>
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
            <Label className="privacy-check">
              <Input
                type="checkbox"
                name="privacyAccepted"
                required
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
            </Label>
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
      <Button
        className="place-order"
        type="submit"
        disabled={options.status !== "ready" || !cart.length || pending || belowMinimum}
      >
        {pending ? "Registrando pedido…" : "Confirmar pedido"}
      </Button>
    </form>
  );
}
