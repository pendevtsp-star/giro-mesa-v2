import assert from "node:assert/strict";
import test from "node:test";
import {
  annualPriceCents,
  commercialAttributionForCatalog,
  commercialAttributionFromSearchParams,
  commercialHeroForCatalog,
  isPersistedLeadReceipt,
  normalizeCommercialCatalog,
  withCommercialAttribution,
} from "./commercial.ts";

function publishedCatalog() {
  return {
    version: 7,
    publishedAt: "2026-08-25T12:00:00.000Z",
    landing: {
      hero: {
        eyebrow: "Gestão para food service",
        title: "Sua operação em uma base.",
        description: "Pedidos, produção e gestão conectados.",
        primaryCtaLabel: "Começar",
        primaryCtaHref: "/teste-gratis",
        secondaryCtaLabel: "Ver planos",
        secondaryCtaHref: "#planos",
        media: {
          url: "https://cdn.giromesa.com.br/landing/hero.webp",
          alt: "Tela do GiroMesa com fila de produção",
          width: 1280,
          height: 720,
        },
      },
      socialProof: { title: "Operações atendidas", items: [{ label: "segmentos", value: "6" }] },
      benefits: {
        title: "Controle no turno real",
        items: [{ title: "Atendimento", description: "Um pedido, vários canais.", icon: "01" }],
      },
      howItWorks: {
        title: "Ativação assistida",
        steps: [{ title: "Configuração", description: "Preparamos a unidade." }],
      },
      testimonials: {
        title: "Quem opera recomenda",
        items: [{ quote: "A fila ficou clara.", name: "Ana", role: "Gerente" }],
      },
      faq: {
        title: "Antes de começar",
        items: [{ question: "Precisa de cartão?", answer: "Não." }],
      },
      finalCta: {
        title: "Pronto para começar?",
        description: "Converse com a equipe.",
        ctaLabel: "Solicitar teste",
        ctaHref: "/teste-gratis",
      },
      legal: {
        terms: {
          version: "2026-08",
          effectiveAt: "2026-08-25T00:00:00.000Z",
          title: "Termos de Uso",
          sections: [{ heading: "Objeto", body: "Regras do serviço." }],
        },
        privacy: {
          version: "2026-08",
          effectiveAt: "2026-08-25T00:00:00.000Z",
          title: "Política de Privacidade",
          sections: [
            { heading: "Dados", body: "Dados necessários para o serviço." },
            { heading: "Cookies", body: "Cookies necessários e opcionais." },
          ],
        },
      },
    },
    seo: {
      title: "GiroMesa para restaurantes",
      description: "Gestão conectada para food service.",
      canonicalPath: "/",
      ogImage: {
        url: "https://cdn.giromesa.com.br/landing/og.webp",
        alt: "GiroMesa em uma operação de restaurante",
      },
    },
    plans: [
      {
        slug: "operacao",
        name: "Operação",
        description: "Base operacional publicada.",
        monthlyPriceCents: 14900,
        annualPriceCents: 149000,
        includedUnits: 1,
        entitlements: ["salon", "qr_ordering", "doseclub.subscription"],
        features: ["Salão e comandas", "Pedidos por código QR na mesa"],
        featured: true,
        displayOrder: 1,
        ctaLabel: "Testar Operação",
        ctaHref: "/teste-gratis?plano=operacao",
        offers: {
          monthly: {
            originalPriceCents: 14900,
            priceCents: 12900,
            promotion: {
              id: "promo-1",
              name: "Lançamento",
              type: "fixed",
              value: 2000,
              endsAt: "2026-09-01T00:00:00.000Z",
            },
          },
          annual: { originalPriceCents: 149000, priceCents: 149000, promotion: null },
        },
      },
    ],
    experiments: [],
  };
}

test("o anual equivale a dez mensalidades", () => {
  assert.equal(annualPriceCents(14900), 149000);
});

test("preços inválidos são rejeitados", () => {
  assert.throws(() => annualPriceCents(-1), TypeError);
});

test("normaliza apresentação, SEO, mídia, legal e oferta calculada sem confiar no JSON", () => {
  const catalog = normalizeCommercialCatalog(publishedCatalog());
  assert.equal(catalog?.landing.hero.media?.alt, "Tela do GiroMesa com fila de produção");
  assert.equal(catalog?.seo.canonicalPath, "/");
  assert.equal(catalog?.plans[0]?.features[1], "Pedidos por código QR na mesa");
  assert.equal(catalog?.plans[0]?.offers.monthly.priceCents, 12900);
  assert.equal(catalog?.plans[0]?.offers.monthly.promotion?.name, "Lançamento");
  assert.equal(catalog?.landing.legal.privacy.version, "2026-08");
});

