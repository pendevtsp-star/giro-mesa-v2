import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { iconNames, UiIcon } from "./ui-icon";

describe("ícones operacionais", () => {
  it("renderiza todos os ícones como SVG sem glifos textuais", () => {
    for (const name of iconNames) {
      const html = renderToStaticMarkup(<UiIcon name={name} />);
      expect(html).toContain("<svg");
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/<svg[^>]*>[^<]+<\/svg>/);
    }
  });
});
