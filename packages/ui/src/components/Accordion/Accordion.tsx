import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Accordion({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("w-full", className)} data-slot="accordion" {...props} />;
}
export function AccordionItem({ className, ...props }: ComponentProps<"details">) {
  return (
    <details
      className={cn("group border-b border-border", className)}
      data-slot="accordion-item"
      {...props}
    />
  );
}
export function AccordionTrigger({ className, ...props }: ComponentProps<"summary">) {
  return (
    <summary
      className={cn(
        "flex cursor-pointer list-none items-center justify-between py-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      data-slot="accordion-trigger"
      {...props}
    />
  );
}
export function AccordionContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("pb-4 text-sm text-muted-foreground", className)}
      data-slot="accordion-content"
      {...props}
    />
  );
}