test("aceita prova social e depoimentos vazios conforme o contrato publicado", () => {
  const value = publishedCatalog();
  value.landing.socialProof.items = [];
  value.landing.testimonials.items = [];
  const catalog = normalizeCommercialCatalog(value);
  assert.deepEqual(catalog?.landing.socialProof.items, []);
  assert.deepEqual(catalog?.landing.testimonials.items, []);
});

test("falha fechado para SEO, mídia ou desconto inconsistentes", () => {
  const validForAlt = publishedCatalog();
  const invalidAlt = {
    ...validForAlt,
    landing: {
      ...validForAlt.landing,
      hero: {
        ...validForAlt.landing.hero,
        media: { ...validForAlt.landing.hero.media, alt: "" },
      },
    },
  };
  assert.equal(normalizeCommercialCatalog(invalidAlt), null);

  const validForSeo = publishedCatalog();
  const invalidSeo = {
    ...validForSeo,
    seo: { ...validForSeo.seo, canonicalPath: "javascript:alert(1)" },
  };
  assert.equal(normalizeCommercialCatalog(invalidSeo), null);

  const validForDiscount = publishedCatalog();
  const plan = validForDiscount.plans[0];
  assert.ok(plan);
  const inventedDiscount = {
    ...validForDiscount,
    plans: [
      {
        ...plan,
        offers: {
          ...plan.offers,
          monthly: { ...plan.offers.monthly, promotion: null },
        },
      },
    ],
  };
  assert.equal(normalizeCommercialCatalog(inventedDiscount), null);

  const withoutCookiePolicy = publishedCatalog();
  withoutCookiePolicy.landing.legal.privacy.sections = [
    { heading: "Dados", body: "Dados necessários para o serviço." },
  ];
  assert.equal(normalizeCommercialCatalog(withoutCookiePolicy), null);
});

test("preserva campanha e UTMs e deriva versões somente do catálogo publicado", () => {
  const raw = commercialAttributionFromSearchParams({
    campaign: " lançamento-2026 ",
    landing_version: "999",
    utm_source: ["instagram", "ignorado"],
    utm_medium: "paid-social",
    utm_campaign: "agosto",
  });
  const catalog = normalizeCommercialCatalog(publishedCatalog());
  assert.ok(catalog);
  const attribution = commercialAttributionForCatalog(raw, catalog);
  assert.deepEqual(attribution, {
    campaignSlug: "lançamento-2026",
    landingVersion: 7,
    utmSource: "instagram",
    utmMedium: "paid-social",
    utmCampaign: "agosto",
    termsVersion: "2026-08",
    privacyVersion: "2026-08",
  });
  assert.equal(
    withCommercialAttribution("/teste-gratis?plano=operacao", attribution),
    "/teste-gratis?plano=operacao&campaign=lan%C3%A7amento-2026&landing_version=7&utm_source=instagram&utm_medium=paid-social&utm_campaign=agosto",
  );
});

test("só reconhece confirmação de lead depois do recibo persistido", () => {
  assert.equal(
    isPersistedLeadReceipt({ id: "lead-1", createdAt: "2026-08-25T12:00:00.000Z" }),
    true,
  );
  assert.equal(isPersistedLeadReceipt({ id: "lead-1" }), false);
  assert.equal(isPersistedLeadReceipt({ createdAt: "2026-08-25T12:00:00.000Z" }), false);
});

test("aplica apenas headline e CTA da variante atribuída e envia a atribuição", () => {
  const payload = {
    ...publishedCatalog(),
    experiments: [
      {
        slug: "hero-agosto",
        variant: {
          key: "direta",
          weight: 50,
          headline: "Controle o próximo turno.",
          description: "Veja exceções e aja rápido.",
          ctaLabel: "Organizar operação",
          ctaHref: "/teste-gratis?plano=operacao",
        },
      },
    ],
  };
  const catalog = normalizeCommercialCatalog(payload);
  assert.ok(catalog);
  const hero = commercialHeroForCatalog(catalog);
  assert.equal(hero.title, "Controle o próximo turno.");
  assert.equal(hero.primaryCtaLabel, "Criar conta grátis");
  assert.equal(hero.primaryCtaHref, "/criar-conta");
  assert.equal(catalog.plans[0]?.offers.monthly.priceCents, 12900);
  assert.deepEqual(commercialAttributionForCatalog(undefined, catalog, "visitor-opaque-123"), {
    landingVersion: 7,
    termsVersion: "2026-08",
    privacyVersion: "2026-08",
    experimentSlug: "hero-agosto",
    variantKey: "direta",
    visitorId: "visitor-opaque-123",
  });
});
