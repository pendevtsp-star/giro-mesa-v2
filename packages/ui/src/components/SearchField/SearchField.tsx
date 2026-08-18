import type { InputHTMLAttributes } from "react";
import { Icon } from "../Icon/Icon";
import "./SearchField.css";

export function SearchField({
  className = "",
  placeholder,
  "aria-label": ariaLabel,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return (
    <div className={`gm-search-field ${className}`}>
      <Icon name="search" size={16} />
      <input
        aria-label={ariaLabel ?? placeholder ?? "Buscar"}
        placeholder={placeholder}
        type="search"
        {...props}
      />
    </div>
  );
}
