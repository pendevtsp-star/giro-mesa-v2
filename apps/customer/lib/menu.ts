export type Modifier = { id: string; name: string; priceCents: number };
export type ModifierGroup = {
  id: string;
  name: string;
  required: boolean;
  maxSelections: number;
  options: Modifier[];
};
export const MENU_ICON_NAMES = [
  "burger",
  "dessert",
  "dish",
  "droplet",
  "fish",
  "glass",
  "leaf",
  "sparkles",
  "steak",
] as const;
export type MenuIconName = (typeof MENU_ICON_NAMES)[number];
export type MenuItem = {
  id: string;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  visual?: "plate" | "drink" | "dessert";
  icon?: MenuIconName;
  imageUrl?: string | null;
  tags?: string[];
  available: boolean;
  modifierGroups?: ModifierGroup[];
};
export type MenuBranding = {
  name: string;
  description: string;
  primaryColor: string;
  surfaceColor: string;
  textColor: string;
  logoUrl: string | null;
  coverUrl: string | null;
};
export type CartItem = {
  lineId: string;
  item: MenuItem;
  quantity: number;
  modifiers: Modifier[];
  notes?: string;
};

export const demoMenu: MenuItem[] = [
  {
    id: "bruschetta",
    category: "Entradas",
    name: "Bruschetta da casa",
    description: "Pão artesanal, tomates assados, manjericão e azeite.",
    priceCents: 2790,
    icon: "leaf",
    visual: "plate",
    tags: ["vegetariano"],
    available: true,
  },
  {
    id: "croquete",
    category: "Entradas",
    name: "Croquete de costela",
    description: "Quatro unidades, aioli defumado e picles da casa.",
    priceCents: 3490,
    icon: "dish",
    visual: "plate",
    available: true,
  },
  {
    id: "burger",
    category: "Principais",
    name: "Burger Giro",
    description: "Blend 180g, queijo, cebola tostada e molho da casa.",
    priceCents: 4890,
    icon: "burger",
    visual: "plate",
    available: true,
    modifierGroups: [
      {
        id: "ponto",
        name: "Ponto da carne",
        required: true,
        maxSelections: 1,
        options: [
          { id: "mal", name: "Malpassado", priceCents: 0 },
          { id: "ponto", name: "Ao ponto", priceCents: 0 },
          { id: "bem", name: "Bem-passado", priceCents: 0 },
        ],
      },
      {
        id: "extras",
        name: "Adicionais",
        required: false,
        maxSelections: 2,
        options: [
          { id: "bacon", name: "Bacon crocante", priceCents: 690 },
          { id: "queijo", name: "Queijo extra", priceCents: 590 },
        ],
      },
    ],
  },
  {
    id: "ravioli",
    category: "Principais",
    name: "Ravioli de abóbora",
    description: "Manteiga de sálvia, castanhas e parmesão curado.",
    priceCents: 5590,
    icon: "dish",
    visual: "plate",
    tags: ["vegetariano"],
    available: true,
  },
  {
    id: "peixe",
    category: "Principais",
    name: "Peixe do dia",
    description: "Purê de raízes, legumes grelhados e molho cítrico.",
    priceCents: 6890,
    icon: "fish",
    visual: "plate",
    tags: ["sem glúten"],
    available: true,
  },
  {
    id: "steak",
    category: "Principais",
    name: "Steak com fritas",
    description: "Corte alto, batatas rústicas e manteiga de ervas.",
    priceCents: 7990,
    icon: "steak",
    visual: "plate",
    available: false,
  },
  {
    id: "pudim",
    category: "Sobremesas",
    name: "Pudim de leite",
    description: "Fatia cremosa com caramelo e flor de sal.",
    priceCents: 2190,
    icon: "dessert",
    visual: "dessert",
    available: true,
  },
  {
    id: "chocolate",
    category: "Sobremesas",
    name: "Chocolate & café",
    description: "Texturas de chocolate, café e creme fresco.",
    priceCents: 2990,
    icon: "sparkles",
    visual: "dessert",
    available: true,
  },
  {
    id: "agua",
    category: "Bebidas",
    name: "Água mineral",
    description: "Com ou sem gás, 350 ml.",
    priceCents: 690,
    icon: "droplet",
    visual: "drink",
    available: true,
    modifierGroups: [
      {
        id: "tipo",
        name: "Escolha",
        required: true,
        maxSelections: 1,
        options: [
          { id: "sem-gas", name: "Sem gás", priceCents: 0 },
          { id: "com-gas", name: "Com gás", priceCents: 100 },
        ],
      },
    ],
  },
  {
    id: "soda",
    category: "Bebidas",
    name: "Soda artesanal",
    description: "Limão siciliano, frutas vermelhas ou gengibre.",
    priceCents: 1690,
    icon: "glass",
    visual: "drink",
    available: true,
  },
];

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function cartLineTotal(line: CartItem): number {
  const modifierTotal = line.modifiers.reduce((total, modifier) => total + modifier.priceCents, 0);
  return (line.item.priceCents + modifierTotal) * line.quantity;
}

export function cartTotal(lines: CartItem[]): number {
  return lines.reduce((total, line) => total + cartLineTotal(line), 0);
}

export function filterMenu(items: MenuItem[], category: string, query: string): MenuItem[] {
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  return items.filter((item) => {
    const inCategory = category === "Todos" || item.category === category;
    const searchable =
      `${item.name} ${item.description} ${item.tags?.join(" ") ?? ""}`.toLocaleLowerCase("pt-BR");
    return inCategory && (!normalized || searchable.includes(normalized));
  });
}
