import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge, Button, ICON_NAMES, Icon, Progress } from "./index";

describe("componentes compartilhados", () => {
  it("mantém semântica nativa e estado acessível", () => {
    const html = renderToStaticMarkup(
      <div>
        <Button disabled>Salvar</Button>
        <Badge tone="success">Sincronizado</Badge>
        <Progress label="Implantação" value={140} />
      </div>,
    );

    expect(html).toContain("<button");
    expect(html).toContain("disabled");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="100"');
  });

  it("renderiza uma família SVG consistente sem glifos de fonte", () => {
    const html = renderToStaticMarkup(
      <div>
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} />
        ))}
      </div>,
    );

    expect(html.match(/<svg/g)).toHaveLength(ICON_NAMES.length);
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/[⌂◫▦▤◉◇▱♙▻◷♡⌘◎]/u);
  });

  it("expõe nome acessível somente quando o ícone comunica informação", () => {
    const decorative = renderToStaticMarkup(<Icon name="home" />);
    const labelled = renderToStaticMarkup(<Icon label="Início" name="home" />);

    expect(decorative).toContain('aria-hidden="true"');
    expect(labelled).toContain('aria-label="Início"');
    expect(labelled).toContain('role="img"');
    expect(labelled).not.toContain('aria-hidden="true"');
  });
});
