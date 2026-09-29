import Link from "next/link";
import {
  type CommercialAttribution,
  type CommercialLanding,
  withCommercialAttribution,
} from "../lib/commercial";

export function CtaSection({
  content,
  attribution,
}: {
  content: CommercialLanding["finalCta"];
  attribution?: CommercialAttribution;
}) {
  return (
    <section className="final-cta" aria-labelledby="final-cta-title">
      <div className="container">
        <h2 id="final-cta-title">{content.title}</h2>
        <p>{content.description}</p>
        <div>
          <Link
            className="button button-light button-large"
            href={withCommercialAttribution(content.ctaHref, attribution)}
          >
            {content.ctaLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
