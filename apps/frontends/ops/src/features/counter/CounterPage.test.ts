import { describe, expect, it } from "vitest";
import {
  buildWhatsAppReadyLink,
  counterActionFromHash,
  counterCustomerFromOption,
  counterCustomerOptionValue,
  counterPaymentAttemptIdFromHash,
  counterStageCount,
  counterTabIdFromHash,
  isValidCounterPhone,
  parseCounterCustomers,
  parseCounterQueue,
} from "./CounterPage";

describe("atalho para a venda no balcão", () => {
  it("lê a comanda vinculada sem confundir outros parâmetros", () => {
    expect(counterTabIdFromHash("#/counter?tab=tab-123&origem=fiscal")).toBe("tab-123");
    expect(counterTabIdFromHash("#/counter?display=tab-123")).toBeNull();
  });

  it("lê uma tentativa SmartPOS somente do parâmetro dedicado", () => {
    expect(
      counterPaymentAttemptIdFromHash(
        "#/counter?tab=tab-123&paymentAttempt=attempt-456&origem=health",
      ),
    ).toBe("attempt-456");
    expect(counterPaymentAttemptIdFromHash("#/counter?tab=tab-123&attempt=attempt-456")).toBeNull();
  });

  it("lê somente o atalho de nova comanda", () => {
    expect(counterActionFromHash("#/counter?action=new&tab=tab-123")).toBe("new");
    expect(counterActionFromHash("#/counter?action=open")).toBeNull();
  });
});

describe("seleção de cliente do CRM", () => {
  const customer = {
    id: "customer-1",
    name: "Ana Souza",
    email: "ana@example.com",
    phone: "(11) 99999-0000",
    marketingOptIn: false,
  };
  const customers = [customer];

  it("resolve a opção sem alterar os dados usados como snapshot", () => {
    expect(counterCustomerOptionValue(customer)).toBe("Ana Souza · (11) 99999-0000");
    expect(counterCustomerFromOption(customers, " ana souza · (11) 99999-0000 ")).toMatchObject({
      id: "customer-1",
      name: "Ana Souza",
      phone: "(11) 99999-0000",
    });
    expect(counterCustomerFromOption(customers, "Cliente digitado manualmente")).toBeNull();
  });

  it("lê apenas o perfil operacional mínimo com endereço principal estruturado", () => {
    expect(
      parseCounterCustomers({
        items: [
          {
            id: "customer-1",
            name: "Ana Souza",
            phone: "+5511999990000",
            defaultDeliveryAddress: {
              street: "Rua Central",
              number: "10",
              neighborhood: "Centro",
              city: "São Paulo",
              state: "sp",
              postalCode: "01001-000",
              reference: "Portão azul",
            },
          },
        ],
      })[0],
    ).toMatchObject({
      id: "customer-1",
      defaultDeliveryAddress: { state: "SP", reference: "Portão azul" },
    });
  });
});

describe("telefone operacional", () => {
  it("aceita telefone brasileiro com DDD e rejeita texto com o mesmo comprimento", () => {
    expect(isValidCounterPhone("(11) 99876-5432")).toBe(true);
    expect(isValidCounterPhone("abcdefghij")).toBe(false);
    expect(isValidCounterPhone("12345678")).toBe(false);
  });
});

describe("aviso de pedido pronto", () => {
  it("informa saída para entrega sem prometer retirada", () => {
    const link = buildWhatsAppReadyLink("(11) 99999-0000", "Ana", "42", "delivery");
    expect(link).toContain("https://wa.me/5511999990000?");
    expect(decodeURIComponent(link ?? "")).toContain("aguarda saída para entrega");
  });
});

it("usa o agregado de pedidos prontos para saída sem incluir toda a fila de espera", () => {
  const queue = {
    items: [],
    counts: {
      all: 9,
      new: 0,
      production: 0,
      ready: 2,
      readyForHandoff: 3,
      waiting: 5,
      delivered: 0,
      late: 2,
    },
    pagination: { page: 1, limit: 1, total: 9, totalPages: 9 },
  };
  const parsed = parseCounterQueue(queue);
  expect(parsed.counts).toMatchObject({
    readyForHandoff: 3,
    waiting: 5,
    late: 2,
  });
  expect(counterStageCount(parsed.counts, "ready")).toBe(3);
  expect(counterStageCount(parsed.counts, "waiting")).toBe(5);
  expect(() =>
    parseCounterQueue({ ...queue, counts: { ...queue.counts, readyForHandoff: undefined } }),
  ).toThrow();
});
