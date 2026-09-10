import { Button } from "@giromesa/ui";
import { formatMoney, type MenuItem } from "../../lib/menu";

export function ProductCard({ item, onOpen }: { item: MenuItem; onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={`menu-card${item.imageUrl ? "" : " menu-card--text-only"}`}
      onClick={onOpen}
      aria-label={`${item.name}, ${formatMoney(item.priceCents)}${item.available ? "" : ", indisponível"}`}
    >
      {item.imageUrl && (
        <span className={`food-visual food-${item.id}`} aria-hidden="true">
          {/* biome-ignore lint/performance/noImgElement: the API media host is configured at runtime. */}
          <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
        </span>
      )}
      <span className="menu-card-copy">
        {!item.available && <span className="sold-out">Indisponível agora</span>}
        <span className="item-name">{item.name}</span>
        <span className="item-description">{item.description}</span>
        <span className="item-meta">
          <b>{formatMoney(item.priceCents)}</b>
          {item.tags?.map((tag) => (
            <small key={tag}>{tag}</small>
          ))}
        </span>
      </span>
    </Button>
  );
}
