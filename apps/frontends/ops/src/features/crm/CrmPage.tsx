import type { GrowthScope } from "../../growth.shared";
import { CrmBenefitsCampaigns } from "./CrmBenefitsCampaigns";
import { CrmCustomerWorkspace } from "./CrmCustomerWorkspace";
import { CrmWhatsappWorkspace } from "./CrmWhatsappWorkspace";
import "./crm.css";

export function RealCrmPage({ scope }: { scope: GrowthScope }) {
  return (
    <div className="growth-stack crm-page">
      <CrmCustomerWorkspace scope={scope} />
      <CrmWhatsappWorkspace scope={scope} />
      <CrmBenefitsCampaigns scope={scope} />
    </div>
  );
}
