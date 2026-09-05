import type { Permission, Profile, ProfileId } from "./domain";

const basePermissions: Permission[] = ["dashboard.view"];

function profile(
  id: ProfileId,
  role: string,
  description: string,
  permissions: Permission[],
): Profile {
  return {
    id,
    name: role,
    shortName: role
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join(""),
    role,
    description,
    permissions: [...basePermissions, ...permissions],
  };
}

export const profiles: Profile[] = [
  profile("owner", "Proprietária", "Visão completa da operação e gestão", [
    "salon.operate",
    "counter.operate",
    "catalog.manage",
    "kds.operate",
    "cash.operate",
    "inventory.manage",
    "purchases.manage",
    "finance.manage",
    "fiscal.manage",
    "accounting.view",
    "people.manage",
    "people.view",
    "settlements.view",
    "delivery.operate",
    "reservations.manage",
    "growth.manage",
    "multiunit.view",
    "billing.manage",
    "settings.manage",
  ]),
  profile("manager", "Gerente", "Turno, equipe, aprovações e exceções", [
    "salon.operate",
    "counter.operate",
    "catalog.manage",
    "kds.operate",
    "cash.operate",
    "inventory.manage",
    "purchases.manage",
    "finance.manage",
    "fiscal.manage",
    "accounting.view",
    "people.manage",
    "people.view",
    "settlements.view",
    "delivery.operate",
    "reservations.manage",
    "growth.manage",
    "multiunit.view",
    "settings.manage",
  ]),
  profile("waiter", "Garçom", "Mesas, chamados e pedidos", [
    "salon.operate",
    "counter.operate",
    "catalog.manage",
    "reservations.manage",
  ]),
  profile("cashier", "Caixa", "Recebimentos, turnos e fechamento", [
    "salon.operate",
    "counter.operate",
    "catalog.manage",
    "cash.operate",
    "settlements.view",
  ]),
  profile("receptionist", "Recepcionista", "Reservas, espera e acomodação", [
    "reservations.manage",
    "salon.operate",
  ]),
  profile("busser", "Cumim / apoio", "Chamados, entrega e giro de mesas", ["salon.operate"]),
  profile("kitchen", "Cozinha / KDS", "Produção e disponibilidade", [
    "catalog.manage",
    "kds.operate",
  ]),
  profile("inventory", "Estoque e compras", "Suprimentos, contagens e perdas", [
    "inventory.manage",
    "purchases.manage",
  ]),
  profile("finance", "Financeiro", "Contas, conciliação e margem", [
    "cash.operate",
    "purchases.manage",
    "finance.manage",
    "fiscal.manage",
    "accounting.view",
    "people.view",
    "settlements.view",
  ]),
  profile("accountant", "Contador", "Competências, pacotes e solicitações", ["accounting.view"]),
  profile("delivery", "Delivery", "Pedidos, prazos e despacho", [
    "counter.operate",
    "catalog.manage",
    "delivery.operate",
    "reservations.manage",
  ]),
  profile("platform", "Plataforma", "Tenants, suporte e incidentes", ["platform.manage"]),
];
