import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicMenu, normalizePublicMenuSnapshot } from "./api.ts";
import { type CartItem, cartLineTotal, cartTotal, filterMenu, type MenuItem } from "./menu.ts";
import {
  isCommandAccepted,
  isPublicSubmissionAccepted,
  normalizeOptOutToken,
  readCouponValidation,
  readTableAccessToken,
  resolveMutationAttempt,
} from "./public-contracts.ts";

const menuItems: MenuItem[] = [
  {
    id: "burger",
    category: "Principais",
    name: "Burger",
    description: "Pão e queijo",
    priceCents: 4890,
    visual: "",
    tags: ["vegetariano"],
    available: true,
  },
  {
    id: "salada",
    category: "Principais",
    name: "Salada",
    description: "Folhas",
    priceCents: 2490,
    visual: "",
    tags: ["vegetariano"],
    available: true,
  },
  {
    id: "chocolate",
    category: "Sobremesas",
    name: "Chocolate",
    description: "Chocolate e café",
    priceCents: 1990,
    visual: "",
    available: true,
  },
];

test("totaliza quantidade e adicionais em centavos", () => {
  const burger = menuItems.find((item) => item.id === "burger");
  assert.ok(burger);
  const line: CartItem = {
    lineId: "1",
    item: burger,
    quantity: 2,
    modifiers: [{ id: "bacon", name: "Bacon", priceCents: 690 }],
  };
  assert.equal(cartLineTotal(line), 11160);
  assert.equal(cartTotal([line]), 11160);
  line.item = { ...line.item, deliveryPriceCents: line.item.priceCents + 1_000 };
  assert.equal(cartLineTotal(line, "delivery"), 13160);
});

test("busca considera nome, descrição e tags", () => {
  assert.equal(filterMenu(menuItems, "Todos", "vegetariano").length, 2);
  assert.equal(filterMenu(menuItems, "Sobremesas", "café")[0]?.id, "chocolate");
});

test("rejeita cardápio remoto incompleto antes de renderizar", () => {
  assert.equal(normalizePublicMenu({ items: [{ id: "sem-campos" }] }), null);
  assert.deepEqual(normalizePublicMenu({ items: menuItems.slice(0, 1) }), menuItems.slice(0, 1));
});

test("aceita branding e versão opcionais sem confiar em metadata desconhecida", () => {
  assert.deepEqual(
    normalizePublicMenuSnapshot({
      items: menuItems.slice(0, 1),
      version: 4,
      metadata: {
        branding: {
          displayName: "  Casa Giro  ",
          slogan: "  Feito na hora ",
          logoUrl: "javascript:alert(1)",
          primaryColor: "#123abc",
          accentColor: "#fedcba",
          timezone: "America/Sao_Paulo",
          businessHours: {
            weekly: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, mode: "open24h" })),
            exceptions: [],
          },
          wifi: { password: "segredo" },
        },
        internal: { organizationId: "não deve vazar" },
      },
    }),
    {
      items: menuItems.slice(0, 1),
      version: 4,
      branding: {
        displayName: "Casa Giro",
        slogan: "Feito na hora",
        primaryColor: "#123abc",
        accentColor: "#fedcba",
        timezone: "America/Sao_Paulo",
        businessHours: {
          weekly: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, mode: "open24h" })),
          exceptions: [],
        },
      },
    },
  );
});

test("só confirma comando após aceite explícito da operação", () => {
  assert.equal(isCommandAccepted({ acknowledged: true }), true);
  assert.equal(isCommandAccepted({ acknowledged: false }), false);
  assert.equal(isCommandAccepted({ accepted: true }), false);
});

test("aceita somente o token opaco do QR no parâmetro mesa", () => {
  assert.equal(
    readTableAccessToken("?mesa=payload_assinado.assinatura-1"),
    "payload_assinado.assinatura-1",
  );
  assert.equal(readTableAccessToken("?mesa=../segredo"), null);
  assert.equal(readTableAccessToken("?table=id&token=payload.signature"), "payload.signature");
  assert.equal(readTableAccessToken(`?mesa=${"a".repeat(1025)}.b`), null);
});

test("aceita somente token público de opt-out dentro do contrato", () => {
  assert.equal(normalizeOptOutToken(" curto "), null);
  assert.equal(normalizeOptOutToken("a".repeat(32)), "a".repeat(32));
  assert.equal(normalizeOptOutToken("a".repeat(257)), null);
});

test("normaliza respostas públicas sem aceitar IDs ou confirmações implícitas", () => {
  assert.equal(isPublicSubmissionAccepted({ accepted: true }), true);
  assert.equal(isPublicSubmissionAccepted({ status: "booked" }), false);
  assert.deepEqual(readCouponValidation({ valid: false, reason: "secret" }), { valid: false });
  assert.deepEqual(readCouponValidation({ valid: true, discountCents: 1_000 }), {
    valid: true,
    discountCents: 1_000,
  });
  assert.equal(readCouponValidation({ valid: true, discountCents: 0 }), null);
});

test("reusa a chave idempotente apenas enquanto o conteúdo da tentativa é igual", () => {
  let sequence = 0;
  const createKey = () => `key-${++sequence}`;
  const first = resolveMutationAttempt(null, '{"partySize":2}', createKey);
  const replay = resolveMutationAttempt(first, '{"partySize":2}', createKey);
  const changed = resolveMutationAttempt(first, '{"partySize":3}', createKey);
  assert.equal(replay.key, first.key);
  assert.notEqual(changed.key, first.key);
});
