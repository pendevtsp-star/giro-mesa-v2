import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App, clearSessionBeforeRemoteLogout } from "./App";

describe("experiência operacional", () => {
  it("não exibe login ou dados antes de validar a sessão", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Validando sua sessão");
    expect(html).not.toContain("demo@giromesa.com.br");
  });

  it("limpa a sessão visual antes de um logout remoto pendente", () => {
    let cleared = false;
    let resolveRemote: (() => void) | undefined;
    const pendingRemote = new Promise<void>((resolve) => {
      resolveRemote = resolve;
    });

    clearSessionBeforeRemoteLogout(
      () => {
        cleared = true;
      },
      () => pendingRemote,
    );

    expect(cleared).toBe(true);
    resolveRemote?.();
  });
});
