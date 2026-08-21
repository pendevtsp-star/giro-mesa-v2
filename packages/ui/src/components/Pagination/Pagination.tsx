import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Pagination({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      aria-label="Paginação"
      className={cn("mx-auto flex w-full justify-center", className)}
      data-slot="pagination"
      {...props}
    />
  );
}
export function PaginationContent({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex items-center gap-1", className)}
      data-slot="pagination-content"
      {...props}
    />
  );
}
export function PaginationItem(props: ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}
export function PaginationLink({
  className,
  "aria-current": current,
  ...props
}: ComponentProps<"a">) {
  return (
    <a
      aria-current={current}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md border border-transparent text-sm hover:bg-accent hover:text-accent-foreground",
        current && "border-border bg-background",
        className,
      )}
      data-slot="pagination-link"
      {...props}
    />
  );
}
