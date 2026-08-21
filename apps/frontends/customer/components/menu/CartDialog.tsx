import { Button } from "@giromesa/ui";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CartItem } from "../../lib/menu";
import type { PublicOrderReceipt } from "../../lib/public-order";
import { CartSummary } from "./CartSummary";
import { type AddressState, OrderFlow, type OrderOptionsState } from "./OrderFlow";

export function CartDialog({
  dialogRef,
  open,
  cart,
  receipt,
  options,
  fulfillment,
  customerName,
  customerPhone,
  deliveryZone,
  address,
  privacyAccepted,
  pending,
  canPlace,
  onClose,
  onDismiss,
  onQuantity,
  onFulfillment,
  onCustomerName,
  onCustomerPhone,
  onDeliveryZone,
  setAddress,
  onPrivacy,
  onPlace,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  open: boolean;
  cart: CartItem[];
  receipt: PublicOrderReceipt | null;
  options: OrderOptionsState;
  fulfillment: "pickup" | "delivery";
  customerName: string;
  customerPhone: string;
  deliveryZone: string;
  address: AddressState;
  privacyAccepted: boolean;
  pending: boolean;
  canPlace: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onQuantity: (lineId: string, delta: number) => void;
  onFulfillment: (value: "pickup" | "delivery") => void;
  onCustomerName: (value: string) => void;
  onCustomerPhone: (value: string) => void;
  onDeliveryZone: (value: string) => void;
  setAddress: Dispatch<SetStateAction<AddressState>>;
  onPrivacy: (value: boolean) => void;
  onPlace: () => void;
}) {
  return (
    <dialog className="cart-dialog" ref={dialogRef} onClose={onDismiss}>
      {open && (
        <div className="cart-shell">
          <header>
            <div>
              <p>Sua seleção</p>
              <h2>Revisar pedido</h2>
            </div>
            <Button type="button" variant="ghost" aria-label="Fechar seleção" onClick={onClose}>
              ×
            </Button>
          </header>
          <CartSummary
            cart={cart}
            receipt={receipt}
            fulfillment={fulfillment}
            onQuantity={onQuantity}
          />
          {!receipt && (
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
              canPlace={canPlace}
              onFulfillment={onFulfillment}
              onCustomerName={onCustomerName}
              onCustomerPhone={onCustomerPhone}
              onDeliveryZone={onDeliveryZone}
              setAddress={setAddress}
              onPrivacy={onPrivacy}
              onPlace={onPlace}
            />
          )}
        </div>
      )}
    </dialog>
  );
}
