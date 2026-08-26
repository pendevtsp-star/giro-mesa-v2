import { commercialEntitlementLabels } from "@giromesa/ui/lib/commercial-entitlements";

export type CommercialMedia = { url: string; alt: string; width?: number; height?: number };
export type CommercialPromotion = {
  id: string;
  name: string;
  type: "percentage" | "fixed" | "price";
  value: number;
  endsAt: string | null;
};
export type CommercialOffer = {
  originalPriceCents: number;
  priceCents: number;
  promotion: CommercialPromotion | null;
};
export type CommercialPlan = {
  slug: "operacao" | "crescimento" | "rede";
  name: string;
  description: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  includedUnits: number;
  entitlements: string[];
  features: string[];
  featured: boolean;
  displayOrder: number;
  ctaLabel: string;
  ctaHref: string;
  offers: { monthly: CommercialOffer; annual: CommercialOffer };
};
export type CommercialLegalDocument = {
  version: string;
  effectiveAt: string;
  title: string;
  sections: Array<{ heading: string; body: string }>;
};
export type CommercialExperiment = {
  slug: string;
  variant: {
    key: string;
    weight: number;
    headline: string;
    description: string;
    ctaLabel: string;
    ctaHref: string;
  } | null;
};
export type CommercialLanding = {
  hero: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCtaLabel: string;
    primaryCtaHref: string;
    secondaryCtaLabel?: string;
    secondaryCtaHref?: string;
    media: CommercialMedia | null;
  };
  socialProof: { title: string; items: Array<{ label: string; value: string }> };
  benefits: { title: string; items: Array<{ title: string; description: string; icon: string }> };
  howItWorks: { title: string; steps: Array<{ title: string; description: string }> };
  testimonials: { title: string; items: Array<{ quote: string; name: string; role: string }> };
  faq: { title: string; items: Array<{ question: string; answer: string }> };
  finalCta: { title: string; description: string; ctaLabel: string; ctaHref: string };
  legal: { terms: CommercialLegalDocument; privacy: CommercialLegalDocument };
};
export type CommercialSeo = {
  title: string;
  description: string;
  canonicalPath: string;
  ogImage: Pick<CommercialMedia, "url" | "alt"> | null;
};
export type CommercialCatalog = {
  version: number;
  publishedAt: string;
  landing: CommercialLanding;
  seo: CommercialSeo;
  plans: CommercialPlan[];
  experiments: CommercialExperiment[];
};
export type CommercialCatalogState =
  | { source: "api"; catalog: CommercialCatalog }
  | { source: "unavailable"; catalog: null };
export type CommercialAttribution = {
  campaignSlug?: string;
  landingVersion?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  termsVersion?: string;
  privacyVersion?: string;
  experimentSlug?: string;
  variantKey?: string;
  visitorId?: string;
};

type SearchParameters = Record<string, string | string[] | undefined>;

