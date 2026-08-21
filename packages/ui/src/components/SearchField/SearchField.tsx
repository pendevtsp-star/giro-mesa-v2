import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { Icon } from "../Icon/Icon";

export function SearchField({
  className = "",
  placeholder,
  "aria-label": ariaLabel,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return (
    <div className={cn("gm-search-field", className)} data-slot="search-field">
      <Icon name="search" size={16} />
      <input
        aria-label={ariaLabel ?? placeholder ?? "Buscar"}
        data-slot="input"
        placeholder={placeholder}
        type="search"
        {...props}
      />
    </div>
  );
}
