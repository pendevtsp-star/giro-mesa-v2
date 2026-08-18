import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocalReturnTo, resolveOpsUrl } from "./auth-navigation.ts";

test("resolve o destino operacional configurado", () => {
  assert.equal(
    resolveOpsUrl("https://app.giromesa.com.br", "https://giromesa.com.br"),
    "https://app.giromesa.com.br/",
  );
  assert.equal(
    resolveOpsUrl("/operacao", "https://giromesa.com.br"),
    "https://giromesa.com.br/operacao",
  );
});

test("aceita somente retorno local relativo", () => {
  assert.equal(
    resolveLocalReturnTo("/aceitar-convite?token=abc", "https://giromesa.com.br"),
    "/aceitar-convite?token=abc",
  );
  assert.equal(resolveLocalReturnTo("https://evil.example", "https://giromesa.com.br"), null);
  assert.equal(resolveLocalReturnTo("//evil.example", "https://giromesa.com.br"), null);
});

test("falha fechado sem destino ou com protocolo inseguro", () => {
  assert.equal(resolveOpsUrl(undefined, "https://giromesa.com.br"), null);
  assert.equal(resolveOpsUrl("javascript:alert(1)", "https://giromesa.com.br"), null);
  assert.equal(resolveOpsUrl("::invalido::", "https://giromesa.com.br"), null);
});
