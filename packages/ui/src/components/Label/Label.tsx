import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: association is supplied by each caller through htmlFor or nested control
    <label
      className={cn("flex items-center gap-2 text-sm font-medium leading-none", className)}
      data-slot="label"
      {...props}
    />
  );
}
