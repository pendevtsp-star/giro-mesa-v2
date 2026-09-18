import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CrmBenefitsCampaigns,
  CrmCampaignMessagePreview,
  CrmLoyaltyProgramForm,
} from "./CrmBenefitsCampaigns";
import { parseCrmCampaign, parseCrmLoyaltyProgram } from "./crm.model";

describe("CRM campaign review and loyalty settings", () => {
  it("renders the saved subject and both message variants as plain text", () => {
    const campaign = parseCrmCampaign({
      id: "saved-1",
      name: "Campanha salva",
      channel: "email",
      status: "draft",
      subject: "Assunto persistido",
      content: "Mensagem A\n<script>alert(1)</script>",
      variantBContent: "Mensagem B persistida",
      attributionWindowDays: 14,
      holdoutPercentage: 10,
    });
    const html = renderToStaticMarkup(<CrmCampaignMessagePreview campaign={campaign} />);
    expect(html).toContain("Assunto persistido");
    expect(html).toContain("Mensagem A\n&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Mensagem B persistida");
    expect(html).toContain("14 dia(s)");
    expect(html).toContain("10%");
    expect(html).not.toContain("<script>");
  });

  it("renders current inactive loyalty values including expiry without activating them", () => {
    const program = parseCrmLoyaltyProgram({
      id: "program-1",
      mode: "cashback",
      rate: "2.75",
      minimumOrderCents: 3590,
      expiresAfterDays: 120,
      active: false,
    });
    const html = renderToStaticMarkup(
      <CrmLoyaltyProgramForm
        program={program}
        disabled={false}
        saving={false}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain("Programa desativado");
    expect(html).toContain('value="2,75"');
    expect(html).toContain('value="35,90"');
    expect(html).toContain('value="120"');
    expect(html).toContain('<option value="cashback" selected="">');
    expect(html).not.toContain('checked=""');
  });

  it("keeps advanced campaign options collapsed and does not expose an unloaded loyalty form", () => {
    const html = renderToStaticMarkup(
      <CrmBenefitsCampaigns
        scope={{ organizationId: "org-1", unitId: "unit-1", profileId: "owner", refreshToken: 0 }}
      />,
    );
    expect(html).toContain('<details class="gm-disclosure action-form__wide">');
    expect(html).toContain("Comparar mensagens e acompanhar resultados");
    expect(html).not.toContain("Salvar programa");
  });
});
