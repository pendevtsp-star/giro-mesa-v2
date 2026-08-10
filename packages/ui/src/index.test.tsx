import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge, Button, Progress } from "./index";

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
});
