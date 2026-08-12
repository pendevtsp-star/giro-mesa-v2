import { describe, expect, it } from "vitest";
import { profiles } from "./demo-data";
import { rolePresentation } from "./role-presentation";
import { canAccess } from "./rules";

const operationalProfiles = ["owner", "manager", "cashier", "waiter", "kitchen"] as const;

function profileById(id: (typeof operationalProfiles)[number]) {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error(`Perfil ${id} ausente no cenário demonstrativo.`);
  return profile;
}

describe("apresentação operacional por perfil", () => {
  it.each(operationalProfiles)("mantém o atalho principal de %s dentro das permissões", (id) => {
    const profile = profileById(id);
    const presentation = rolePresentation(profile);

    expect(presentation.label).toBe(profile.role);
    expect(presentation.summary).toBe(profile.description);
    expect(canAccess(profile, presentation.primaryRoute)).toBe(true);
  });

  it("distingue supervisão, serviço, transação e produção sem criar métricas", () => {
    expect(rolePresentation(profileById("owner")).density).toBe("oversight");
    expect(rolePresentation(profileById("manager")).density).toBe("oversight");
    expect(rolePresentation(profileById("waiter")).density).toBe("service");
    expect(rolePresentation(profileById("cashier")).density).toBe("transaction");
    expect(rolePresentation(profileById("kitchen")).density).toBe("production");
  });
});
