import { describe, expect, it } from "vitest";
import { buildTableQrPrintHtml, escapeCatalogHtml, selectTableQrRows } from "./catalog.print";

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

  it("imprime apenas IDs reais selecionados em ordem natural", () => {
    const rows = [
      { tableId: "table-10", label: "Mesa 10", dataUrl: "10" },
      { tableId: "counter", label: "Balcão", dataUrl: "counter" },
      { tableId: "table-2", label: "Mesa 2", dataUrl: "2" },
    ];

    expect(selectTableQrRows(rows, new Set(["table-10", "table-2"]))).toEqual([rows[2], rows[0]]);
    expect(rows[0]?.label).toBe("Mesa 10");
  });

  it("inclui Wi-Fi somente quando solicitado pelo chamador", () => {
    const rows = [{ label: "Mesa 1", dataUrl: "data:image/svg+xml,qr" }];

    expect(buildTableQrPrintHtml(rows)).not.toContain("Wi-Fi da casa");
    expect(buildTableQrPrintHtml(rows, { wifiNotice: "Wi-Fi da casa" })).toContain("Wi-Fi da casa");
  });
});
