import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

const readSource = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

it("usa ícones reais em vez de glifos textuais ou CSS", async () => {
  const [login, signup, trial, header, customerMenu, siteCss] = await Promise.all([
    readSource("../app/login/page.tsx"),
    readSource("../app/criar-conta/page.tsx"),
    readSource("../app/teste-gratis/page.tsx"),
    readSource("../components/header.tsx"),
    readSource("../../customer/components/menu-experience.tsx"),
    readSource("../app/globals.css"),
  ]);

  assert.doesNotMatch(`${login}\n${signup}`, /aria-hidden=["']true["']>\s*G\s*</);
  assert.match(login, /<GoogleMark\s*\/>/);
  assert.match(signup, /<GoogleMark\s*\/>/);
  assert.match(trial, /<Icon name="check"\s*\/>/);
  assert.doesNotMatch(`${header}\n${customerMenu}`, />\s*G\s*</);
  assert.match(header, /<Icon name="platform"\s*\/>/);
  assert.match(customerMenu, /<Icon name="platform"\s*\/>/);
  assert.doesNotMatch(siteCss, /content:\s*["'](?:✓|✔)["']/u);
});

it("revalida mutações no clique antes de ativar updates PWA", async () => {
  const clients = await Promise.all([
    readSource("../components/pwa-client.tsx"),
    readSource("../../customer/components/pwa-client.tsx"),
  ]);

  for (const client of clients) {
    assert.match(client, /requestPwaActivation\(waiting\)/);
    assert.doesNotMatch(client, /waiting\.postMessage\(\{\s*type:\s*["']SKIP_WAITING["']/);
  }
});

it("alinha a cor do shell Ops ao manifesto e oferece alvo PWA de 48px nos três apps", async () => {
  const [indexHtml, manifest, opsCss, siteCss, customerCss] = await Promise.all([
    readSource("../../ops/index.html"),
    readSource("../../ops/public/manifest.webmanifest"),
    readSource("../../ops/src/styles.css"),
    readSource("../app/globals.css"),
    readSource("../../customer/app/globals.css"),
  ]);
  const themeColor = indexHtml.match(/name="theme-color" content="([^"]+)"/)?.[1];
  assert.equal(themeColor, JSON.parse(manifest).theme_color);
  for (const css of [opsCss, siteCss, customerCss]) {
    assert.match(css, /\.pwa-update button\s*\{[^}]*min-height:\s*48px/s);
  }
});

it("estabiliza imagens, fontes e layout visual sem sleeps frágeis", async () => {
  const visualSpec = await readSource("../../../tests/e2e/landing-visual.spec.ts");
  assert.match(visualSpec, /waitForStableVisualState/);
  assert.match(visualSpec, /document\.fonts\.ready/);
  assert.match(visualSpec, /\.decode\(\)/);
  assert.match(visualSpec, /polling:\s*"raf"/);
  assert.doesNotMatch(visualSpec, /waitForTimeout|setTimeout/);
});
