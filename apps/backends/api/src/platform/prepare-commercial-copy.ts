import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { type CommercialDraftUpdate, commercialDraftUpdateSchema } from "./platform.schemas.js";

const reason = "Corrigir comunicação legada sobre teste assistido e disponibilidade offline.";

export function correctLegacyCommercialCopy(input: CommercialDraftUpdate) {
  const draft = structuredClone(input);
  const hero = draft.landing.hero;
  if (hero.primaryCtaLabel === "Testar 14 dias grátis" && hero.primaryCtaHref === "/teste-gratis")
    hero.primaryCtaLabel = "Solicitar teste assistido";
  if (
    hero.description ===
    "Pedidos, produção, estoque, caixa e decisões conectados em uma operação feita para o ritmo real do seu negócio."
  )
    hero.description += " Teste assistido de 14 dias após a ativação, sem cartão.";
  if (hero.secondaryCtaLabel === "Conhecer o produto" && hero.secondaryCtaHref === "/#produto")
    hero.secondaryCtaLabel = "Explorar recursos";
  for (const plan of draft.plans) {
    if (!["operacao", "crescimento", "rede"].includes(plan.slug)) continue;
    if (
      plan.ctaLabel === "Testar este plano" &&
      plan.ctaHref === `/teste-gratis?plano=${plan.slug}`
    )
      plan.ctaLabel = "Solicitar teste assistido";
    if (plan.slug === "operacao")
      plan.features = plan.features.map((feature) =>
        feature === "QR na mesa e hub offline" ? "QR na mesa" : feature,
      );
  }
  for (const benefit of draft.landing.benefits.items) {
    if (
      benefit.title === "Continuidade local" &&
      benefit.description ===
        "O hub planejado mantém a operação essencial da unidade durante falhas de internet."
    )
      benefit.description =
        "A continuidade sem internet ainda não está disponível. Consulte nossa equipe para acompanhar a disponibilidade.";
  }
  for (const item of draft.landing.faq.items) {
    if (
      item.question === "O GiroMesa funciona sem internet?" &&
      item.answer ===
        "A continuidade offline depende do aplicativo e hub local. Ela será disponibilizada comercialmente somente após a homologação do piloto."
    )
      item.answer =
        "A continuidade sem internet ainda não está disponível. Nossa equipe informa a disponibilidade antes da contratação.";
  }
  return draft;
}

const previewSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  sourceVersionId: z.uuid().nullable(),
  landing: z.unknown(),
  seo: z.unknown(),
  plans: z.array(z.record(z.string(), z.unknown())),
  promotions: z.array(z.record(z.string(), z.unknown())),
  experiments: z.array(z.record(z.string(), z.unknown())),
});

function draftInput(preview: z.infer<typeof previewSchema>) {
  const editable = (row: Record<string, unknown>, preserveId = false) =>
    Object.fromEntries(
      Object.entries(row).filter(
        ([key, value]) =>
          value !== null &&
          !["catalogVersionId", "createdAt", "updatedAt", ...(preserveId ? [] : ["id"])].includes(
            key,
          ),
      ),
    );
  return commercialDraftUpdateSchema.parse({
    reason,
    landing: preview.landing,
    seo: preview.seo,
    plans: preview.plans.map((plan) => editable(plan)),
    promotions: preview.promotions.map((promotion) => editable(promotion, true)),
    experiments: preview.experiments.map((experiment) => editable(experiment)),
  });
}

export async function prepareCommercialCopy(
  options: { apiUrl: string; token: string; sourceVersionId: string; apply?: boolean },
  fetcher: typeof fetch = fetch,
) {
  const sourceVersionId = z.uuid().parse(options.sourceVersionId);
  const api = new URL(options.apiUrl);
  if (
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    api.pathname !== "/" ||
    (api.protocol !== "https:" &&
      !(api.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname)))
  )
    throw new Error("Use a origem HTTPS da API; HTTP é permitido somente em localhost.");
  if (!options.token.trim()) throw new Error("COMMERCIAL_SESSION_TOKEN é obrigatório.");
  const request = async (path: string, method = "GET", body?: unknown, key?: string) => {
    const response = await fetcher(new URL(`/v1/platform/commercial/${path}`, api), {
      method,
      redirect: "error",
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error(`API comercial: ${method} ${path} retornou ${response.status}.`);
    return response.json();
  };
  const source = previewSchema.parse(await request(`versions/${sourceVersionId}/preview`));
  if (source.id !== sourceVersionId || source.status !== "published")
    throw new Error("A origem deve ser a versão publicada indicada.");
  const original = draftInput(source);
  const payload = correctLegacyCommercialCopy(original);
  if (!options.apply || JSON.stringify(payload) === JSON.stringify(original))
    return {
      status: "preview",
      sourceVersionId,
      changed: JSON.stringify(payload) !== JSON.stringify(original),
      payload,
    };

  const created = z
    .object({ id: z.uuid(), replayed: z.boolean() })
    .parse(
      await request(
        "drafts",
        "POST",
        { reason, sourceVersionId },
        `legacy-copy-create-${sourceVersionId}`,
      ),
    );
  const draft = previewSchema.parse(await request(`versions/${created.id}/preview`));
  if (
    draft.id !== created.id ||
    draft.status !== "draft" ||
    draft.sourceVersionId !== sourceVersionId
  )
    throw new Error("O rascunho retornado não está editável ou não corresponde à origem.");
  // Use the copied rows: promotion IDs from the published version must never be reused.
  const corrected = correctLegacyCommercialCopy(draftInput(draft));
  // A replay may point to a draft since edited by another operator; never write it automatically.
  if (created.replayed)
    return { status: "review_required", sourceVersionId, draftId: draft.id, payload: corrected };
  const hash = createHash("sha256").update(JSON.stringify(corrected)).digest("hex");
  await request(`drafts/${draft.id}`, "PUT", corrected, `legacy-copy-update-${hash}`);
  const persisted = previewSchema.parse(await request(`versions/${draft.id}/preview`));
  if (
    persisted.id !== draft.id ||
    persisted.status !== "draft" ||
    JSON.stringify(draftInput(persisted)) !== JSON.stringify(corrected)
  )
    throw new Error("A leitura após gravação não confirmou o rascunho corrigido.");
  return { status: "draft", sourceVersionId, draftId: draft.id, payload: corrected };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sourceVersionId, mode] = process.argv.slice(2);
  if (!sourceVersionId || (mode && mode !== "--apply"))
    throw new Error("Uso: prepare-commercial-copy.js <versão publicada UUID> [--apply]");
  const result = await prepareCommercialCopy({
    apiUrl: process.env.API_URL ?? "http://localhost:3200",
    token: process.env.COMMERCIAL_SESSION_TOKEN ?? "",
    sourceVersionId,
    apply: mode === "--apply",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
