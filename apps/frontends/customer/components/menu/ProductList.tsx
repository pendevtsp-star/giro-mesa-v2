import type { MenuItem } from "../../lib/menu";
import { ProductCard } from "./ProductCard";

export function ProductList({
  category,
  items,
  onOpen,
}: {
  category: string;
  items: MenuItem[];
  onOpen: (item: MenuItem) => void;
}) {
  return (
    <section id="cardapio" className="menu-content" tabIndex={-1}>
      <div className="section-title">
        <div>
          <h2>{category === "Todos" ? "Nosso cardápio" : category}</h2>
        </div>
        <span>
          {items.length} {items.length === 1 ? "item" : "itens"}
        </span>
      </div>
      {items.length ? (
        <div className="menu-grid">
          {items.map((item) => (
            <ProductCard key={item.id} item={item} onOpen={() => onOpen(item)} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span>⌕</span>
          <h3>Nenhum item encontrado</h3>
          <p>Tente outro termo ou categoria.</p>
        </div>
      )}
    </section>
  );
}
