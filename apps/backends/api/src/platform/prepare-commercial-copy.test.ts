import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { commercialDraftUpdateSchema } from "./platform.schemas.js";
import { correctLegacyCommercialCopy, prepareCommercialCopy } from "./prepare-commercial-copy.js";

const sourceId = "00000000-0000-4000-8000-000000000001";
const draftId = "00000000-0000-4000-8000-000000000002";
const promotionId = "00000000-0000-4000-8000-000000000003";
const copiedPromotionId = "00000000-0000-4000-8000-000000000004";
const migration = readFileSync(
  new URL(
    "../../../../../packages/db/drizzle/0073_commercial_legacy_publication_backfill.sql",
    import.meta.url,
  ),
  "utf8",
);

function preview() {
  return {
    id: sourceId,
    status: "published",
    sourceVersionId: null,
    landing: JSON.parse(migration.split("$landing$")[1] ?? ""),
    seo: JSON.parse(migration.split("$seo$")[1] ?? ""),
    plans: ["operacao", "crescimento", "rede"].map((slug, index) => ({
      slug,
      name: slug,
      description: "Descrição personalizada preservada.",
      monthlyPriceCents: 14900 + index,
      annualPriceCents: 149000 + index,
      includedUnits: index === 2 ? 3 : 1,
      entitlements: ["salon", "offline_hub"],
      features: ["Salão", "QR na mesa e hub offline", "Recurso personalizado"],
      featured: index === 1,
      displayOrder: index,
      ctaLabel: "Testar este plano",
      ctaHref: `/teste-gratis?plano=${slug}`,
    })),
    promotions: [
      {
        id: promotionId,
        name: "Oferta preservada",
        type: "percentage",
        value: 1000,
        planSlugs: ["operacao"],
        cycles: ["monthly"],
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: null,
        newCustomersOnly: true,
        code: null,
        redemptionLimit: null,
        active: true,
      },
    ],
    experiments: [
      {
        slug: "copy-personalizada",
        status: "paused",
        startsAt: null,
        endsAt: null,
        variants: ["a", "b"].map((key) => ({
          key,
          weight: 50,
          headline: "Atendimento conectado",
          description: "Descrição personalizada preservada.",
          ctaLabel: "Solicitar proposta",
          ctaHref: "/contato",
        })),
      },
    ],
  };
}

const options = {
  apiUrl: "https://api.example.test",
  token: "test-session",
  sourceVersionId: sourceId,
};

test("corrects only legacy copy and preserves custom, financial, legal and experiment content", () => {
  const source = preview();
  const input = commercialDraftUpdateSchema.parse({
    ...source,
    reason: "Correção de copy legada",
    promotions: [],
    experiments: source.experiments.map(({ startsAt: _start, endsAt: _end, ...value }) => value),
  });
  const before = structuredClone(input);
  const corrected = correctLegacyCommercialCopy(input);
  assert.equal(corrected.landing.hero.primaryCtaLabel, "Solicitar teste assistido");
  assert.match(corrected.landing.hero.description, /14 dias após a ativação, sem cartão/);
  assert.equal(corrected.landing.hero.secondaryCtaLabel, "Explorar recursos");
  assert.equal(corrected.plans[0]?.features[1], "QR na mesa");
  assert.equal(corrected.plans[1]?.features[1], "QR na mesa e hub offline");
  assert.match(corrected.landing.benefits.items[5]?.description ?? "", /ainda não está disponível/);
  assert.match(corrected.landing.faq.items[1]?.answer ?? "", /ainda não está disponível/);
  assert.deepEqual(input, before);
  assert.deepEqual(corrected.landing.legal, input.landing.legal);
  assert.deepEqual(corrected.experiments, input.experiments);
  assert.deepEqual(corrected.seo, input.seo);
  for (const [index, plan] of corrected.plans.entries()) {
    const { ctaLabel: _cta, features: _features, ...unchanged } = plan;
    const { ctaLabel: _oldCta, features: _oldFeatures, ...previous } = input.plans[index] ?? {};
    assert.deepEqual(unchanged, previous);
  }
  assert.deepEqual(correctLegacyCommercialCopy(corrected), corrected);

  input.landing.hero.primaryCtaLabel = "Solicitar proposta";
  input.landing.hero.description = "Descrição exclusiva da empresa.";
  input.landing.hero.secondaryCtaHref = "/contato";
  const benefit = input.landing.benefits.items[5];
  const faq = input.landing.faq.items[1];
  const plan = input.plans[0];
  assert.ok(benefit && faq && plan);
  benefit.description = "Recurso personalizado.";
  faq.answer = "Resposta personalizada.";
  plan.features = ["Offline personalizado"];
  plan.ctaHref = "/contato";
  const customized = correctLegacyCommercialCopy(input);
  assert.deepEqual(customized.landing, input.landing);
  assert.deepEqual(customized.plans[0], input.plans[0]);
});

