import { EmptyState } from "@giromesa/ui";
import { lazy } from "react";
import type { Profile, RouteId } from "../domain";
import type { KdsArea } from "../features/kds/kds.navigation";
import type { PilotDispatcher, PilotLoader } from "../operational-dispatch";
import type { Session } from "./types";

const RealCatalogPage = lazy(() =>
  import("../features/catalog/CatalogPage").then((module) => ({ default: module.RealCatalogPage })),
);
const RealCounterPage = lazy(() =>
  import("../features/counter/CounterPage").then((module) => ({ default: module.RealCounterPage })),
);
const RealKdsPage = lazy(() =>
  import("../features/kds/KdsPage").then((module) => ({ default: module.RealKdsPage })),
);
const RealSalonPage = lazy(() =>
  import("../features/salon/SalonPage").then((module) => ({ default: module.RealSalonPage })),
);
const RealCashPage = lazy(() =>
  import("../features/cash/CashPage").then((module) => ({ default: module.RealCashPage })),
);
const RealDashboard = lazy(() =>
  import("../features/dashboard/DashboardPage").then((module) => ({
    default: module.RealDashboard,
  })),
);
const RealFinancePage = lazy(() =>
  import("../features/finance/FinancePage").then((module) => ({ default: module.RealFinancePage })),
);
const RealReportsPage = lazy(() =>
  import("../features/reports/ReportsPage").then((module) => ({ default: module.RealReportsPage })),
);
const RealFiscalPage = lazy(() =>
  import("../features/fiscal/FiscalPages").then((module) => ({ default: module.RealFiscalPage })),
);
const RealAccountantPage = lazy(() =>
  import("../features/fiscal/FiscalPages").then((module) => ({
    default: module.RealAccountantPage,
  })),
);
const RealInventoryPage = lazy(() =>
  import("../features/inventory/InventoryPage").then((module) => ({
    default: module.RealInventoryPage,
  })),
);
const RealPeoplePage = lazy(() =>
  import("../features/people/PeoplePage").then((module) => ({ default: module.RealPeoplePage })),
);
const RealPurchasesPage = lazy(() =>
  import("../features/purchases/PurchasesPage").then((module) => ({
    default: module.RealPurchasesPage,
  })),
);
const RealCrmPage = lazy(() =>
  import("../features/crm/CrmPage").then((module) => ({ default: module.RealCrmPage })),
);
const RealDeliveryPage = lazy(() =>
  import("../features/delivery/DeliveryPage").then((module) => ({
    default: module.RealDeliveryPage,
  })),
);
const RealMultiunitPage = lazy(() =>
  import("../features/multiunit/MultiunitPage").then((module) => ({
    default: module.RealMultiunitPage,
  })),
);
const RealReservationsPage = lazy(() =>
  import("../features/reservations/ReservationsPage").then((module) => ({
    default: module.RealReservationsPage,
  })),
);
const RealPlatformPage = lazy(() =>
  import("../platform").then((module) => ({ default: module.RealPlatformPage })),
);

export const pageMeta: Partial<Record<RouteId, { title: string; description: string }>> = {
  dashboard: {
    title: "Visão geral",
    description: "O que precisa da sua atenção agora.",
  },
  salon: {
    title: "Mesas e comandas",
    description: "Atendimento de mesas, comandas e chamados do salão.",
  },
  counter: {
    title: "Balcão e retirada",
    description: "Lançamento rápido para consumo local ou retirada.",
  },
  catalog: {
    title: "Cardápio operacional",
    description: "Produtos, preços, disponibilidade e complementos desta unidade.",
  },
  kds: { title: "Produção", description: "Fila de preparo por estação." },
  cash: {
    title: "Contas e caixa",
    description: "Recebimentos, conferência e turno.",
  },
  inventory: {
    title: "Estoque",
    description: "Saldos, rupturas, consumo e reposição.",
  },
  purchases: {
    title: "Compras",
    description: "Pedidos, aprovações e recebimentos.",
  },
  finance: {
    title: "Financeiro",
    description: "Contas, conciliação e caixa projetado.",
  },
  reports: {
    title: "Relatórios",
    description: "Fluxo de caixa e resultado financeiro desta unidade por período.",
  },
  fiscal: {
    title: "Fiscal",
    description: "Emissão, pendências, documentos e fechamento por competência.",
  },
  accountant: {
    title: "Portal do contador",
    description: "Competências, pacote contábil e solicitações desta unidade.",
  },
  people: {
    title: "Pessoas",
    description: "Equipe, escalas, ponto e comissões.",
  },
  delivery: {
    title: "Delivery",
    description: "Pedidos operacionais e zonas próprias desta unidade.",
  },
  reservations: {
    title: "Recepção e espera",
    description: "Agenda, recepção e transições operacionais confirmadas.",
  },
  crm: {
    title: "Clientes e campanhas",
    description: "Relacionamento, fidelidade, consentimento e status de campanhas.",
  },
  multiunit: {
    title: "Multiunidade",
    description: "Resumo consolidado dos registros persistidos na organização.",
  },
  platform: {
    title: "Plataforma",
    description: "Organizações, unidades e saúde operacional.",
  },
  alerts: {
    title: "Central de alertas",
    description: "Exceções priorizadas com ação recomendada.",
  },
};

