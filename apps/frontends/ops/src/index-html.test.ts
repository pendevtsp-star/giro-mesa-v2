import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const bridgeBootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

function runBootstrap(hostname: string) {
  const appendChild = vi.fn();
  const createElement = vi.fn(() => ({}));
  const dispatchEvent = vi.fn();

  vm.runInNewContext(bridgeBootstrap ?? "", {
    Event,
    document: { createElement, head: { appendChild } },
    window: { dispatchEvent, location: { hostname } },
  });

  return { appendChild, createElement };
}

describe("Ops HTML bootstrap", () => {
  it("não solicita a bridge nativa no navegador web", () => {
    const browser = runBootstrap("app.giromesa.com.br");

    expect(browser.createElement).not.toHaveBeenCalled();
    expect(browser.appendChild).not.toHaveBeenCalled();
  });

  it("carrega a bridge no origin reservado do MAUI", () => {
    const shell = runBootstrap("0.0.0.1");

    expect(shell.createElement).toHaveBeenCalledWith("script");
    expect(shell.appendChild).toHaveBeenCalledOnce();
    expect(shell.appendChild.mock.calls[0]?.[0]).toMatchObject({
      src: "_framework/hybridwebview.js",
    });
  });
});
