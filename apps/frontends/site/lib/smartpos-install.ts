import { resolveOpsUrl } from "./auth-navigation.ts";

export type SmartPosVendor = "browser" | "rede" | "paygo" | "stone" | "other";

type InstallDestinationInput = {
  vendor: SmartPosVendor;
  currentOrigin: string;
  opsUrl?: string;
  storeUrls?: Partial<Record<Exclude<SmartPosVendor, "browser" | "other">, string>>;
};

export type InstallDestination = {
  kind: "pwa" | "store" | "homologation";
  href: string;
  label: string;
};

function resolveOfficialStoreUrl(configuredUrl: string | undefined, currentOrigin: string) {
  if (!configuredUrl || !/^https:\/\//i.test(configuredUrl)) return null;
  const href = resolveOpsUrl(configuredUrl, currentOrigin);
  if (!href) return null;
  const url = new URL(href);
  return url.username || url.password ? null : href;
}

export function resolveSmartPosInstallDestination({
  vendor,
  currentOrigin,
  opsUrl,
  storeUrls = {},
}: InstallDestinationInput): InstallDestination {
  if (vendor === "browser") {
    const href = resolveOpsUrl(opsUrl, currentOrigin);
    return href
      ? { kind: "pwa", href, label: "Abrir e instalar a PWA" }
      : { kind: "homologation", href: "/contato?assunto=instalacao", label: "Configurar acesso" };
  }

  if (vendor !== "other") {
    const href = resolveOfficialStoreUrl(storeUrls[vendor], currentOrigin);
    if (href) return { kind: "store", href, label: "Abrir canal oficial" };
  }

  return {
    kind: "homologation",
    href: "/contato?assunto=homologacao-smartpos",
    label: "Solicitar homologação",
  };
}
