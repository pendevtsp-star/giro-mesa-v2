import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commercialDraftUpdateSchema } from "./platform.schemas.js";

const legalDocument = {
  version: "2026-08",
  effectiveAt: "2026-08-25T00:00:00.000Z",
  title: "Documento",
  sections: [{ heading: "Escopo", body: "Texto simples e versionado." }],
};

const draft = {
  reason: "Atualização comercial aprovada para publicação.",
  plans: [
    {
      slug: "operacao",
      name: "Operação",
      description: "Plano operacional.",
      monthlyPriceCents: 10_000,
      annualPriceCents: 100_000,
      includedUnits: 1,
      entitlements: ["orders"],
      features: ["Pedidos"],
      featured: false,
      displayOrder: 1,
      ctaLabel: "Começar",
      ctaHref: "/teste-gratis",
    },
  ],
  landing: {
    hero: {
      eyebrow: "GiroMesa",
      title: "Operação simples",
      description: "Controle o restaurante.",
      primaryCtaLabel: "Começar",
      primaryCtaHref: "/teste-gratis",
    },
    socialProof: { title: "Resultados", items: [] },
    benefits: {
      title: "Benefícios",
      items: [{ title: "Controle", description: "Mais visibilidade.", icon: "operations" }],
    },
    howItWorks: {
      title: "Como funciona",
      steps: [{ title: "Cadastre", description: "Configure sua operação." }],
    },
    testimonials: { title: "Clientes", items: [] },
    faq: { title: "Dúvidas", items: [{ question: "Como?", answer: "Com acompanhamento." }] },
    finalCta: {
      title: "Pronto?",
      description: "Comece agora.",
      ctaLabel: "Testar",
      ctaHref: "/teste-gratis",
    },
    legal: { terms: legalDocument, privacy: legalDocument },
  },
  seo: {
    title: "GiroMesa",
    description: "Gestão para restaurantes.",
    canonicalPath: "/",
  },
  promotions: [],
  experiments: [
    {
      slug: "hero-copy",
      status: "active",
      variants: [
        {
          key: "a",
          weight: 50,
          headline: "Controle",
          description: "Mais clareza.",
          ctaLabel: "Começar",
          ctaHref: "/teste-gratis",
        },
        {
          key: "b",
          weight: 50,
          headline: "Cresça",
          description: "Mais resultado.",
          ctaLabel: "Testar",
          ctaHref: "/teste-gratis",
        },
      ],
    },
  ],
};

describe("commercial platform schemas", () => {
  it("accepts typed legal content and content-only weighted experiments", () => {
    assert.equal(commercialDraftUpdateSchema.safeParse(draft).success, true);
  });

  it("rejects experiment weights that do not total 100", () => {
    const invalid = structuredClone(draft);
    const firstExperiment = invalid.experiments[0];
    const firstVariant = firstExperiment?.variants[0];
    assert.ok(firstVariant);
    firstVariant.weight = 40;
    assert.equal(commercialDraftUpdateSchema.safeParse(invalid).success, false);
  });
});
