import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  const isChoice = type === "checkbox" || type === "radio";

  return (
    <input
      className={cn(
        "border-input bg-background text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50",
        isChoice
          ? "size-4 shrink-0 accent-primary"
          : "flex h-10 w-full min-w-0 rounded-md border px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground",
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}
