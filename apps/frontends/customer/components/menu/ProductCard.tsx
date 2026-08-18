import { formatMoney, type MenuItem } from "../../lib/menu";

export function ProductCard({ item, onOpen }: { item: MenuItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="menu-card"
      onClick={onOpen}
      aria-label={`${item.name}, ${formatMoney(item.priceCents)}${item.available ? "" : ", indisponível"}`}
    >
      <span className={`food-visual food-${item.id}`} aria-hidden="true">
        {item.imageUrl ? (
          // biome-ignore lint/performance/noImgElement: the API media host is configured at runtime.
          <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          item.visual
        )}
      </span>
      <span className="menu-card-copy">
        <span className="item-name">{item.name}</span>
        <span className="item-description">{item.description}</span>
        <span className="item-meta">
          <b>{formatMoney(item.priceCents)}</b>
          {item.tags?.map((tag) => (
            <small key={tag}>{tag}</small>
          ))}
        </span>
        {!item.available && <span className="sold-out">Indisponível agora</span>}
      </span>
    </button>
  );
}