export function commercialVisitorId(value: string | null | undefined): string | undefined {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(textValue);
  return normalized.every((item): item is string => item !== null) ? normalized : null;
}
function isSafePublicHref(value: string): boolean {
  if (value.startsWith("#")) return value.length > 1;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
function publicHref(value: unknown): string | null {
  const normalized = textValue(value);
  return normalized && isSafePublicHref(normalized) ? normalized : null;
}
function isoDate(value: unknown): string | null {
  const normalized = textValue(value);
  return normalized && !Number.isNaN(Date.parse(normalized)) ? normalized : null;
}
function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}
function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}
function normalizeMedia(value: unknown, dimensions = true): CommercialMedia | null | false {
  if (value === null) return null;
  if (!isRecord(value)) return false;
  const url = publicHref(value.url);
  const alt = textValue(value.alt);
  if (!url || !alt) return false;
  const width = value.width === undefined ? undefined : positiveInteger(value.width);
  const height = value.height === undefined ? undefined : positiveInteger(value.height);
  if (
    dimensions &&
    ((value.width !== undefined && !width) || (value.height !== undefined && !height))
  )
    return false;
  return { url, alt, ...(width ? { width } : {}), ...(height ? { height } : {}) };
}
function normalizePromotion(value: unknown): CommercialPromotion | null | false {
  if (value === null) return null;
  if (!isRecord(value)) return false;
  const id = textValue(value.id);
  const name = textValue(value.name);
  const type = value.type;
  const promotionValue = positiveInteger(value.value);
  const endsAt = value.endsAt === null ? null : isoDate(value.endsAt);
  if (
    !id ||
    !name ||
    (type !== "percentage" && type !== "fixed" && type !== "price") ||
    promotionValue === null ||
    (value.endsAt !== null && endsAt === null)
  )
    return false;
  return { id, name, type, value: promotionValue, endsAt };
}
function normalizeOffer(value: unknown, basePriceCents: number): CommercialOffer | null {
  if (!isRecord(value)) return null;
  const originalPriceCents = nonNegativeInteger(value.originalPriceCents);
  const priceCents = nonNegativeInteger(value.priceCents);
  const promotion = normalizePromotion(value.promotion);
  if (
    originalPriceCents === null ||
    priceCents === null ||
    promotion === false ||
    originalPriceCents !== basePriceCents ||
    priceCents > originalPriceCents ||
    (promotion === null && priceCents !== originalPriceCents) ||
    (promotion !== null && priceCents >= originalPriceCents)
  )
    return null;
  return { originalPriceCents, priceCents, promotion };
}
function normalizePlan(value: unknown): CommercialPlan | null {
  if (!isRecord(value)) return null;
  const slug = value.slug;
  if (slug !== "operacao" && slug !== "crescimento" && slug !== "rede") return null;
  const name = textValue(value.name);
  const description = textValue(value.description);
  const monthlyPriceCents = nonNegativeInteger(value.monthlyPriceCents);
  const annualPriceCents = nonNegativeInteger(value.annualPriceCents);
  const includedUnits = positiveInteger(value.includedUnits);
  const entitlements = stringArray(value.entitlements);
  const features = stringArray(value.features);
  const displayOrder = nonNegativeInteger(value.displayOrder);
  const ctaLabel = textValue(value.ctaLabel);
  const ctaHref = publicHref(value.ctaHref);
  if (
    !name ||
    !description ||
    monthlyPriceCents === null ||
    annualPriceCents === null ||
    includedUnits === null ||
    !entitlements?.length ||
    !entitlements.every((item) => item in commercialEntitlementLabels) ||
    !features?.length ||
    typeof value.featured !== "boolean" ||
    displayOrder === null ||
    !ctaLabel ||
    !ctaHref ||
    !isRecord(value.offers)
  )
    return null;
  const monthly = normalizeOffer(value.offers.monthly, monthlyPriceCents);
  const annual = normalizeOffer(value.offers.annual, annualPriceCents);
  if (!monthly || !annual) return null;
  return {
    slug,
    name,
    description,
    monthlyPriceCents,
    annualPriceCents,
    includedUnits,
    entitlements,
    features,
    featured: value.featured,
    displayOrder,
    ctaLabel,
    ctaHref,
    offers: { monthly, annual },
  };
}
function normalizeItems<T>(
  value: unknown,
  normalize: (item: unknown) => T | null,
  allowEmpty = false,
): T[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return null;
  const items = value.map(normalize);
  return items.every((item): item is T => item !== null) ? items : null;
}
function normalizeLanding(value: unknown): CommercialLanding | null {
  if (!isRecord(value)) return null;
  const { hero, socialProof, benefits, howItWorks, testimonials, faq, finalCta, legal } = value;
  if (
    !isRecord(hero) ||
    !isRecord(socialProof) ||
    !isRecord(benefits) ||
    !isRecord(howItWorks) ||
    !isRecord(testimonials) ||
    !isRecord(faq) ||
    !isRecord(finalCta) ||
    !isRecord(legal)
  )
    return null;
  const heroMedia = normalizeMedia(hero.media);
  const primaryCtaHref = publicHref(hero.primaryCtaHref);
  const secondaryCtaHref =
    hero.secondaryCtaHref === undefined ? undefined : publicHref(hero.secondaryCtaHref);
  const socialItems = normalizeItems(
    socialProof.items,
    (item) => {
      if (!isRecord(item)) return null;
      const label = textValue(item.label);
      const value = textValue(item.value);
      return label && value ? { label, value } : null;
    },
    true,
  );
  const benefitItems = normalizeItems(benefits.items, (item) => {
    if (!isRecord(item)) return null;
    const title = textValue(item.title);
    const description = textValue(item.description);
    const icon = textValue(item.icon);
    return title && description && icon ? { title, description, icon } : null;
  });
  const steps = normalizeItems(howItWorks.steps, (item) => {
    if (!isRecord(item)) return null;
    const title = textValue(item.title);
    const description = textValue(item.description);
    return title && description ? { title, description } : null;
  });
  const testimonialItems = normalizeItems(
    testimonials.items,
    (item) => {
      if (!isRecord(item)) return null;
      const quote = textValue(item.quote);
      const name = textValue(item.name);
      const role = textValue(item.role);
      return quote && name && role ? { quote, name, role } : null;
    },
    true,
  );
  const faqItems = normalizeItems(faq.items, (item) => {
    if (!isRecord(item)) return null;
    const question = textValue(item.question);
    const answer = textValue(item.answer);
    return question && answer ? { question, answer } : null;
  });
  const finalCtaHref = publicHref(finalCta.ctaHref);
  const terms = normalizeLegalDocument(legal.terms);
  const privacy = normalizeLegalDocument(legal.privacy);
  const normalized = {
    hero: {
      eyebrow: textValue(hero.eyebrow),
      title: textValue(hero.title),
      description: textValue(hero.description),
      primaryCtaLabel: textValue(hero.primaryCtaLabel),
      primaryCtaHref,
      secondaryCtaLabel:
        hero.secondaryCtaLabel === undefined ? undefined : textValue(hero.secondaryCtaLabel),
      secondaryCtaHref,
      media: heroMedia,
    },
    socialProof: { title: textValue(socialProof.title), items: socialItems },
    benefits: { title: textValue(benefits.title), items: benefitItems },
    howItWorks: { title: textValue(howItWorks.title), steps },
    testimonials: { title: textValue(testimonials.title), items: testimonialItems },
    faq: { title: textValue(faq.title), items: faqItems },
    finalCta: {
      title: textValue(finalCta.title),
      description: textValue(finalCta.description),
      ctaLabel: textValue(finalCta.ctaLabel),
      ctaHref: finalCtaHref,
    },
    legal: { terms, privacy },
  };
  if (
    !normalized.hero.eyebrow ||
    !normalized.hero.title ||
    !normalized.hero.description ||
    !normalized.hero.primaryCtaLabel ||
    !normalized.hero.primaryCtaHref ||
    normalized.hero.media === false ||
    (normalized.hero.secondaryCtaLabel === undefined) !==
      (normalized.hero.secondaryCtaHref === undefined) ||
    normalized.hero.secondaryCtaLabel === null ||
    normalized.hero.secondaryCtaHref === null ||
    !normalized.socialProof.title ||
    !normalized.socialProof.items ||
    !normalized.benefits.title ||
    !normalized.benefits.items ||
    !normalized.howItWorks.title ||
    !normalized.howItWorks.steps ||
    !normalized.testimonials.title ||
    !normalized.testimonials.items ||
    !normalized.faq.title ||
    !normalized.faq.items ||
    !normalized.finalCta.title ||
    !normalized.finalCta.description ||
    !normalized.finalCta.ctaLabel ||
    !normalized.finalCta.ctaHref ||
    !normalized.legal.terms ||
    !normalized.legal.privacy ||
    !hasCookiePolicy(normalized.legal.privacy)
  )
    return null;
  return normalized as CommercialLanding;
}
function normalizeLegalDocument(value: unknown): CommercialLegalDocument | null {
  if (!isRecord(value)) return null;
  const version = textValue(value.version);
  const effectiveAt = isoDate(value.effectiveAt);
  const title = textValue(value.title);
  const sections = normalizeItems(value.sections, (item) => {
    if (!isRecord(item)) return null;
    const heading = textValue(item.heading);
    const body = textValue(item.body);
    return heading && body ? { heading, body } : null;
  });
  return version && effectiveAt && title && sections
    ? { version, effectiveAt, title, sections }
    : null;
}
function hasCookiePolicy(document: CommercialLegalDocument): boolean {
  return document.sections.some((section) =>
    section.heading.toLocaleLowerCase("pt-BR").includes("cookie"),
  );
}
function normalizeSeo(value: unknown): CommercialSeo | null {
  if (!isRecord(value)) return null;
  const title = textValue(value.title);
  const description = textValue(value.description);
  const canonicalPath = publicHref(value.canonicalPath);
  const ogImage = normalizeMedia(value.ogImage, false);
  if (!title || !description || !canonicalPath?.startsWith("/") || ogImage === false) return null;
  return { title, description, canonicalPath, ogImage };
}
function normalizeExperiment(value: unknown): CommercialExperiment | null {
  if (!isRecord(value)) return null;
  const slug = textValue(value.slug);
  if (!slug) return null;
  if (value.variant === null) return { slug, variant: null };
  if (!isRecord(value.variant)) return null;
  const key = textValue(value.variant.key);
  const weight = positiveInteger(value.variant.weight);
  const headline = textValue(value.variant.headline);
  const description = textValue(value.variant.description);
  const ctaLabel = textValue(value.variant.ctaLabel);
  const ctaHref = publicHref(value.variant.ctaHref);
  return key && weight && headline && description && ctaLabel && ctaHref
    ? { slug, variant: { key, weight, headline, description, ctaLabel, ctaHref } }
    : null;
}
function queryText(value: string | string[] | undefined, maxLength: number): string | undefined {
  const selected = Array.isArray(value) ? value[0] : value;
  const normalized = selected?.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export function commercialAttributionFromSearchParams(
  parameters: SearchParameters,
): CommercialAttribution | undefined {
  const landingVersion = Number.parseInt(
    queryText(parameters.landing_version ?? parameters.landingVersion, 10) ?? "",
    10,
  );
  const campaignSlug = queryText(parameters.campaign ?? parameters.campaignSlug, 80);
  const utmSource = queryText(parameters.utm_source ?? parameters.utmSource, 120);
  const utmMedium = queryText(parameters.utm_medium ?? parameters.utmMedium, 120);
  const utmCampaign = queryText(parameters.utm_campaign ?? parameters.utmCampaign, 160);
  const utmTerm = queryText(parameters.utm_term ?? parameters.utmTerm, 160);
  const utmContent = queryText(parameters.utm_content ?? parameters.utmContent, 160);
  const attribution = {
    ...(campaignSlug ? { campaignSlug } : {}),
    ...(Number.isInteger(landingVersion) && landingVersion > 0 ? { landingVersion } : {}),
    ...(utmSource ? { utmSource } : {}),
    ...(utmMedium ? { utmMedium } : {}),
    ...(utmCampaign ? { utmCampaign } : {}),
    ...(utmTerm ? { utmTerm } : {}),
    ...(utmContent ? { utmContent } : {}),
  } satisfies CommercialAttribution;
  return Object.values(attribution).some((value) => value !== undefined) ? attribution : undefined;
}
export function commercialAttributionForCatalog(
  attribution: CommercialAttribution | undefined,
  catalog: CommercialCatalog,
  visitorId?: string,
): CommercialAttribution {
  const experiment = visitorId
    ? catalog.experiments.find((candidate) => candidate.variant !== null)
    : undefined;
  return {
    ...attribution,
    landingVersion: catalog.version,
    termsVersion: catalog.landing.legal.terms.version,
    privacyVersion: catalog.landing.legal.privacy.version,
    ...(experiment?.variant
      ? {
          experimentSlug: experiment.slug,
          variantKey: experiment.variant.key,
          visitorId,
        }
      : {}),
  };
}
export function commercialHeroForCatalog(catalog: CommercialCatalog): CommercialLanding["hero"] {
  const experiment = catalog.experiments.find((candidate) => candidate.variant !== null)?.variant;
  return experiment
    ? {
        ...catalog.landing.hero,
        title: experiment.headline,
        description: experiment.description,
        primaryCtaLabel: experiment.ctaLabel,
        primaryCtaHref: experiment.ctaHref,
      }
    : catalog.landing.hero;
}
export function withCommercialAttribution(
  href: string,
  attribution: CommercialAttribution | undefined,
): string {
  if (!attribution || href.startsWith("#")) return href;
  const url = new URL(href, "https://site.giromesa.local");
  const query = {
    campaign: attribution.campaignSlug,
    landing_version: attribution.landingVersion?.toString(),
    utm_source: attribution.utmSource,
    utm_medium: attribution.utmMedium,
    utm_campaign: attribution.utmCampaign,
    utm_term: attribution.utmTerm,
    utm_content: attribution.utmContent,
  };
  for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, value);
  return url.origin === "https://site.giromesa.local"
    ? `${url.pathname}${url.search}${url.hash}`
    : url.toString();
}
export function isPersistedLeadReceipt(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim() === "") return false;
  return typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt));
}
export function normalizeCommercialCatalog(payload: unknown): CommercialCatalog | null {
  if (!isRecord(payload)) return null;
  const version = positiveInteger(payload.version);
  const publishedAt = isoDate(payload.publishedAt);
  const landing = normalizeLanding(payload.landing);
  const seo = normalizeSeo(payload.seo);
  const plans = normalizeItems(payload.plans, normalizePlan)?.sort(
    (left, right) => left.displayOrder - right.displayOrder || left.slug.localeCompare(right.slug),
  );
  const experiments = Array.isArray(payload.experiments)
    ? payload.experiments.map(normalizeExperiment)
    : null;
  if (
    !version ||
    !publishedAt ||
    !landing ||
    !seo ||
    !plans ||
    !experiments?.every((experiment): experiment is CommercialExperiment => experiment !== null)
  )
    return null;
  return { version, publishedAt, landing, seo, plans, experiments };
}
export function annualPriceCents(monthlyPriceCents: number): number {
  if (!Number.isInteger(monthlyPriceCents) || monthlyPriceCents < 0)
    throw new TypeError("O preço mensal deve ser um inteiro não negativo.");
  return monthlyPriceCents * 10;
}
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}
export async function getCommercialCatalog(visitorId?: string): Promise<CommercialCatalogState> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (!apiUrl) return { catalog: null, source: "unavailable" };
  try {
    const response = await fetch(`${apiUrl}/public/v1/commercial-catalog`, {
      cache: "no-store",
      headers: visitorId ? { "x-giromesa-visitor-id": visitorId } : undefined,
    });
    if (!response.ok) throw new Error("Catálogo indisponível");
    const catalog = normalizeCommercialCatalog(await response.json());
    if (!catalog) throw new Error("Catálogo inválido");
    return { catalog, source: "api" };
  } catch {
    return { catalog: null, source: "unavailable" };
  }
}
