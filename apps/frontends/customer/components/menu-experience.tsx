"use client";

import { getBusinessOpenState } from "@giromesa/domain/establishment-hours";
import { Button } from "@giromesa/ui";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  classifyPublicFailure,
  isTableOrderId,
  readPresenceChallenge,
  readTableConsumption,
  readTableOrder,
  readTableSession,
  type TableSession,
  tableOrderLines,
} from "../lib/table-session";
import { CartDialog } from "./menu/CartDialog";
import { CategoryNav } from "./menu/CategoryNav";
import { MenuHeader } from "./menu/MenuHeader";
import type { OrderOptionsState } from "./menu/OrderFlow";
import { ProductDetail } from "./menu/ProductDetail";
import { ProductList } from "./menu/ProductList";
import { type ConsumptionState, PublicActions, PublicServices } from "./menu/PublicActions";
import type { TableOrderState } from "./menu/TableOrderFlow";

type Notice = { tone: "success" | "warning"; text: string } | null;
type SessionState =
  | { status: "checking" | "anonymous" | "expired" | "unavailable" }
  | { status: "presence_required"; tableLabel: string; message: string }
  | {
      status: "ready";
      tableStatus: TableSession["status"];
      tableLabel: string;
      activeTab: boolean;
      expiresAt: string;
    };
type OrderMode = "table" | "off_premise";
type CommandType = "call_waiter" | "request_check";
const TABLE_SESSION_POLL_MS = 10_000;
const tableOrderStorageKey = (menuSlug: string) => `giromesa:table-order:${menuSlug}`;

const apiBase = () => process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
const apiEnabled = () => process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED === "true";

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchTableSession(
  apiUrl: string,
  menuSlug: string,
  tableToken?: string,
  presenceCode?: string,
) {
  const response = await fetch(
    `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/table-session`,
    {
      method: tableToken ? "POST" : "GET",
      cache: "no-store",
      credentials: "include",
      ...(tableToken
        ? {
            body: JSON.stringify(presenceCode ? { presenceCode } : {}),
            headers: {
              "content-type": "application/json",
              "X-GiroMesa-Table-Token": tableToken,
            },
          }
        : {}),
    },
  );
  const payload = await responsePayload(response);
  return { response, payload, value: readTableSession(payload) };
}

function readySession(value: TableSession): SessionState {
  return {
    status: "ready",
    tableStatus: value.status,
    tableLabel: value.tableLabel,
    activeTab: value.activeTab,
    expiresAt: value.expiresAt,
  };
}

