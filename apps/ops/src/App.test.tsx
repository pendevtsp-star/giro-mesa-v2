import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("experiência operacional", () => {
  it("não exibe login ou dados antes de validar a sessão", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Validando sua sessão");
    expect(html).not.toContain("demo@giromesa.com.br");
  });
});
