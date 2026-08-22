"use client";

import { getBusinessOpenState } from "@giromesa/domain/establishment-hours";
import { Button } from "@giromesa/ui";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { PublicMenuBranding } from "../lib/api";
import {
  type CartItem,
  cartTotal,
  filterMenu,
  formatMoney,
  itemPrice,
  type MenuItem,
  type Modifier,
  type ModifierGroup,
} from "../lib/menu";
import {
  isCommandAccepted,
  type MutationAttempt,
  readTableAccessToken,
  resolveMutationAttempt,
} from "../lib/public-contracts";
import {
  type PublicOrderReceipt,
  publicOrderLines,
  readPublicOrderOptions,
  readPublicOrderReceipt,
} from "../lib/public-order";
import { CartDialog } from "./menu/CartDialog";
import { CategoryNav } from "./menu/CategoryNav";
import { MenuHeader } from "./menu/MenuHeader";
import type { OrderOptionsState } from "./menu/OrderFlow";
import { ProductDetail } from "./menu/ProductDetail";
import { ProductList } from "./menu/ProductList";
import { PublicActions } from "./menu/PublicActions";

type HubState = "checking" | "online" | "offline";
type Notice = { tone: "success" | "warning"; text: string } | null;

export function MenuExperience({
  initialItems,
  menuSlug,
  branding,
}: {
  initialItems: MenuItem[];
  menuSlug: string;
  branding?: PublicMenuBranding;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todos");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [selection, setSelection] = useState<Record<string, Modifier[]>>({});
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [hub, setHub] = useState<HubState>("checking");
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingCommand, setPendingCommand] = useState<
    "public_order" | "call_waiter" | "request_check" | null
  >(null);
  const [orderOptions, setOrderOptions] = useState<OrderOptionsState>({ status: "loading" });
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryZone, setDeliveryZone] = useState("");
  const [address, setAddress] = useState({
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    postalCode: "",
  });
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [orderAttempt, setOrderAttempt] = useState<MutationAttempt | null>(null);
  const [orderReceipt, setOrderReceipt] = useState<PublicOrderReceipt | null>(null);
  const [tableAccessToken, setTableAccessToken] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const productDialog = useRef<HTMLDialogElement>(null);
  const cartDialog = useRef<HTMLDialogElement>(null);

  const categories = useMemo(
    () => ["Todos", ...new Set(initialItems.map((item) => item.category))],
    [initialItems],
  );
  const visibleItems = useMemo(
    () => filterMenu(initialItems, category, query),
    [initialItems, category, query],
  );
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  const openState = useMemo(
    () =>
      branding?.businessHours && branding.timezone
        ? getBusinessOpenState(branding.businessHours, branding.timezone, now)
        : undefined,
    [branding?.businessHours, branding?.timezone, now],
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const token = readTableAccessToken(window.location.search);
    setTableAccessToken(token);
    if (!token) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("mesa");
    url.searchParams.delete("token");
    url.searchParams.delete("table");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  useEffect(() => {
    let active = true;
    const apiUrl = process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
    const apiEnabled = process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED === "true";
    async function checkHub() {
      if (!apiUrl || !apiEnabled) {
        if (active) setHub("offline");
        return;
      }
      try {
        const response = await fetch(
          `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/hub-status`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as { acknowledged?: boolean };
        if (active) setHub(response.ok && payload.acknowledged ? "online" : "offline");
      } catch {
        if (active) setHub("offline");
      }
    }
    void checkHub();
    const timer = window.setInterval(checkHub, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [menuSlug]);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
    const apiEnabled = process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED === "true";
    if (!apiUrl || !apiEnabled) {
      setOrderOptions({ status: "unavailable" });
      return;
    }
    let active = true;
    fetch(`${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/order-options`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const options = readPublicOrderOptions(await response.json());
        if (!response.ok || !options) throw new Error("Opções indisponíveis");
        if (active) {
          setOrderOptions({ status: "ready", data: options });
          setDeliveryZone(options.deliveryZones[0]?.name ?? "");
        }
      })
      .catch(() => active && setOrderOptions({ status: "unavailable" }));
    return () => {
      active = false;
    };
  }, [menuSlug]);

  function openProduct(item: MenuItem) {
    setSelected(item);
    setSelection({});
    setQuantity(1);
    setNotes("");
    window.setTimeout(() => productDialog.current?.showModal(), 0);
  }

  function closeProduct() {
    productDialog.current?.close();
    setSelected(null);
  }

  function toggleModifier(group: ModifierGroup, modifier: Modifier) {
    setSelection((current) => {
      const selectedOptions = current[group.id] ?? [];
      const exists = selectedOptions.some((option) => option.id === modifier.id);
      if (exists)
        return {
          ...current,
          [group.id]: selectedOptions.filter((option) => option.id !== modifier.id),
        };
      if (group.maxSelections === 1) return { ...current, [group.id]: [modifier] };
      if (selectedOptions.length >= group.maxSelections) return current;
      return { ...current, [group.id]: [...selectedOptions, modifier] };
    });
  }

  function addToCart() {
    if (!selected) return;
    const missing = selected.modifierGroups?.some(
      (group) => group.required && !selection[group.id]?.length,
    );
    if (missing) {
      setNotice({ tone: "warning", text: "Escolha as opções obrigatórias antes de adicionar." });
      return;
    }
    const modifiers = Object.values(selection).flat();
    setOrderReceipt(null);
    setCart((current) => [
      ...current,
      {
        lineId: crypto.randomUUID(),
        item: selected,
        quantity,
        modifiers,
        notes: notes.trim() || undefined,
      },
    ]);
    setNotice({ tone: "success", text: `${selected.name} foi adicionado à seleção.` });
    closeProduct();
  }

  function openCart() {
    setCartOpen(true);
    window.setTimeout(() => cartDialog.current?.showModal(), 0);
  }
  function closeCart() {
    cartDialog.current?.close();
    setCartOpen(false);
  }
  function changeQuantity(lineId: string, delta: number) {
    setCart((current) =>
      current.flatMap((line) =>
        line.lineId !== lineId
          ? [line]
          : line.quantity + delta > 0
            ? [{ ...line, quantity: line.quantity + delta }]
            : [],
      ),
    );
  }

  async function sendCommand(type: "call_waiter" | "request_check", payload: object = {}) {
    if (pendingCommand) return false;
    if (hub !== "online") {
      setNotice({
        tone: "warning",
        text: "Atendimento digital pausado. Chame a equipe presencialmente.",
      });
      return false;
    }
    if (!tableAccessToken) {
      setNotice({ tone: "warning", text: "Leia novamente o QR Code disponível na mesa." });
      return false;
    }
    const apiUrl = process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
    const apiEnabled = process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED === "true";
    if (!apiUrl || !apiEnabled) return false;
    setPendingCommand(type);
    try {
      const response = await fetch(
        `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/commands`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
            "X-GiroMesa-Table-Token": tableAccessToken,
          },
          body: JSON.stringify({ type, payload }),
        },
      );
      const result: unknown = await response.json();
      if (!response.ok || !isCommandAccepted(result)) throw new Error("Sem confirmação do hub");
      setNotice({
        tone: "success",
        text:
          type === "call_waiter"
            ? "A equipe recebeu o chamado da mesa."
            : "A operação recebeu o pedido da conta.",
      });
      return true;
    } catch {
      setHub("offline");
      setNotice({
        tone: "warning",
        text: "Não recebemos confirmação da operação. Nenhum pedido foi registrado.",
      });
      return false;
    } finally {
      setPendingCommand(null);
    }
  }

  async function placePublicOrder() {
    if (!cart.length) return;
    if (orderOptions.status !== "ready") {
      setNotice({ tone: "warning", text: "Pedidos públicos não estão disponíveis agora." });
      return;
    }
    const apiUrl = process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
    if (!apiUrl || process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED !== "true") return;
    const body = {
      fulfillment,
      customer: { name: customerName.trim(), phone: customerPhone.trim() },
      items: publicOrderLines(cart),
      ...(fulfillment === "delivery"
        ? {
            deliveryZone,
            address: {
              street: address.street.trim(),
              number: address.number.trim(),
              ...(address.complement.trim() ? { complement: address.complement.trim() } : {}),
              neighborhood: address.neighborhood.trim(),
              city: address.city.trim(),
              state: address.state.trim().toUpperCase(),
              postalCode: address.postalCode.trim(),
            },
          }
        : {}),
      paymentMethod: "pay_on_fulfillment",
      privacyAccepted,
      policyVersion: "2026-08-public-order",
    };
    const serialized = JSON.stringify(body);
    const attempt = resolveMutationAttempt(orderAttempt, serialized, () => crypto.randomUUID());
    setOrderAttempt(attempt);
    setPendingCommand("public_order");
    try {
      const response = await fetch(
        `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/orders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
          body: serialized,
        },
      );
      const payload: unknown = await response.json();
      const receipt = readPublicOrderReceipt(payload);
      if (!response.ok || !receipt) throw new Error("Pedido sem confirmação persistida");
      setOrderReceipt(receipt);
      setCart([]);
      setNotice({
        tone: "success",
        text: `Pedido ${receipt.protocol} registrado. Pagamento aguardando retirada ou entrega.`,
      });
    } catch {
      setNotice({
        tone: "warning",
        text: "O pedido não foi confirmado. Revise os dados e tente novamente; a mesma tentativa é idempotente.",
      });
    } finally {
      setPendingCommand(null);
    }
  }

  const selectedModifiers = Object.values(selection).flat();
  const selectedUnitPrice = selected
    ? itemPrice(selected, fulfillment) +
      selectedModifiers.reduce((sum, option) => sum + option.priceCents, 0)
    : 0;
  const selectedZone =
    orderOptions.status === "ready"
      ? orderOptions.data.deliveryZones.find((zone) => zone.name === deliveryZone)
      : undefined;
  const deliveryAddressComplete = Object.entries(address)
    .filter(([key]) => key !== "complement")
    .every(([, value]) => value.trim().length > 0);
  const canPlacePublicOrder =
    orderOptions.status === "ready" &&
    customerName.trim().length >= 2 &&
    customerPhone.trim().length >= 10 &&
    privacyAccepted &&
    (fulfillment === "pickup" || Boolean(selectedZone && deliveryAddressComplete));

  return (
    <main
      className="menu-app"
      style={
        branding?.primaryColor || branding?.accentColor
          ? ({
              "--restaurant-brand": branding.primaryColor,
              "--restaurant-accent": branding.accentColor,
            } as CSSProperties)
          : undefined
      }
    >
      <a className="skip-link" href="#cardapio">
        Pular para o cardápio
      </a>
      <MenuHeader
        hub={hub}
        branding={branding}
        open={openState?.open}
        tableAuthorized={Boolean(tableAccessToken)}
        onInfo={() =>
          setNotice({
            tone: "success",
            text: "Cardápio publicado pela unidade. Solicitações dependem da confirmação operacional.",
          })
        }
      />
      <CategoryNav
        categories={categories}
        category={category}
        query={query}
        onCategory={setCategory}
        onQuery={setQuery}
      />
      <ProductList category={category} items={visibleItems} onOpen={openProduct} />
      <PublicActions
        menuSlug={menuSlug}
        tableAuthorized={Boolean(tableAccessToken)}
        pending={pendingCommand !== null}
        onCallWaiter={() => void sendCommand("call_waiter")}
        onRequestCheck={() => void sendCommand("request_check")}
        onOpenCart={openCart}
      />
      {count > 0 && (
        <Button type="button" className="cart-bar" onClick={openCart}>
          <span>
            <b>{count}</b> Ver seleção
          </span>
          <strong>{formatMoney(cartTotal(cart, fulfillment))}</strong>
        </Button>
      )}
      {notice && (
        <div className={`toast ${notice.tone}`} role="status">
          <span>{notice.text}</span>
          <Button
            type="button"
            variant="ghost"
            aria-label="Fechar aviso"
            onClick={() => setNotice(null)}
          >
            ×
          </Button>
        </div>
      )}
      <ProductDetail
        dialogRef={productDialog}
        selected={selected}
        selection={selection}
        notes={notes}
        quantity={quantity}
        unitPrice={selectedUnitPrice}
        onClose={closeProduct}
        onDismiss={() => setSelected(null)}
        onToggleModifier={toggleModifier}
        onNotes={setNotes}
        onQuantity={setQuantity}
        onAdd={addToCart}
      />
      <CartDialog
        dialogRef={cartDialog}
        open={cartOpen}
        cart={cart}
        receipt={orderReceipt}
        options={orderOptions}
        fulfillment={fulfillment}
        customerName={customerName}
        customerPhone={customerPhone}
        deliveryZone={deliveryZone}
        address={address}
        privacyAccepted={privacyAccepted}
        pending={pendingCommand === "public_order"}
        canPlace={canPlacePublicOrder}
        onClose={closeCart}
        onDismiss={() => setCartOpen(false)}
        onQuantity={changeQuantity}
        onFulfillment={setFulfillment}
        onCustomerName={setCustomerName}
        onCustomerPhone={setCustomerPhone}
        onDeliveryZone={setDeliveryZone}
        setAddress={setAddress}
        onPrivacy={setPrivacyAccepted}
        onPlace={() => void placePublicOrder()}
      />
    </main>
  );
}
