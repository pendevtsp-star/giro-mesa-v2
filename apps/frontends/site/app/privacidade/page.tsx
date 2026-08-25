import type { Metadata } from "next";
import { LegalDocument } from "../../components/legal-document";
import { getCommercialCatalog } from "../../lib/commercial";

export const metadata: Metadata = { title: "Privacidade" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const state = await getCommercialCatalog();
  return <LegalDocument document={state.catalog?.landing.legal.privacy ?? null} />;
}
