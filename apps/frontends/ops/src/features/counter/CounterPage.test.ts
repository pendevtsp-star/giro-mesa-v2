import { describe, expect, it } from "vitest";
import {
  counterCustomerFromOption,
  counterCustomerOptionValue,
  counterPaymentAttemptIdFromHash,
  counterTabIdFromHash,
  isValidCounterPhone,
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
});

describe("telefone operacional", () => {
  it("aceita telefone brasileiro com DDD e rejeita texto com o mesmo comprimento", () => {
    expect(isValidCounterPhone("(11) 99876-5432")).toBe(true);
    expect(isValidCounterPhone("abcdefghij")).toBe(false);
    expect(isValidCounterPhone("12345678")).toBe(false);
  });
});
