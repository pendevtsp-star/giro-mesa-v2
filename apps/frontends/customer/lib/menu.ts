export type Modifier = { id: string; name: string; priceCents: number };
export type ModifierGroup = {
  id: string;
  name: string;
  required: boolean;
  maxSelections: number;
  options: Modifier[];
};
export type MenuItem = {
  id: string;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  deliveryPriceCents?: number;
  imageUrl?: string;
  visual: string;
  tags?: string[];
  available: boolean;
  modifierGroups?: ModifierGroup[];
};
export type CartItem = {
  lineId: string;
  item: MenuItem;
  quantity: number;
  modifiers: Modifier[];
  notes?: string;
};

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function itemPrice(item: MenuItem, fulfillment: "pickup" | "delivery" = "pickup"): number {
  return fulfillment === "delivery"
    ? (item.deliveryPriceCents ?? item.priceCents)
    : item.priceCents;
}

export function cartLineTotal(
  line: CartItem,
  fulfillment: "pickup" | "delivery" = "pickup",
): number {
  const modifierTotal = line.modifiers.reduce((total, modifier) => total + modifier.priceCents, 0);
  return (itemPrice(line.item, fulfillment) + modifierTotal) * line.quantity;
}

export function cartTotal(
  lines: CartItem[],
  fulfillment: "pickup" | "delivery" = "pickup",
): number {
  return lines.reduce((total, line) => total + cartLineTotal(line, fulfillment), 0);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

export function filterMenu(items: MenuItem[], category: string, query: string): MenuItem[] {
  const normalized = normalizeSearchText(query.trim());
  return items.filter((item) => {
    const inCategory = category === "Todos" || item.category === category;
    const searchable = normalizeSearchText(
      `${item.name} ${item.description} ${item.tags?.join(" ") ?? ""}`,
    );
    return inCategory && (!normalized || searchable.includes(normalized));
  });
}