test("dry run returns reusable payload and performs no mutation", async () => {
  const calls: string[] = [];
  const result = await prepareCommercialCopy(options, async (url, init) => {
    calls.push(`${init?.method} ${new URL(String(url)).pathname}`);
    return Response.json(preview());
  });
  assert.deepEqual(calls, [`GET /v1/platform/commercial/versions/${sourceId}/preview`]);
  assert.equal(result.status, "preview");
  assert.equal(result.payload.promotions[0]?.id, promotionId);
  assert.equal(result.payload.promotions[0]?.value, 1000);
  assert.equal(result.payload.landing.hero.primaryCtaLabel, "Solicitar teste assistido");
  assert.deepEqual(result.payload.experiments[0]?.variants, preview().experiments[0]?.variants);
  const noChangeCalls: string[] = [];
  const noChange = await prepareCommercialCopy({ ...options, apply: true }, async (_url, init) => {
    noChangeCalls.push(init?.method ?? "GET");
    return Response.json({ ...preview(), ...result.payload });
  });
  assert.equal(noChange.status, "preview");
  assert.deepEqual(noChangeCalls, ["GET"]);
});

test("apply writes and verifies a draft using copied promotion IDs, never approves or publishes", async () => {
  const source = preview();
  const copied = {
    ...structuredClone(source),
    id: draftId,
    sourceVersionId: sourceId,
    status: "draft",
    promotions: [{ ...source.promotions[0], id: copiedPromotionId }],
  };
  const calls: Array<{ path: string; method: string; key: string | null }> = [];
  const result = await prepareCommercialCopy({ ...options, apply: true }, async (url, init) => {
    const path = new URL(String(url)).pathname;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-session");
    assert.equal(init?.redirect, "error");
    calls.push({ path, method: init?.method ?? "GET", key: headers.get("idempotency-key") });
    if (path.endsWith(`versions/${sourceId}/preview`)) return Response.json(source);
    if (init?.method === "POST") return Response.json({ id: draftId, replayed: false });
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.promotions[0].id, copiedPromotionId);
      Object.assign(copied, body);
      return Response.json({ id: draftId, status: "draft" });
    }
    return Response.json(copied);
  });
  assert.equal(result.status, "draft");
  assert.deepEqual(
    calls.map(({ method, path }) => `${method} ${path}`),
    [
      `GET /v1/platform/commercial/versions/${sourceId}/preview`,
      "POST /v1/platform/commercial/drafts",
      `GET /v1/platform/commercial/versions/${draftId}/preview`,
      `PUT /v1/platform/commercial/drafts/${draftId}`,
      `GET /v1/platform/commercial/versions/${draftId}/preview`,
    ],
  );
  assert.ok(calls.filter(({ method }) => method !== "GET").every(({ key }) => key));
  assert.equal(source.landing.hero.primaryCtaLabel, "Testar 14 dias grátis");
});

test("rejects unsafe transport, invalid origin, protected source and existing draft without continuing", async () => {
  const noRequest: typeof fetch = async () => {
    throw new Error("Unexpected request");
  };
  await assert.rejects(
    prepareCommercialCopy({ ...options, apiUrl: "http://api.example.test" }, noRequest),
    /HTTPS/,
  );
  await assert.rejects(
    prepareCommercialCopy(
      { ...options, apiUrl: "https://secret:password@api.example.test" },
      noRequest,
    ),
    /HTTPS/,
  );
  await assert.rejects(
    prepareCommercialCopy({ ...options, sourceVersionId: "../publish" }, noRequest),
  );
  await assert.rejects(prepareCommercialCopy({ ...options, token: "" }, noRequest), /obrigatório/);
  await assert.rejects(
    prepareCommercialCopy(options, async () => Response.json({ ...preview(), status: "draft" })),
    /publicada/,
  );
  let calls = 0;
  await assert.rejects(
    prepareCommercialCopy({ ...options, apply: true }, async () => {
      calls += 1;
      return calls === 1
        ? Response.json(preview())
        : Response.json({ code: "COMMERCIAL_DRAFT_ALREADY_EXISTS" }, { status: 409 });
    }),
    /409/,
  );
  assert.equal(calls, 2);
});

test("does not accept a published clone or an unconfirmed update", async () => {
  for (const cloneStatus of ["published", "draft"]) {
    const source = preview();
    const calls: string[] = [];
    await assert.rejects(
      prepareCommercialCopy({ ...options, apply: true }, async (_url, init) => {
        calls.push(init?.method ?? "GET");
        if (calls.length === 1) return Response.json(source);
        if (init?.method === "POST") return Response.json({ id: draftId, replayed: false });
        if (init?.method === "PUT") return Response.json({ id: draftId });
        return Response.json({
          ...source,
          id: draftId,
          sourceVersionId: sourceId,
          status: cloneStatus,
        });
      }),
      cloneStatus === "published" ? /editável/ : /não confirmou/,
    );
    assert.equal(calls.includes("PUT"), cloneStatus === "draft");
  }
});

test("a replayed creation requires manual review and never writes an existing edited draft", async () => {
  const source = preview();
  const copied = {
    ...structuredClone(source),
    id: draftId,
    sourceVersionId: sourceId,
    status: "draft",
  };
  copied.landing.hero.title = "Título alterado por outra pessoa";
  const calls: string[] = [];
  const result = await prepareCommercialCopy({ ...options, apply: true }, async (_url, init) => {
    calls.push(init?.method ?? "GET");
    if (calls.length === 1) return Response.json(source);
    if (init?.method === "POST") return Response.json({ id: draftId, replayed: true });
    return Response.json(copied);
  });
  assert.equal(result.status, "review_required");
  assert.equal(result.payload.landing.hero.title, "Título alterado por outra pessoa");
  assert.deepEqual(calls, ["GET", "POST", "GET"]);
  assert.equal(copied.landing.hero.primaryCtaLabel, "Testar 14 dias grátis");
});
