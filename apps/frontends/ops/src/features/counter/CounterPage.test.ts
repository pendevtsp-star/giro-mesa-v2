import { describe, expect, it } from "vitest";
import {
  counterCustomerFromOption,
  counterCustomerOptionValue,
  counterTabIdFromHash,
} from "./CounterPage";

describe("atalho para a venda no balcão", () => {
  it("lê a comanda vinculada sem confundir outros parâmetros", () => {
    expect(counterTabIdFromHash("#/counter?tab=tab-123&origem=fiscal")).toBe("tab-123");
    expect(counterTabIdFromHash("#/counter?display=tab-123")).toBeNull();
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
