import { createServer } from "node:http";

// Controlled menu fixture; order transitions are mocked explicitly by the browser test.
const menu = {
  version: 1,
  metadata: { branding: { displayName: "Teste de acompanhamento" } },
  items: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      category: "Pratos",
      name: "Prato de teste",
      description: "Produto da validação automatizada",
      priceCents: 2990,
      visual: "",
      available: true,
    },
  ],
};
createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(request.url === "/health" ? { ok: true } : menu));
}).listen(3213, "127.0.0.1");
