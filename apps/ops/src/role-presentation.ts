import type { Profile, ProfileId, RouteId } from "./domain";

export type RoleDensity = "oversight" | "service" | "transaction" | "production" | "focused";

export type RolePresentation = {
  density: RoleDensity;
  label: string;
  summary: string;
  title: string;
  primaryAction: string;
  primaryRoute: RouteId;
};

const roleDetails: Partial<Record<ProfileId, Omit<RolePresentation, "label" | "summary">>> = {
  owner: {
    density: "oversight",
    title: "Leitura executiva do turno",
    primaryAction: "Revisar financeiro",
    primaryRoute: "finance",
  },
  manager: {
    density: "oversight",
    title: "Exceções e ritmo da operação",
    primaryAction: "Acompanhar salão",
    primaryRoute: "salon",
  },
  waiter: {
    density: "service",
    title: "Mesas e chamados em primeiro plano",
    primaryAction: "Abrir salão",
    primaryRoute: "salon",
  },
  cashier: {
    density: "transaction",
    title: "Recebimentos e fechamento sem ruído",
    primaryAction: "Abrir caixa",
    primaryRoute: "cash",
  },
  kitchen: {
    density: "production",
    title: "Fila de produção pronta para ação",
    primaryAction: "Abrir produção",
    primaryRoute: "kds",
  },
  inventory: {
    density: "focused",
    title: "Suprimentos e reposição do turno",
    primaryAction: "Abrir estoque",
    primaryRoute: "inventory",
  },
  finance: {
    density: "focused",
    title: "Conciliação e compromissos do período",
    primaryAction: "Abrir financeiro",
    primaryRoute: "finance",
  },
  delivery: {
    density: "focused",
    title: "Pedidos e despacho do canal",
    primaryAction: "Abrir delivery",
    primaryRoute: "delivery",
  },
  platform: {
    density: "focused",
    title: "Saúde operacional da plataforma",
    primaryAction: "Abrir plataforma",
    primaryRoute: "platform",
  },
};

export function rolePresentation(profile: Profile): RolePresentation {
  const details = roleDetails[profile.id] ?? {
    density: "focused" as const,
    title: "Operação do perfil",
    primaryAction: "Abrir visão geral",
    primaryRoute: "dashboard" as const,
  };

  return {
    ...details,
    label: profile.role,
    summary: profile.description,
  };
}
