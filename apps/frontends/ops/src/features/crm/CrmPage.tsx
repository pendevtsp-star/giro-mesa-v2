import { Button } from "@giromesa/ui";
import { useState } from "react";
import type { GrowthScope } from "../../growth.shared";
import { CrmBenefitsCampaigns } from "./CrmBenefitsCampaigns";
import { CrmCustomerWorkspace } from "./CrmCustomerWorkspace";
import { CrmWhatsappWorkspace } from "./CrmWhatsappWorkspace";
import "./crm.css";

export function RealCrmPage({ scope }: { scope: GrowthScope }) {
  const [view, setView] = useState<"service" | "customers" | "campaigns">("service");
  const [focusedCustomerId, setFocusedCustomerId] = useState<string>();

  function openCustomer(customerId: string) {
    setFocusedCustomerId(customerId);
    setView("customers");
  }

  return (
    <div className="growth-stack crm-page">
      <header className="crm-page-navigation">
        <h1>Clientes e campanhas</h1>
        <nav aria-label="Áreas de relacionamento">
          <Button
            aria-pressed={view === "service"}
            onClick={() => setView("service")}
            size="sm"
            variant={view === "service" ? "primary" : "secondary"}
          >
            Atendimento
          </Button>
          <Button
            aria-pressed={view === "customers"}
            onClick={() => setView("customers")}
            size="sm"
            variant={view === "customers" ? "primary" : "secondary"}
          >
            Clientes
          </Button>
          <Button
            aria-pressed={view === "campaigns"}
            onClick={() => setView("campaigns")}
            size="sm"
            variant={view === "campaigns" ? "primary" : "secondary"}
          >
            Benefícios e campanhas
          </Button>
        </nav>
      </header>
      {view === "service" ? (
        <CrmWhatsappWorkspace onOpenCustomer={openCustomer} scope={scope} />
      ) : null}
      {view === "customers" ? (
        <CrmCustomerWorkspace focusedCustomerId={focusedCustomerId} scope={scope} />
      ) : null}
      {view === "campaigns" ? <CrmBenefitsCampaigns scope={scope} /> : null}
    </div>
  );
}
