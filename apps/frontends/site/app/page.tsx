import type { Metadata } from "next";
import { headers } from "next/headers";
import { CtaSection } from "../components/cta-section";
import { ExperimentImpression } from "../components/experiment-impression";
import { FeaturesSection } from "../components/features-section";
import { Hero } from "../components/hero";
import { PricingSection } from "../components/pricing-section";
import { TestimonialsSection } from "../components/testimonials-section";
import {
  commercialAttributionForCatalog,
  commercialAttributionFromSearchParams,
  commercialHeroForCatalog,
  commercialVisitorId,
  getCommercialCatalog,
} from "../lib/commercial";

export async function generateMetadata(): Promise<Metadata> {
  const state = await getCommercialCatalog();
  if (!state.catalog)
    return {
      title: "Conteúdo temporariamente indisponível",
      robots: { follow: false, index: false },
    };
  const { seo } = state.catalog;
  return {
    title: { absolute: seo.title },
    description: seo.description,
    alternates: { canonical: seo.canonicalPath },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: seo.canonicalPath,
      images: seo.ogImage ? [{ url: seo.ogImage.url, alt: seo.ogImage.alt }] : undefined,
    },
  };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const visitorId = commercialVisitorId((await headers()).get("x-giromesa-visitor-id"));
  const [state, parameters] = await Promise.all([getCommercialCatalog(visitorId), searchParams]);
  if (!state.catalog)
    return (
      <main id="conteudo" className="catalog-unavailable">
        <section className="container narrow" aria-labelledby="catalog-unavailable-title">
          <p className="eyebrow">Conteúdo indisponível</p>
          <h1 id="catalog-unavailable-title">
            A apresentação comercial está temporariamente fora do ar.
          </h1>
          <p>
            Não exibimos preços ou promessas sem um catálogo publicado e validado. Tente novamente
            mais tarde.
          </p>
        </section>
      </main>
    );

  const { catalog } = state;
  const attribution = commercialAttributionForCatalog(
    commercialAttributionFromSearchParams(parameters),
    catalog,
    visitorId,
  );
  return (
    <main id="conteudo">
      <Hero
        attribution={attribution}
        hero={commercialHeroForCatalog(catalog)}
        socialProof={catalog.landing.socialProof}
      />
      <FeaturesSection
        benefits={catalog.landing.benefits}
        howItWorks={catalog.landing.howItWorks}
      />
      <PricingSection attribution={attribution} plans={catalog.plans} />
      <TestimonialsSection faq={catalog.landing.faq} testimonials={catalog.landing.testimonials} />
      <CtaSection attribution={attribution} content={catalog.landing.finalCta} />
      {visitorId ? (
        <ExperimentImpression
          catalogVersion={catalog.version}
          experiments={catalog.experiments}
          visitorId={visitorId}
        />
      ) : null}
    </main>
  );
}
