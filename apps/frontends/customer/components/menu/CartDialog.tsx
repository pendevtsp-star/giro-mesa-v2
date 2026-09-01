import { Button } from "@giromesa/ui";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CartItem } from "../../lib/menu";
import type { PublicOrderReceipt } from "../../lib/public-order";
import { CartSummary } from "./CartSummary";
import { type AddressState, OrderFlow, type OrderOptionsState } from "./OrderFlow";
import { TableOrderFlow, type TableOrderState } from "./TableOrderFlow";

export function CartDialog({
  dialogRef,
  open,
  cart,
  receipt,
  mode,
  tableAvailable,
  tableOrder,
  options,
  fulfillment,
  customerName,
  customerPhone,
  deliveryZone,
  address,
  privacyAccepted,
  pending,
  publicOrderError,
  onClose,
  onDismiss,
  onQuantity,
  onMode,
  onFulfillment,
  onCustomerName,
  onCustomerPhone,
  onDeliveryZone,
  setAddress,
  onPrivacy,
  onPlace,
  onPlaceTableOrder,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  open: boolean;
  cart: CartItem[];
  receipt: PublicOrderReceipt | null;
  mode: "table" | "off_premise";
  tableAvailable: boolean;
  tableOrder: TableOrderState;
  options: OrderOptionsState;
  fulfillment: "pickup" | "delivery";
  customerName: string;
  customerPhone: string;
  deliveryZone: string;
  address: AddressState;
  privacyAccepted: boolean;
  pending: boolean;
  publicOrderError?: string;
  onClose: () => void;
  onDismiss: () => void;
  onQuantity: (lineId: string, delta: number) => void;
  onMode: (value: "table" | "off_premise") => void;
  onFulfillment: (value: "pickup" | "delivery") => void;
  onCustomerName: (value: string) => void;
  onCustomerPhone: (value: string) => void;
  onDeliveryZone: (value: string) => void;
  setAddress: Dispatch<SetStateAction<AddressState>>;
  onPrivacy: (value: boolean) => void;
  onPlace: () => void;
  onPlaceTableOrder: () => void;
}) {
  const tableTracking = mode === "table" && tableOrder.status === "tracking";
  return (
    <dialog
      className="cart-dialog"
      ref={dialogRef}
      aria-labelledby="cart-dialog-title"
      onClose={onDismiss}
    >
      {open && (
        <div className="cart-shell">
          <header>
            <div>
              <h2 id="cart-dialog-title">Revisar pedido</h2>
            </div>
            <Button type="button" variant="ghost" aria-label="Fechar seleção" onClick={onClose}>
              ×
            </Button>
          </header>
          <fieldset className="order-mode-options">
            <legend>Onde será o pedido?</legend>
            <label>
              <input
                type="radio"
                name="order-mode"
                checked={mode === "table"}
                disabled={!tableAvailable}
                onChange={() => onMode("table")}
              />
              <span>
                <b>Nesta mesa</b>
                <small>Exige confirmação da equipe</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="order-mode"
                checked={mode === "off_premise"}
                onChange={() => onMode("off_premise")}
              />
              <span>
                <b>Retirada ou delivery</b>
                <small>Pedido público separado</small>
              </span>
            </label>
          </fieldset>
          {!tableTracking && (
            <CartSummary
              cart={cart}
              receipt={mode === "off_premise" ? receipt : null}
              fulfillment={mode === "table" ? "pickup" : fulfillment}
              onQuantity={onQuantity}
            />
          )}
          {mode === "table" && !tableAvailable ? (
            <p className="checkout-state checkout-state-warning" role="status">
              O pedido na mesa será liberado quando a equipe abrir a comanda.
            </p>
          ) : mode === "table" ? (
            <TableOrderFlow cart={cart} state={tableOrder} onPlace={onPlaceTableOrder} />
          ) : !receipt ? (
            <OrderFlow
              cart={cart}
              options={options}
              fulfillment={fulfillment}
              customerName={customerName}
              customerPhone={customerPhone}
              deliveryZone={deliveryZone}
              address={address}
              privacyAccepted={privacyAccepted}
              pending={pending}
              error={publicOrderError}
              onFulfillment={onFulfillment}
              onCustomerName={onCustomerName}
              onCustomerPhone={onCustomerPhone}
              onDeliveryZone={onDeliveryZone}
              setAddress={setAddress}
              onPrivacy={onPrivacy}
              onPlace={onPlace}
            />
          ) : null}
        </div>
      )}
    </dialog>
  );
}
