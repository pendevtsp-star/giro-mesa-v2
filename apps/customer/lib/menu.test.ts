import assert from "node:assert/strict";
import test from "node:test";
import { isDemoMenuSlug, normalizePublicMenu } from "./api.ts";
import { type CartItem, cartLineTotal, cartTotal, demoMenu, filterMenu } from "./menu.ts";
import {
  isCommandAccepted,
  isPublicSubmissionAccepted,
  normalizeOptOutToken,
  readCouponValidation,
  resolveMutationAttempt,
} from "./public-contracts.ts";

test("totaliza quantidade e adicionais em centavos", () => {
  const burger = demoMenu.find((item) => item.id === "burger");
  assert.ok(burger);
  const line: CartItem = {
    lineId: "1",
    item: burger,
    quantity: 2,
    modifiers: [{ id: "bacon", name: "Bacon", priceCents: 690 }],
  };
  assert.equal(cartLineTotal(line), 11160);
  assert.equal(cartTotal([line]), 11160);
});

test("busca considera nome, descrição e tags", () => {
  assert.equal(filterMenu(demoMenu, "Todos", "vegetariano").length, 2);
  assert.equal(filterMenu(demoMenu, "Sobremesas", "café")[0]?.id, "chocolate");
});

test("rejeita cardápio remoto incompleto antes de renderizar", () => {
  assert.equal(normalizePublicMenu({ items: [{ id: "sem-campos" }] }), null);
  assert.deepEqual(normalizePublicMenu({ items: demoMenu.slice(0, 1) }), demoMenu.slice(0, 1));
});

test("separa ícones controlados do produto do conteúdo visual livre do cliente", () => {
  assert.ok(demoMenu.every((item) => item.icon && item.visual === undefined));

  const customerVisual = { ...demoMenu[0], icon: undefined, visual: "Arte autoral da casa" };
  assert.deepEqual(normalizePublicMenu({ items: [customerVisual] }), [customerVisual]);
});

test("limita o cardápio demonstrativo ao slug explícito ou ao slug de QA", () => {
  assert.equal(isDemoMenuSlug("demo"), true);
  assert.equal(isDemoMenuSlug("qa-amora", "qa-amora"), true);
  assert.equal(isDemoMenuSlug("unidade-real", "qa-amora"), false);
});

test("só confirma comando após aceite explícito da operação", () => {
  assert.equal(isCommandAccepted({ acknowledged: true }), true);
  assert.equal(isCommandAccepted({ acknowledged: false }), false);
  assert.equal(isCommandAccepted({ accepted: true }), false);
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
