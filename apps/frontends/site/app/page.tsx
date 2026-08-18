import { CtaSection } from "../components/cta-section";
import { FeaturesSection } from "../components/features-section";
import { Hero } from "../components/hero";
import { PricingSection } from "../components/pricing-section";
import { ProductSection } from "../components/product-section";
import { TestimonialsSection } from "../components/testimonials-section";
import { getCommercialPlans } from "../lib/commercial";

export default async function Home() {
  const catalog = await getCommercialPlans();
  return (
    <main id="conteudo">
      <Hero />
      <ProductSection />
      <FeaturesSection />
      <PricingSection catalog={catalog} />
      <TestimonialsSection />
      <CtaSection />
    </main>
  );
}
