import { cn } from "../../lib/utils";

export function SegmentedTabs<T extends string>({
  items,
  active,
  onChange,
  label = "Filtrar visualização",
  className = "",
}: {
  items: { id: T; label: string; count?: number; tone?: string }[];
  active: T;
  onChange: (id: T) => void;
  label?: string;
  className?: string;
}) {
  return (
    <fieldset className={cn("gm-segmented-control", className)} data-slot="toggle-group">
      <legend className="gm-sr-only">{label}</legend>
      {items.map((item) => (
        <button
          aria-pressed={active === item.id}
          className={cn(
            "gm-segmented-control__item",
            active === item.id && "gm-segmented-control__item--active",
          )}
          data-slot="toggle-group-item"
          key={item.id}
          onClick={() => onChange(item.id)}
          type="button"
        >
          <span>{item.label}</span>
          {typeof item.count === "number" && (
            <span
              className={cn(
                "gm-segmented-control__badge",
                item.tone && `gm-segmented-control__badge--${item.tone}`,
              )}
              data-slot="badge"
            >
              {item.count}
            </span>
          )}
        </button>
      ))}
    </fieldset>
  );
}
