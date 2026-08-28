import assert from "node:assert/strict";
import test from "node:test";
import { prepareGoogleRedirect, resolveLocalReturnTo, resolveOpsUrl } from "./auth-navigation.ts";

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
  assert.equal(
    resolveLocalReturnTo("/aceitar-convite#platform=abc_123", "https://giromesa.com.br"),
    "/aceitar-convite#platform=abc_123",
  );
  assert.equal(resolveLocalReturnTo("https://evil.example", "https://giromesa.com.br"), null);
  assert.equal(resolveLocalReturnTo("//evil.example", "https://giromesa.com.br"), null);
});

test("falha fechado sem destino ou com protocolo inseguro", () => {
  assert.equal(resolveOpsUrl(undefined, "https://giromesa.com.br"), null);
  assert.equal(resolveOpsUrl("javascript:alert(1)", "https://giromesa.com.br"), null);
  assert.equal(resolveOpsUrl("::invalido::", "https://giromesa.com.br"), null);
});

test("prepara Google por POST e aceita somente a origem oficial", async () => {
  let requestUrl = "";
  let requestBody = "";
  const redirect = await prepareGoogleRedirect(
    "https://api.giromesa.com.br",
    { intent: "login", returnTo: "/aceitar-convite#platform=segredo" },
    async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body);
      return new Response(
        JSON.stringify({
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque",
        }),
        { status: 200 },
      );
    },
  );
  assert.equal(requestUrl, "https://api.giromesa.com.br/v1/auth/google/prepare");
  assert.equal(new URL(requestUrl).search, "");
  assert.match(requestBody, /#platform=segredo/);
  assert.equal(redirect, "https://accounts.google.com/o/oauth2/v2/auth?state=opaque");
  assert.equal(
    await prepareGoogleRedirect(
      "https://api.giromesa.com.br",
      { intent: "login" },
      async () =>
        new Response(JSON.stringify({ authorizationUrl: "https://evil.example/oauth" }), {
          status: 200,
        }),
    ),
    null,
  );
});
