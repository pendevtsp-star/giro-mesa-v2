import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Profile } from "../../domain";
import { ProfileAvatar, profileAvatarFileError } from "./ProfileAvatar";

const profile: Profile = {
  id: "owner",
  name: "QA Dados",
  shortName: "QA",
  role: "Proprietária",
  description: "Gestão",
  permissions: [],
};

describe("avatar do perfil", () => {
  it("aceita apenas imagens compatíveis de até 1 MB", () => {
    expect(profileAvatarFileError({ size: 500_000, type: "image/webp" })).toBeNull();
    expect(profileAvatarFileError({ size: 500_000, type: "image/svg+xml" })).toContain("JPG");
    expect(profileAvatarFileError({ size: 1_000_001, type: "image/png" })).toContain("1 MB");
  });

  it("renderiza a foto quando disponível", () => {
    const html = renderToStaticMarkup(
      <ProfileAvatar imageUrl="data:image/png;base64,AA==" profile={profile} />,
    );
    expect(html).toContain('<img alt="" src="data:image/png;base64,AA=="');
    expect(html).not.toContain(">QD<");
  });
});
