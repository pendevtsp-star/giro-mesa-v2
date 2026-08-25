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
    <section className="final-cta">
      <div className="container">
        <h2>{content.title}</h2>
        <p>{content.description}</p>
        <div>
          <Link
            className="button button-light button-large"
            href={withCommercialAttribution(content.ctaHref, attribution)}
          >
            {content.ctaLabel} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