function requestFailure(action: "session" | "consumption" | "command" | "order", status: number) {
  const failure = classifyPublicFailure(status);
  if (failure === "session") return "A sessão da mesa expirou. Leia novamente o QR Code.";
  if (failure === "conflict")
    return action === "session"
      ? "Esta mesa ainda não possui uma comanda ativa."
      : "A comanda mudou ou foi encerrada. Atualize com a equipe.";
  if (failure === "rate_limit") return "Muitas tentativas seguidas. Aguarde um instante.";
  if (failure === "unavailable") return "A operação está temporariamente indisponível.";
  return "Não foi possível validar esta solicitação.";
}

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
  const [orderMode, setOrderMode] = useState<OrderMode>("off_premise");
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingCommand, setPendingCommand] = useState<CommandType | null>(null);
  const [commandAttempts, setCommandAttempts] = useState<
    Record<CommandType, MutationAttempt | null>
  >({ call_waiter: null, request_check: null });
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
  const [publicOrderPending, setPublicOrderPending] = useState(false);
  const [publicOrderError, setPublicOrderError] = useState<string>();
  const [orderAttempt, setOrderAttempt] = useState<MutationAttempt | null>(null);
  const [orderReceipt, setOrderReceipt] = useState<PublicOrderReceipt | null>(null);
  const [tableOrderAttempt, setTableOrderAttempt] = useState<MutationAttempt | null>(null);
  const [tableOrder, setTableOrder] = useState<TableOrderState>({ status: "idle" });
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  const [presenceCode, setPresenceCode] = useState("");
  const [presencePending, setPresencePending] = useState(false);
  const [consumptionOpen, setConsumptionOpen] = useState(false);
  const [consumption, setConsumption] = useState<ConsumptionState>({ status: "idle" });
  const [productError, setProductError] = useState<string>();
  const [now, setNow] = useState(() => new Date());
  const productDialog = useRef<HTMLDialogElement>(null);
  const cartDialog = useRef<HTMLDialogElement>(null);
  const restoredTableOrder = useRef(false);
  const tableToken = useRef<string | null>(null);

  const categories = useMemo(
    () => ["Todos", ...new Set(initialItems.map((item) => item.category))],
    [initialItems],
  );
  const visibleItems = useMemo(
    () => filterMenu(initialItems, category, query),
    [initialItems, category, query],
  );
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  const pricingFulfillment = orderMode === "table" ? "pickup" : fulfillment;
  const openState = useMemo(
    () =>
      branding?.businessHours && branding.timezone
        ? getBusinessOpenState(branding.businessHours, branding.timezone, now)
        : undefined,
    [branding?.businessHours, branding?.timezone, now],
  );

  const loadConsumption = useCallback(async () => {
    const apiUrl = apiBase();
    if (!apiUrl || !apiEnabled()) {
      setConsumption({ status: "error", message: "Consulta de consumo indisponível." });
      return null;
    }
    setConsumption({ status: "loading" });
    try {
      const response = await fetch(
        `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/consumption`,
        { cache: "no-store", credentials: "include" },
      );
      const payload = await responsePayload(response);
      const value = readTableConsumption(payload);
      if (!response.ok || !value) {
        const message = requestFailure("consumption", response.status);
        if (classifyPublicFailure(response.status) === "session") {
          setSession({ status: "expired" });
        }
        setConsumption({ status: "error", message });
        return null;
      }
      setConsumption({ status: "ready", data: value });
      return value;
    } catch {
      setConsumption({
        status: "error",
        message: "Não foi possível atualizar o consumo. Tente novamente.",
      });
      return null;
    }
  }, [menuSlug]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const apiUrl = apiBase();
    const scannedToken = readTableAccessToken(window.location.search, window.location.hash);
    tableToken.current = scannedToken;
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    fragment.delete("mesa");
    url.hash = fragment.toString();
    url.searchParams.delete("mesa");
    url.searchParams.delete("token");
    url.searchParams.delete("table");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );

    if (!apiUrl || !apiEnabled()) {
      setSession({ status: scannedToken ? "unavailable" : "anonymous" });
      return;
    }
    const resolvedApiUrl = apiUrl;

    async function bootstrap() {
      try {
        const { response, payload, value } = await fetchTableSession(
          resolvedApiUrl,
          menuSlug,
          scannedToken ?? undefined,
        );
        if (!active) return;
        if (!response.ok || !value) {
          const presence = readPresenceChallenge(payload);
          if (scannedToken && presence) {
            setSession({ status: "presence_required", ...presence });
            return;
          }
          const sessionFailure = classifyPublicFailure(response.status) === "session";
          setSession({
            status: sessionFailure ? (scannedToken ? "expired" : "anonymous") : "unavailable",
          });
          return;
        }
        tableToken.current = null;
        setSession(readySession(value));
        setOrderMode("table");
        if (value.activeTab) void loadConsumption();
      } catch {
        if (active) {
          setSession({ status: scannedToken ? "unavailable" : "anonymous" });
        }
      }
    }
    void bootstrap();
    return () => {
      active = false;
    };
  }, [loadConsumption, menuSlug]);

  async function confirmPresence() {
    const apiUrl = apiBase();
    const scannedToken = tableToken.current;
    if (!apiUrl || !scannedToken || !/^\d{6}$/.test(presenceCode)) return;
    setPresencePending(true);
    try {
      const { response, payload, value } = await fetchTableSession(
        apiUrl,
        menuSlug,
        scannedToken,
        presenceCode,
      );
      if (!response.ok || !value) {
        const challenge = readPresenceChallenge(payload);
        setSession({
          status: "presence_required",
          tableLabel:
            challenge?.tableLabel ??
            (session.status === "presence_required" ? session.tableLabel : "Mesa"),
          message:
            response.status === 429
              ? "Muitas tentativas. Aguarde um minuto antes de tentar novamente."
              : "Código incorreto. Confira com a equipe do estabelecimento.",
        });
        return;
      }
      tableToken.current = null;
      setPresenceCode("");
      setSession(readySession(value));
      setOrderMode("table");
      if (value.activeTab) void loadConsumption();
    } catch {
      setSession((current) =>
        current.status === "presence_required"
          ? { ...current, message: "Não foi possível validar o código agora. Tente novamente." }
          : current,
      );
    } finally {
      setPresencePending(false);
    }
  }

  const awaitingTab = session.status === "ready" && !session.activeTab;
  useEffect(() => {
    const apiUrl = apiBase();
    if (!awaitingTab || !apiUrl || !apiEnabled()) return;
    const resolvedApiUrl = apiUrl;
    let active = true;
    let timer: number | undefined;

    const schedule = () => {
      if (active) timer = window.setTimeout(poll, TABLE_SESSION_POLL_MS);
    };
    async function poll() {
      timer = undefined;
      if (!active || document.hidden) return;
      try {
        const { response, value } = await fetchTableSession(resolvedApiUrl, menuSlug);
        if (!active) return;
        if (!response.ok || !value) {
          if (classifyPublicFailure(response.status) === "session") {
            setSession({ status: "expired" });
            return;
          }
        } else if (value.activeTab) {
          setSession(readySession(value));
          setOrderMode("table");
          void loadConsumption();
          return;
        }
      } catch {
        // Mantém a sessão visível e tenta novamente no próximo intervalo.
      }
      schedule();
    }

    const onVisibility = () => {
      if (!document.hidden && timer === undefined) void poll();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [awaitingTab, loadConsumption, menuSlug]);

  useEffect(() => {
    const apiUrl = apiBase();
    if (!apiUrl || !apiEnabled()) {
      setOrderOptions({ status: "unavailable" });
      return;
    }
    let active = true;
    fetch(`${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/order-options`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const options = readPublicOrderOptions(await responsePayload(response));
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

  useEffect(() => {
    if (session.status !== "ready" || !session.activeTab || restoredTableOrder.current) return;
    restoredTableOrder.current = true;
    const orderId = window.sessionStorage.getItem(tableOrderStorageKey(menuSlug));
    if (!isTableOrderId(orderId)) {
      window.sessionStorage.removeItem(tableOrderStorageKey(menuSlug));
      return;
    }
    const apiUrl = apiBase();
    if (!apiUrl || !apiEnabled()) return;
    let active = true;
    void fetch(
      `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/table-orders/${encodeURIComponent(orderId)}`,
      { cache: "no-store", credentials: "include" },
    )
      .then(async (response) => ({
        response,
        order: readTableOrder(await responsePayload(response)),
      }))
      .then(({ response, order }) => {
        if (!active) return;
        if (!response.ok || !order) {
          window.sessionStorage.removeItem(tableOrderStorageKey(menuSlug));
          return;
        }
        setTableOrder({ status: "tracking", order });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [menuSlug, session]);

  const trackedOrder = tableOrder.status === "tracking" ? tableOrder.order : null;
  useEffect(() => {
    if (trackedOrder?.status !== "draft") return;
    const orderId = trackedOrder.orderId;
    const apiUrl = apiBase();
    if (!apiUrl || !apiEnabled()) return;
    let active = true;
    let timer: number | undefined;
    let polling = false;

    async function poll() {
      if (!active || document.hidden || polling) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      polling = true;
      try {
        const response = await fetch(
          `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/table-orders/${encodeURIComponent(orderId)}`,
          { cache: "no-store", credentials: "include" },
        );
        const payload = await responsePayload(response);
        const next = readTableOrder(payload);
        if (!response.ok || !next) {
          if (classifyPublicFailure(response.status) === "session") {
            setSession({ status: "expired" });
            setTableOrder({ status: "error", message: requestFailure("order", response.status) });
            return;
          }
        } else {
          setTableOrder({ status: "tracking", order: next });
          if (next.status === "sent") {
            setNotice({ tone: "success", text: "A equipe confirmou o pedido da mesa." });
            void loadConsumption();
            return;
          }
          if (next.status === "canceled") {
            setNotice({
              tone: "warning",
              text: "O pedido da mesa não foi confirmado. Fale com a equipe para ajustar.",
            });
            return;
          }
          if (next.status !== "draft") return;
        }
      } catch {
        // A solicitação permanece em rascunho; a próxima leitura tenta novamente.
      } finally {
        polling = false;
      }
      if (active) timer = window.setTimeout(poll, 3_000);
    }

    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    timer = window.setTimeout(poll, 3_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadConsumption, menuSlug, trackedOrder]);

  function openProduct(item: MenuItem) {
    setSelected(item);
    setSelection({});
    setQuantity(1);
    setNotes("");
    setProductError(undefined);
    window.setTimeout(() => productDialog.current?.showModal(), 0);
  }

  function closeProduct() {
    productDialog.current?.close();
    setSelected(null);
    setProductError(undefined);
  }

  function toggleModifier(group: ModifierGroup, modifier: Modifier) {
    setProductError(undefined);
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
      setProductError("Escolha as opções obrigatórias antes de adicionar.");
      return;
    }
    const modifiers = Object.values(selection).flat();
    setOrderReceipt(null);
    if (tableOrder.status === "tracking" && tableOrder.order.status !== "draft") {
      setTableOrder({ status: "idle" });
    }
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

  function openCart(mode?: OrderMode) {
    if (mode) setOrderMode(mode);
    setCartOpen(true);
    window.setTimeout(() => cartDialog.current?.showModal(), 0);
  }

  function closeCart() {
    cartDialog.current?.close();
    setCartOpen(false);
    setPublicOrderError(undefined);
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

  async function sendCommand(type: CommandType) {
    if (pendingCommand || session.status !== "ready") return;
    const apiUrl = apiBase();
    if (!apiUrl || !apiEnabled()) return;
    const serialized = JSON.stringify({ type, payload: {} });
    const attempt = resolveMutationAttempt(commandAttempts[type], serialized, () =>
      crypto.randomUUID(),
    );
    setCommandAttempts((current) => ({ ...current, [type]: attempt }));
    setPendingCommand(type);
    try {
      const response = await fetch(
        `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/commands`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": attempt.key,
          },
          body: serialized,
        },
      );
      const payload = await responsePayload(response);
      if (!response.ok || !isCommandAccepted(payload)) {
        if (classifyPublicFailure(response.status) === "session") {
          setSession({ status: "expired" });
        }
        throw new Error(requestFailure("command", response.status));
      }
      setCommandAttempts((current) => ({ ...current, [type]: null }));
      setNotice({
        tone: "success",
        text:
          type === "call_waiter"
            ? "A equipe recebeu o chamado da mesa."
            : "A equipe recebeu o pedido da conta.",
      });
    } catch (error) {
      setNotice({
        tone: "warning",
        text: error instanceof Error ? error.message : "Não foi possível confirmar a solicitação.",
      });
    } finally {
      setPendingCommand(null);
    }
  }

  async function placeTableOrder() {
    if (!cart.length || session.status !== "ready" || !session.activeTab) return;
    const apiUrl = apiBase();
    if (!apiUrl || !apiEnabled()) return;
    const serialized = JSON.stringify({ items: tableOrderLines(cart) });
    const attempt = resolveMutationAttempt(tableOrderAttempt, serialized, () =>
      crypto.randomUUID(),
    );
    setTableOrderAttempt(attempt);
    setTableOrder({ status: "submitting" });
    try {
      const response = await fetch(
        `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/table-orders`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": attempt.key,
          },
          body: serialized,
        },
      );
      const payload = await responsePayload(response);
      const order = readTableOrder(payload);
      if (!response.ok || !order) {
        if (classifyPublicFailure(response.status) === "session") {
          setSession({ status: "expired" });
        }
        throw new Error(requestFailure("order", response.status));
      }
      setTableOrder({ status: "tracking", order });
      setTableOrderAttempt(null);
      window.sessionStorage.setItem(tableOrderStorageKey(menuSlug), order.orderId);
      setCart([]);
      setNotice({
        tone: "success",
        text: "Pedido enviado para revisão. Aguarde a confirmação da equipe.",
      });
    } catch (error) {
      setTableOrder({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível enviar o pedido para confirmação.",
      });
    }
  }

  async function placePublicOrder() {
    if (!cart.length || orderOptions.status !== "ready") return;
    if (customerName.trim().length < 2 || customerPhone.trim().length < 10 || !privacyAccepted) {
      setPublicOrderError("Revise os campos obrigatórios antes de confirmar.");
      return;
    }
    const apiUrl = apiBase();
    if (!apiUrl || !apiEnabled()) return;
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
    setPublicOrderPending(true);
    setPublicOrderError(undefined);
    try {
      const response = await fetch(
        `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/orders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
          body: serialized,
        },
      );
      const payload = await responsePayload(response);
      const receipt = readPublicOrderReceipt(payload);
      if (!response.ok || !receipt) throw new Error("Pedido sem confirmação persistida");
      setOrderReceipt(receipt);
      setOrderAttempt(null);
      setCart([]);
      setNotice({
        tone: "success",
        text: `Pedido ${receipt.protocol} registrado. Pagamento na retirada ou entrega.`,
      });
    } catch {
      setPublicOrderError(
        "O pedido não foi confirmado. Revise os dados e tente novamente; a mesma tentativa é idempotente.",
      );
    } finally {
      setPublicOrderPending(false);
    }
  }

  const selectedModifiers = Object.values(selection).flat();
  const selectedUnitPrice = selected
    ? itemPrice(selected, pricingFulfillment) +
      selectedModifiers.reduce((sum, option) => sum + option.priceCents, 0)
    : 0;

  return (
    <main
      className={`menu-app ${session.status === "ready" ? "has-table-session" : ""}`}
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
        hub={
          session.status === "checking"
            ? "checking"
            : session.status === "ready"
              ? "online"
              : "offline"
        }
        branding={branding}
        open={openState?.open}
        tableAuthorized={session.status === "ready"}
        tableLabel={session.status === "ready" ? session.tableLabel : undefined}
        onInfo={() =>
          setNotice({
            tone: "success",
            text: "Cardápio e informações publicados por esta unidade.",
          })
        }
      />
      <PublicActions
        sessionStatus={session.status}
        tableLabel={
          session.status === "ready" || session.status === "presence_required"
            ? session.tableLabel
            : undefined
        }
        activeTab={session.status === "ready" && session.activeTab}
        presenceCode={presenceCode}
        presenceMessage={session.status === "presence_required" ? session.message : undefined}
        presencePending={presencePending}
        pending={pendingCommand}
        consumptionOpen={consumptionOpen}
        consumption={consumption}
        onCallWaiter={() => void sendCommand("call_waiter")}
        onRequestCheck={() => void sendCommand("request_check")}
        onToggleConsumption={() => {
          const next = !consumptionOpen;
          setConsumptionOpen(next);
          if (next && consumption.status !== "ready") void loadConsumption();
        }}
        onRefreshConsumption={() => void loadConsumption()}
        onOpenTableOrder={() => openCart("table")}
        onPresenceCodeChange={setPresenceCode}
        onConfirmPresence={() => void confirmPresence()}
      />
      <CategoryNav
        categories={categories}
        category={category}
        query={query}
        onCategory={setCategory}
        onQuery={setQuery}
      />
      <ProductList category={category} items={visibleItems} onOpen={openProduct} />
      <PublicServices menuSlug={menuSlug} onOpenCart={() => openCart("off_premise")} />
      {count > 0 && (
        <Button type="button" className="cart-bar" onClick={() => openCart()}>
          <span>
            <b>{count}</b> Ver seleção
          </span>
          <strong>{formatMoney(cartTotal(cart, pricingFulfillment))}</strong>
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
        error={productError}
        onClose={closeProduct}
        onDismiss={() => {
          setSelected(null);
          setProductError(undefined);
        }}
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
        mode={orderMode}
        tableAvailable={session.status === "ready" && session.activeTab}
        tableOrder={tableOrder}
        options={orderOptions}
        fulfillment={fulfillment}
        customerName={customerName}
        customerPhone={customerPhone}
        deliveryZone={deliveryZone}
        address={address}
        privacyAccepted={privacyAccepted}
        pending={publicOrderPending}
        publicOrderError={publicOrderError}
        onClose={closeCart}
        onDismiss={() => {
          setCartOpen(false);
          setPublicOrderError(undefined);
        }}
        onQuantity={changeQuantity}
        onMode={setOrderMode}
        onFulfillment={setFulfillment}
        onCustomerName={setCustomerName}
        onCustomerPhone={setCustomerPhone}
        onDeliveryZone={setDeliveryZone}
        setAddress={setAddress}
        onPrivacy={setPrivacyAccepted}
        onPlace={() => void placePublicOrder()}
        onPlaceTableOrder={() => void placeTableOrder()}
      />
    </main>
  );
}
