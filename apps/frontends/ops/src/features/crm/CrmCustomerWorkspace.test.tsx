import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { useRemote } from "../../growth.shared";
import { CrmCustomerMergeForm, canMergeCustomers } from "./CrmCustomerWorkspace";

vi.mock("../../growth.shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../growth.shared")>();
  return { ...actual, useRemote: vi.fn() };
});

afterEach(() => vi.restoreAllMocks());

describe("unificação de clientes", () => {
  it("exige dois cadastros diferentes e justificativa", () => {
    expect(canMergeCustomers("target", "source", "Duplicado")).toBe(true);
    expect(canMergeCustomers("target", "target", "Duplicado")).toBe(false);
    expect(canMergeCustomers("target", "", "Duplicado")).toBe(false);
    expect(canMergeCustomers("", "source", "Duplicado")).toBe(false);
    expect(canMergeCustomers("target", "source", "  a  ")).toBe(false);
  });

  it("consulta cadastros de origem independentemente da lista principal e exclui o alvo", () => {
    const payload = {
      items: [
        { id: "target", name: "Cadastro mantido", marketingOptIn: false },
        { id: "customer-31", name: "Origem fora da página principal", marketingOptIn: false },
      ],
      total: 65,
      limit: 30,
      offset: 0,
    };
    const lookup = vi.spyOn(api.growth, "customerPage").mockResolvedValue(payload);
    vi.mocked(useRemote).mockImplementation((_scope, loader, parser) => {
      void loader();
      return {
        state: { status: "ready", data: parser(payload) },
        refreshing: false,
        refreshError: null,
        lastSuccessfulAt: null,
        retry: vi.fn(),
        refreshSilently: vi.fn(),
        update: vi.fn(),
      };
    });
    const html = renderToStaticMarkup(
      <CrmCustomerMergeForm
        scope={{
          organizationId: "organization",
          unitId: "unit",
          profileId: "owner",
          refreshToken: 0,
        }}
        targetId="target"
        onMerged={() => {}}
      />,
    );
    expect(lookup).toHaveBeenCalledWith("organization", { q: undefined, limit: 30, offset: 0 });
    expect(html).toContain('value="customer-31"');
    expect(html).not.toContain('value="target"');
    expect(html).toContain("Páginas de cadastros de origem");
    expect(html).toContain("Próxima");
  });
});
