import { Button, Card } from "@giromesa/ui";
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
      <Card className="crm-page-navigation">
        <div>
          <p className="eyebrow">Relacionamento</p>
          <h2>Central de CRM</h2>
          <p>Atenda primeiro; abra cadastro ou campanhas quando a tarefa exigir.</p>
        </div>
        <nav aria-label="Áreas do CRM">
          <Button aria-pressed={view === "service"} onClick={() => setView("service")} size="sm">
            Atendimento
          </Button>
          <Button
            aria-pressed={view === "customers"}
            onClick={() => setView("customers")}
            size="sm"
            variant="secondary"
          >
            Clientes
          </Button>
          <Button
            aria-pressed={view === "campaigns"}
            onClick={() => setView("campaigns")}
            size="sm"
            variant="secondary"
          >
            Benefícios e campanhas
          </Button>
        </nav>
      </Card>
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
