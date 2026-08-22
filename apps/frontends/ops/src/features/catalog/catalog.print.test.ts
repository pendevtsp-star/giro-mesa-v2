import { describe, expect, it } from "vitest";
import { buildTableQrPrintHtml, escapeCatalogHtml } from "./catalog.print";

describe("impressão do catálogo", () => {
  it("escapa conteúdo inserido no documento HTML", () => {
    expect(escapeCatalogHtml(`<Mesa "A" & 'B'>`)).toBe(
      "&lt;Mesa &quot;A&quot; &amp; &#039;B&#039;&gt;",
    );

    const html = buildTableQrPrintHtml([
      { label: `Mesa <script>alert('x')</script>`, dataUrl: `data:image/svg+xml;a="b"&c=<d>` },
    ]);

    expect(html).toContain("Mesa &lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt;");
    expect(html).toContain('src="data:image/svg+xml;a=&quot;b&quot;&amp;c=&lt;d&gt;"');
    expect(html).not.toContain("<script>alert('x')</script>");
  });

  it("aplica a marca sem permitir injeção em imagem ou CSS", () => {
    const html = buildTableQrPrintHtml(
      [{ label: "Mesa 1", dataUrl: "data:image/png;base64,AA==" }],
      {
        displayName: "Casa <Boa>",
        logoUrl: 'https://cdn.example/logo.png" onerror="alert(1)',
        primaryColor: "red;display:none",
      },
    );
    expect(html).toContain("Casa &lt;Boa&gt;");
    expect(html).toContain("#059669");
    expect(html).not.toContain('onerror="alert(1)"');
  });
});
