import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      className={cn(
        "size-4 shrink-0 rounded border border-input bg-background accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      data-slot="checkbox"
      type="checkbox"
      {...props}
    />
  );
}
