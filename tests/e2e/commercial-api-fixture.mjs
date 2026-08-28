import { createServer } from "node:http";

const document = (
  title,
  sections = [{ heading: "Teste", body: "Conteúdo persistido e publicado para a jornada E2E." }],
) => ({
  version: "e2e",
  effectiveAt: "2026-08-25T00:00:00.000Z",
  title,
  sections,
});

const catalog = {
  version: 1,
  publishedAt: "2026-08-25T00:00:00.000Z",
  landing: {
    hero: {
      eyebrow: "Gestão para food service",
      title: "Sua operação em uma base.",
      description: "Pedidos, produção e gestão conectados.",
      primaryCtaLabel: "Solicitar teste assistido",
      primaryCtaHref: "/teste-gratis",
      secondaryCtaLabel: "Explorar recursos",
      secondaryCtaHref: "/#produto",
      media: null,
    },
    socialProof: { title: "Operações atendidas", items: [] },
    benefits: {
      title: "Controle no turno real",
      items: [
        { title: "Atendimento", description: "Um pedido, vários canais.", icon: "operations" },
      ],
    },
    howItWorks: {
      title: "Ativação assistida",
      steps: [{ title: "Configuração", description: "Preparamos a unidade." }],
    },
    testimonials: { title: "Depoimentos", items: [] },
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
      terms: document("Termos de Uso"),
      privacy: document("Política de Privacidade", [
        { heading: "Privacidade", body: "Tratamento de dados na jornada E2E." },
        { heading: "Cookies", body: "Preferências e consentimento da jornada E2E." },
      ]),
    },
  },
  seo: {
    title: "GiroMesa para restaurantes",
    description: "Gestão conectada para food service.",
    canonicalPath: "/",
    ogImage: null,
  },
  plans: [
    {
      slug: "operacao",
      name: "Operação",
      description: "Base operacional publicada.",
      monthlyPriceCents: 14900,
      annualPriceCents: 149000,
      includedUnits: 1,
      entitlements: ["salon"],
      features: ["Salão e comandas"],
      featured: true,
      displayOrder: 1,
      ctaLabel: "Testar Operação",
      ctaHref: "/teste-gratis?plano=operacao",
      offers: {
        monthly: { originalPriceCents: 14900, priceCents: 14900, promotion: null },
        annual: { originalPriceCents: 149000, priceCents: 149000, promotion: null },
      },
    },
  ],
  experiments: [],
};

createServer((request, response) => {
  const body =
    request.url === "/health"
      ? { status: "ok" }
      : request.url?.startsWith("/public/v1/commercial-catalog")
        ? catalog
        : null;
  response.writeHead(body ? 200 : 404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body ?? { code: "NOT_FOUND" }));
}).listen(3200, "127.0.0.1");
