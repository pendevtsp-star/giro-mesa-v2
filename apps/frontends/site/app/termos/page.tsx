import type { Metadata } from "next";
import { LegalDocument } from "../../components/legal-document";
import { getCommercialCatalog } from "../../lib/commercial";

export const metadata: Metadata = { title: "Termos de Uso" };
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const state = await getCommercialCatalog();
  return <LegalDocument document={state.catalog?.landing.legal.terms ?? null} />;
}
