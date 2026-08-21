import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

type SeparatorProps = ComponentProps<"hr"> & { orientation?: "horizontal" | "vertical" };

export function Separator({ className, orientation = "horizontal", ...props }: SeparatorProps) {
  return (
    <hr
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      data-slot="separator"
      {...props}
    />
  );
}
