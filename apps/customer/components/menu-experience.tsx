"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CartItem,
  cartTotal,
  filterMenu,
  formatMoney,
  type MenuItem,
  type Modifier,
  type ModifierGroup,
} from "../lib/menu";
import {
  isCommandAccepted,
  type MutationAttempt,
  resolveMutationAttempt,
} from "../lib/public-contracts";
import {
  type PublicOrderOptions,
  type PublicOrderReceipt,
  publicOrderLines,
  readPublicOrderOptions,
  readPublicOrderReceipt,
} from "../lib/public-order";
import { withCustomerPwaMutation } from "./pwa-client";

type HubState = "checking" | "online" | "offline";
type Notice = { tone: "success" | "warning"; text: string } | null;
type OrderOptionsState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; data: PublicOrderOptions };

export function MenuExperience({
  initialItems,
  menuSlug,
  demo,
}: {
  initialItems: MenuItem[];
  menuSlug: string;
  demo: boolean;
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
  const demoAck = demo && process.env.NEXT_PUBLIC_DEMO_HUB_ACK === "true";

  useEffect(() => {
    let active = true;
    const apiUrl = process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
    const apiEnabled = process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED === "true";
    async function checkHub() {
      if (demoAck) {
        if (active) setHub("online");
        return;
      }
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
  }, [demoAck, menuSlug]);

  useEffect(() => {
    if (demo) {
      setOrderOptions({ status: "unavailable" });
      return;
    }
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
  }, [demo, menuSlug]);

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
    if (demoAck) {
      setNotice({
        tone: "success",
        text: "Ação demonstrada. Nenhum chamado real foi enviado.",
      });
      return true;
    }
    const apiUrl = process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
    const apiEnabled = process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED === "true";
    if (!apiUrl || !apiEnabled) return false;
    setPendingCommand(type);
    try {
      return await withCustomerPwaMutation(async () => {
        const response = await fetch(
          `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/commands`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify({ type, payload }),
          },
        );
        const result: unknown = await response.json();
        if (!response.ok || !isCommandAccepted(result)) {
          throw new Error("Sem confirmação do hub");
        }
        setNotice({
          tone: "success",
          text:
            type === "call_waiter"
              ? "A equipe recebeu o chamado da mesa."
              : "A operação recebeu o pedido da conta.",
        });
        return true;
      });
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
    if (demo) {
      setNotice({
        tone: "success",
        text: "Fluxo demonstrado. Nenhum pedido real foi enviado.",
      });
      return;
    }
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
      await withCustomerPwaMutation(async () => {
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
    ? selected.priceCents + selectedModifiers.reduce((sum, option) => sum + option.priceCents, 0)
    : 0;
  const selectedZone =
    orderOptions.status === "ready"
      ? orderOptions.data.deliveryZones.find((zone) => zone.name === deliveryZone)
      : undefined;
  const deliveryAddressComplete = Object.entries(address)
    .filter(([key]) => key !== "complement")
    .every(([, value]) => value.trim().length > 0);
  const canPlacePublicOrder =
    demo ||
    (orderOptions.status === "ready" &&
      customerName.trim().length >= 2 &&
      customerPhone.trim().length >= 10 &&
      privacyAccepted &&
      (fulfillment === "pickup" || Boolean(selectedZone && deliveryAddressComplete)));

  return (
    <main className="menu-app">
      <a className="skip-link" href="#cardapio">
        Pular para o cardápio
      </a>
      <header className="restaurant-header">
        <div className="restaurant-mark" aria-hidden="true">
          A
        </div>
        <div>
          <p>{demo ? "Restaurante demonstrativo" : "Cardápio digital"}</p>
          <h1>{demo ? "Amora Cozinha" : "Cardápio da unidade"}</h1>
          <span>{demo ? "Mesa 12 · Jantar" : "Consulte os dados informados pela equipe"}</span>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Ver informações do restaurante"
          onClick={() =>
            setNotice({
              tone: "success",
              text: demo
                ? "Cardápio de demonstração do GiroMesa V2."
                : "Cardápio publicado pela unidade. Solicitações dependem da confirmação operacional.",
            })
          }
        >
          i
        </button>
      </header>

      <div className={`connection-banner ${hub}`} role="status">
        <span aria-hidden="true">{hub === "online" ? "●" : hub === "checking" ? "◌" : "!"}</span>
        <div>
          <strong>
            {hub === "online"
              ? "Atendimento da mesa disponível"
              : hub === "checking"
                ? "Confirmando atendimento…"
                : "Chamados da mesa temporariamente pausados"}
          </strong>
          <small>
            {hub === "online"
              ? "A operação está confirmando chamados e pedidos de conta."
              : "O cardápio e o checkout público continuam disponíveis quando habilitados."}
          </small>
        </div>
      </div>
      {demo && <p className="demo-label">Cardápio com dados demonstrativos</p>}

      <section className="menu-toolbar" aria-label="Filtros do cardápio">
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Buscar no cardápio</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar pratos e ingredientes"
          />
        </label>
        <fieldset className="category-fieldset">
          <legend className="sr-only">Categorias</legend>
          <div className="category-list">
            {categories.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section id="cardapio" className="menu-content" tabIndex={-1}>
        <div className="section-title">
          <div>
            <p>Descubra a casa</p>
            <h2>{category === "Todos" ? "Nosso cardápio" : category}</h2>
          </div>
          <span>
            {visibleItems.length} {visibleItems.length === 1 ? "item" : "itens"}
          </span>
        </div>
        {visibleItems.length ? (
          <div className="menu-grid">
            {visibleItems.map((item) => (
              <button
                type="button"
                className="menu-card"
                key={item.id}
                onClick={() => openProduct(item)}
                aria-label={`${item.name}, ${formatMoney(item.priceCents)}${item.available ? "" : ", indisponível"}`}
              >
                <span className={`food-visual food-${item.id}`} aria-hidden="true">
                  {item.visual}
                </span>
                <span className="menu-card-copy">
                  <span className="item-name">{item.name}</span>
                  <span className="item-description">{item.description}</span>
                  <span className="item-meta">
                    <b>{formatMoney(item.priceCents)}</b>
                    {item.tags?.map((tag) => (
                      <small key={tag}>{tag}</small>
                    ))}
                  </span>
                  {!item.available && <span className="sold-out">Indisponível agora</span>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span>⌕</span>
            <h3>Nenhum item encontrado</h3>
            <p>Tente outro termo ou categoria.</p>
          </div>
        )}
      </section>

      <section className="table-actions" aria-labelledby="table-actions-title">
        <div>
          <p>Precisa da equipe?</p>
          <h2 id="table-actions-title">Atendimento na mesa</h2>
        </div>
        <div>
          <button
            type="button"
            disabled={pendingCommand !== null}
            onClick={() => void sendCommand("call_waiter")}
          >
            <span aria-hidden="true">♢</span>Chamar garçom
          </button>
          <button
            type="button"
            disabled={pendingCommand !== null}
            onClick={() => void sendCommand("request_check")}
          >
            <span aria-hidden="true">▤</span>Pedir a conta
          </button>
        </div>
      </section>
      <section className="public-services" aria-labelledby="public-services-title">
        <div className="public-services-heading">
          <p>Outros canais</p>
          <h2 id="public-services-title">O que já pode ser feito por aqui</h2>
        </div>
        <div className="service-grid">
          <article className="service-card service-card-public">
            <span className="service-state">Solicitação pública</span>
            <h3 className="service-card-title">Reserva</h3>
            <p className="service-card-copy">
              Envie uma solicitação persistida para a unidade. A equipe ainda precisa confirmar o
              horário.
            </p>
            <a className="service-card-action" href={`/m/${menuSlug}/servicos#reserva`}>
              Solicitar reserva →
            </a>
          </article>
          <article className="service-card service-card-public">
            <span className="service-state">Solicitação pública</span>
            <h3 className="service-card-title">Fila de espera</h3>
            <p className="service-card-copy">
              Registre a intenção de entrar na fila, sem promessa automática de tempo ou mesa.
            </p>
            <a className="service-card-action" href={`/m/${menuSlug}/servicos#fila`}>
              Entrar na fila →
            </a>
          </article>
          <article className="service-card service-card-public">
            <span className="service-state">Validação pública</span>
            <h3 className="service-card-title">Cupom</h3>
            <p className="service-card-copy">
              Confira uma estimativa sem consumir o cupom. A aplicação final ocorre na comanda.
            </p>
            <a className="service-card-action" href={`/m/${menuSlug}/servicos#cupom`}>
              Validar cupom →
            </a>
          </article>
          <article className="service-card service-card-public">
            <span className="service-state">Pedido persistido</span>
            <h3 className="service-card-title">Delivery e retirada</h3>
            <p className="service-card-copy">
              Monte o pedido no cardápio, escolha retirada ou entrega própria e pague somente no
              recebimento. Preços e taxa são validados pela unidade.
            </p>
            <button
              className="service-card-action service-card-button"
              type="button"
              onClick={openCart}
            >
              Revisar pedido →
            </button>
          </article>
          <article className="service-card service-card-locked">
            <span className="service-state">Prova de posse pendente</span>
            <h3 className="service-card-title">Saldo de fidelidade</h3>
            <p className="service-card-copy">
              A consulta exige OTP por e-mail ou WhatsApp para não expor perfil e saldo de
              terceiros.
            </p>
          </article>
          <article className="service-card service-card-public">
            <span className="service-state">Serviço público</span>
            <h3 className="service-card-title">Preferências de comunicação</h3>
            <p className="service-card-copy">
              Recebeu um link de descadastro? Valide o token no endpoint público de opt-out.
            </p>
            <a className="service-card-action" href="/preferencias">
              Gerenciar preferência →
            </a>
          </article>
        </div>
      </section>
      <footer className="menu-footer">
        <b>
          <span>G</span> GiroMesa
        </b>
        <p>Cardápio digital · valores em reais</p>
        <a href="/privacidade">Privacidade</a> · <a href="/preferencias">Comunicações</a>
      </footer>

      {count > 0 && (
        <button type="button" className="cart-bar" onClick={openCart}>
          <span>
            <b>{count}</b> Ver seleção
          </span>
          <strong>{formatMoney(cartTotal(cart))}</strong>
        </button>
      )}
      {notice && (
        <div className={`toast ${notice.tone}`} role="status">
          <span>{notice.text}</span>
          <button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      <dialog className="product-dialog" ref={productDialog} onClose={() => setSelected(null)}>
        {selected && (
          <div className="dialog-shell">
            <div className={`product-hero food-${selected.id}`}>
              <span aria-hidden="true">{selected.visual}</span>
              <button type="button" aria-label="Fechar" onClick={closeProduct}>
                ×
              </button>
            </div>
            <div className="dialog-content">
              <p className="overline">{selected.category}</p>
              <h2>{selected.name}</h2>
              <p>{selected.description}</p>
              <strong className="base-price">{formatMoney(selected.priceCents)}</strong>
              {selected.modifierGroups?.map((group) => (
                <fieldset key={group.id}>
                  <legend>
                    {group.name}
                    <small>{group.required ? "Obrigatório" : `Até ${group.maxSelections}`}</small>
                  </legend>
                  {group.options.map((option) => {
                    const checked = Boolean(
                      selection[group.id]?.some(
                        (selectedOption) => selectedOption.id === option.id,
                      ),
                    );
                    return (
                      <label key={option.id}>
                        <input
                          type={group.maxSelections === 1 ? "radio" : "checkbox"}
                          name={group.id}
                          checked={checked}
                          onChange={() => toggleModifier(group, option)}
                        />
                        <span>{option.name}</span>
                        <b>
                          {option.priceCents ? `+ ${formatMoney(option.priceCents)}` : "incluído"}
                        </b>
                      </label>
                    );
                  })}
                </fieldset>
              ))}
              <label className="notes">
                Alguma observação?
                <textarea
                  rows={2}
                  maxLength={180}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Ex.: sem cebola"
                />
              </label>
              <div className="add-row">
                <div className="quantity">
                  <span className="sr-only">Quantidade</span>
                  <button
                    type="button"
                    aria-label="Diminuir quantidade"
                    onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  >
                    −
                  </button>
                  <output>{quantity}</output>
                  <button
                    type="button"
                    aria-label="Aumentar quantidade"
                    onClick={() => setQuantity((value) => value + 1)}
                  >
                    +
                  </button>
                </div>
                <button
                  className="add-button"
                  type="button"
                  disabled={!selected.available}
                  onClick={addToCart}
                >
                  {selected.available ? (
                    <>
                      Adicionar <b>{formatMoney(selectedUnitPrice * quantity)}</b>
                    </>
                  ) : (
                    "Indisponível agora"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </dialog>

      <dialog className="cart-dialog" ref={cartDialog} onClose={() => setCartOpen(false)}>
        {cartOpen && (
          <div className="cart-shell">
            <header>
              <div>
                <p>Sua seleção</p>
                <h2>Revisar pedido</h2>
              </div>
              <button type="button" aria-label="Fechar seleção" onClick={closeCart}>
                ×
              </button>
            </header>
            {orderReceipt ? (
              <section className="order-receipt" aria-live="polite">
                <span aria-hidden="true">✓</span>
                <p>Pedido recebido</p>
                <h3>{orderReceipt.protocol}</h3>
                <dl>
                  <div>
                    <dt>Modalidade</dt>
                    <dd>
                      {orderReceipt.fulfillment === "pickup" ? "Retirada" : "Entrega própria"}
                    </dd>
                  </div>
                  <div>
                    <dt>Total confirmado</dt>
                    <dd>{formatMoney(orderReceipt.totalCents)}</dd>
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
            ) : (
              <>
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
                        <strong>
                          {formatMoney(
                            (line.item.priceCents +
                              line.modifiers.reduce(
                                (total, modifier) => total + modifier.priceCents,
                                0,
                              )) *
                              line.quantity,
                          )}
                        </strong>
                      </div>
                      <div className="quantity">
                        <button
                          type="button"
                          aria-label={`Remover uma unidade de ${line.item.name}`}
                          onClick={() => changeQuantity(line.lineId, -1)}
                        >
                          −
                        </button>
                        <output>{line.quantity}</output>
                        <button
                          type="button"
                          aria-label={`Adicionar uma unidade de ${line.item.name}`}
                          onClick={() => changeQuantity(line.lineId, 1)}
                        >
                          +
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <section className="checkout-form" aria-labelledby="checkout-title">
                  <div>
                    <p className="overline">Dados do pedido</p>
                    <h3 id="checkout-title">Como você quer receber?</h3>
                  </div>
                  {orderOptions.status === "loading" && (
                    <p className="checkout-state">Consultando modalidades da unidade…</p>
                  )}
                  {orderOptions.status === "unavailable" && !demo && (
                    <p className="checkout-state checkout-state-warning">
                      Esta unidade ainda não habilitou pedidos públicos.
                    </p>
                  )}
                  {(orderOptions.status === "ready" || demo) && (
                    <>
                      <fieldset className="fulfillment-options">
                        <legend className="sr-only">Modalidade do pedido</legend>
                        <label>
                          <input
                            type="radio"
                            name="fulfillment"
                            checked={fulfillment === "pickup"}
                            onChange={() => setFulfillment("pickup")}
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
                            disabled={
                              orderOptions.status === "ready" &&
                              orderOptions.data.deliveryZones.length === 0
                            }
                            onChange={() => setFulfillment("delivery")}
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
                            onChange={(event) => setCustomerName(event.target.value)}
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
                            onChange={(event) => setCustomerPhone(event.target.value)}
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
                              onChange={(event) => setDeliveryZone(event.target.value)}
                            >
                              {orderOptions.status === "ready" &&
                                orderOptions.data.deliveryZones.map((zone) => (
                                  <option key={zone.name} value={zone.name}>
                                    {zone.name} · {formatMoney(zone.feeCents)}
                                  </option>
                                ))}
                            </select>
                          </label>
                          {selectedZone && cartTotal(cart) < selectedZone.minimumOrderCents && (
                            <p className="checkout-state checkout-state-warning">
                              Pedido mínimo desta região:{" "}
                              {formatMoney(selectedZone.minimumOrderCents)}.
                            </p>
                          )}
                          <div className="checkout-grid checkout-grid-address">
                            <label className="checkout-street">
                              Rua
                              <input
                                required
                                autoComplete="address-line1"
                                value={address.street}
                                onChange={(event) =>
                                  setAddress((current) => ({
                                    ...current,
                                    street: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Número
                              <input
                                required
                                value={address.number}
                                onChange={(event) =>
                                  setAddress((current) => ({
                                    ...current,
                                    number: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Complemento
                              <input
                                autoComplete="address-line2"
                                value={address.complement}
                                onChange={(event) =>
                                  setAddress((current) => ({
                                    ...current,
                                    complement: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Bairro
                              <input
                                required
                                value={address.neighborhood}
                                onChange={(event) =>
                                  setAddress((current) => ({
                                    ...current,
                                    neighborhood: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              Cidade
                              <input
                                required
                                autoComplete="address-level2"
                                value={address.city}
                                onChange={(event) =>
                                  setAddress((current) => ({
                                    ...current,
                                    city: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              UF
                              <input
                                required
                                maxLength={2}
                                autoComplete="address-level1"
                                value={address.state}
                                onChange={(event) =>
                                  setAddress((current) => ({
                                    ...current,
                                    state: event.target.value.toUpperCase(),
                                  }))
                                }
                              />
                            </label>
                            <label>
                              CEP
                              <input
                                required
                                inputMode="numeric"
                                autoComplete="postal-code"
                                value={address.postalCode}
                                onChange={(event) =>
                                  setAddress((current) => ({
                                    ...current,
                                    postalCode: event.target.value,
                                  }))
                                }
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
                          onChange={(event) => setPrivacyAccepted(event.target.checked)}
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
                      cartTotal(cart) +
                        (fulfillment === "delivery" ? (selectedZone?.feeCents ?? 0) : 0),
                    )}
                  </strong>
                  {fulfillment === "delivery" && selectedZone && (
                    <small>Inclui {formatMoney(selectedZone.feeCents)} de entrega.</small>
                  )}
                </div>
                <p className="service-note">
                  O servidor confirma preços, disponibilidade, pedido mínimo e taxa antes de
                  registrar.
                </p>
                <button
                  className="place-order"
                  type="button"
                  disabled={
                    !canPlacePublicOrder ||
                    cart.length === 0 ||
                    pendingCommand !== null ||
                    (fulfillment === "delivery" &&
                      Boolean(selectedZone && cartTotal(cart) < selectedZone.minimumOrderCents))
                  }
                  onClick={() => void placePublicOrder()}
                >
                  {pendingCommand === "public_order"
                    ? "Registrando pedido…"
                    : demo
                      ? "Demonstrar envio do pedido"
                      : "Confirmar pedido"}
                </button>
              </>
            )}
          </div>
        )}
      </dialog>
    </main>
  );
}
