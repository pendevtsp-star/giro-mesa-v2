import assert from "node:assert/strict";
import test from "node:test";
import { resolveSmartPosInstallDestination } from "./smartpos-install.ts";

test("direciona navegador comum para a PWA configurada", () => {
  assert.deepEqual(
    resolveSmartPosInstallDestination({
      vendor: "browser",
      currentOrigin: "https://giromesa.com.br",
      opsUrl: "https://app.giromesa.com.br",
    }),
    {
      kind: "pwa",
      href: "https://app.giromesa.com.br/",
      label: "Abrir e instalar a PWA",
    },
  );
});

test("não promete loja SmartPOS sem URL homologada", () => {
  assert.equal(
    resolveSmartPosInstallDestination({
      vendor: "rede",
      currentOrigin: "https://giromesa.com.br",
    }).kind,
    "homologation",
  );
});

test("usa somente URL de loja configurada para o fornecedor selecionado", () => {
  const destination = resolveSmartPosInstallDestination({
    vendor: "stone",
    currentOrigin: "https://giromesa.com.br",
    storeUrls: { stone: "https://loja.example/giromesa" },
  });
  assert.equal(destination.kind, "store");
  assert.equal(destination.href, "https://loja.example/giromesa");
});

test("falha fechado para URL de loja relativa, insegura ou com credenciais", () => {
  for (const storeUrl of [
    "/atalho-interno",
    "http://loja.example/giromesa",
    "https://usuario:senha@loja.example/giromesa",
  ]) {
    assert.equal(
      resolveSmartPosInstallDestination({
        vendor: "rede",
        currentOrigin: "https://giromesa.com.br",
        storeUrls: { rede: storeUrl },
      }).kind,
      "homologation",
    );
  }
});
