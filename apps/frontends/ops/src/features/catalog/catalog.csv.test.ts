import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "../../operations.shared";
import { catalogCsvTemplate, parseCatalogCsv, serializeCatalogCsv } from "./catalog.csv";

const product = {
  id: "product-1",
  categoryId: "category-1",
  sku: null,
  name: 'Burger "Supreme"',
  description: "Molho; tomate, especial",
  imageUrl: null,
  stationIds: [],
  priceCents: 4_290,
  deliveryPriceCents: 0,
  costCents: 1_450,
  tags: ["chef_special", "bestseller"],
  estimatedPrepTimeMinutes: 20,
  dailyStockLimit: 0,
  available: true,
  active: true,
  allergenIds: [],
  modifierGroupIds: [],
  ncm: "2106.90.90",
  cfop: "5.102",
  recipe: [],
} satisfies CatalogProduct;

describe("CSV do catálogo", () => {
  it("serializa o formato canônico e preserva centavos e tipos no round-trip", () => {
    const csv = serializeCatalogCsv({
      categories: [{ id: "category-1", name: "Lanches; especiais" }],
      products: [product],
    });

    expect(csv).toContain('"Burger ""Supreme"""');
    expect(csv).toContain('"Lanches; especiais"');
    expect(csv).toContain(";42.90;0.00;14.50;");
    expect(parseCatalogCsv(csv)).toEqual([
      {
        id: "product-1",
        name: 'Burger "Supreme"',
        categoryName: "Lanches; especiais",
        priceCents: 4_290,
        deliveryPriceCents: 0,
        costCents: 1_450,
        description: "Molho; tomate, especial",
        ncm: "2106.90.90",
        cfop: "5.102",
        available: true,
        estimatedPrepTimeMinutes: 20,
        tags: ["chef_special", "bestseller"],
        dailyStockLimit: 0,
      },
    ]);
  });

  it("aceita o formato legado por ponto-e-vírgula e valores decimais com vírgula", () => {
    const csv = [
      "Nome;Categoria;Preco_Salao;Preco_Delivery;Custo_CMV;Descricao;NCM;CFOP;Disponivel",
      '"Burger ""Supreme""";"Lanches; especiais";42,90;48,90;14,50;"Molho; tomate";2106.90.90;5.102;SIM',
    ].join("\r\n");

    expect(parseCatalogCsv(csv)[0]).toMatchObject({
      id: null,
      name: 'Burger "Supreme"',
      categoryName: "Lanches; especiais",
      priceCents: 4_290,
      deliveryPriceCents: 4_890,
      costCents: 1_450,
      description: "Molho; tomate",
      available: true,
    });
  });

  it("aceita o formato legado por vírgula e campos que contêm o separador", () => {
    const csv = [
      "ID,Nome,Categoria,Preco_Salao_Reais,Preco_Delivery_Reais,Custo_Reais,Disponivel,Preparo_Minutos,Destaques,Limite_Diario",
      '"product,2","Arroz, feijão",Pratos,19.90,,0.00,NAO,15,"chef_special;bestseller",0',
    ].join("\n");

    expect(parseCatalogCsv(csv)[0]).toMatchObject({
      id: "product,2",
      name: "Arroz, feijão",
      priceCents: 1_990,
      deliveryPriceCents: null,
      costCents: 0,
      available: false,
      estimatedPrepTimeMinutes: 15,
      tags: ["chef_special", "bestseller"],
      dailyStockLimit: 0,
    });
  });

  it("gera um modelo importável e rejeita CSV malformado", () => {
    expect(parseCatalogCsv(catalogCsvTemplate())).toHaveLength(1);
    expect(() => parseCatalogCsv('Nome,Categoria,Preco_Salao\n"Produto,Pratos,19.999')).toThrow(
      "aspas não fechadas",
    );
  });
});