export function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}

export function PageContent({
  dispatchPilot,
  loadPilot,
  route,
  kdsArea,
  canManageKdsUnitSettings,
  refreshToken,
  session,
  profile,
}: {
  dispatchPilot: PilotDispatcher;
  loadPilot: PilotLoader;
  route: RouteId;
  kdsArea: KdsArea;
  canManageKdsUnitSettings: boolean;
  refreshToken: number;
  session: Session;
  profile: Profile;
}) {
  const managementScope = {
    organizationId: session.organizationId,
    unitId: session.unitId,
    profileId: session.profile.id,
    refreshToken,
  };
  const pilotScope = {
    ...managementScope,
    identityId: session.identityId,
    membershipId: session.membershipId,
    dispatch: dispatchPilot,
    load: loadPilot,
  };

  switch (route) {
    case "dashboard":
      return (
        <RealDashboard
          key={`${session.organizationId}:${session.unitId}:${profile.id}`}
          profile={profile}
          scope={managementScope}
          unitName={session.unit.name}
        />
      );
    case "salon":
      return <RealSalonPage scope={pilotScope} />;
    case "counter":
      return <RealCounterPage scope={pilotScope} />;
    case "catalog":
      return <RealCatalogPage scope={pilotScope} />;
    case "kds":
      return (
        <RealKdsPage
          area={kdsArea}
          canManageUnitSettings={canManageKdsUnitSettings}
          scope={pilotScope}
        />
      );
    case "cash":
      return <RealCashPage scope={managementScope} />;
    case "inventory":
      return <RealInventoryPage scope={managementScope} />;
    case "purchases":
      return <RealPurchasesPage scope={managementScope} />;
    case "finance":
      return <RealFinancePage scope={managementScope} />;
    case "reports":
      return <RealReportsPage scope={managementScope} />;
    case "fiscal":
      return <RealFiscalPage scope={managementScope} />;
    case "accountant":
      return <RealAccountantPage scope={managementScope} />;
    case "people":
      return <RealPeoplePage scope={managementScope} />;
    case "delivery":
      return (
        <RealDeliveryPage
          canManage={profile.permissions.includes("growth.manage")}
          scope={managementScope}
        />
      );
    case "reservations":
      return <RealReservationsPage scope={managementScope} />;
    case "crm":
      return <RealCrmPage scope={managementScope} />;
    case "multiunit":
      return <RealMultiunitPage scope={managementScope} />;
    case "platform":
      return session.platformAdmin ? (
        <RealPlatformPage refreshToken={refreshToken} />
      ) : (
        <UnavailableRealPage title="Administração da plataforma" />
      );
    case "alerts":
      return <UnavailableRealPage title="Central de alertas" />;
  }
}

function UnavailableRealPage({ title }: { title: string }) {
  return (
    <EmptyState
      icon="◇"
      title={`${title} sem fonte autenticada`}
      description="Esta V2 não exibe fixtures em sessões reais. A tela será ativada quando houver um endpoint autenticado correspondente."
    />
  );
}
