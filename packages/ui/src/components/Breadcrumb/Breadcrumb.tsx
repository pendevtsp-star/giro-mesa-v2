import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Breadcrumb(props: ComponentProps<"nav">) {
  return <nav aria-label="Breadcrumb" data-slot="breadcrumb" {...props} />;
}
export function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      className={cn("flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground", className)}
      data-slot="breadcrumb-list"
      {...props}
    />
  );
}
export function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      className={cn("inline-flex items-center gap-1.5", className)}
      data-slot="breadcrumb-item"
      {...props}
    />
  );
}
export function BreadcrumbLink({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      className={cn("transition-colors hover:text-foreground", className)}
      data-slot="breadcrumb-link"
      {...props}
    />
  );
}
export function BreadcrumbPage({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-current="page"
      className={cn("font-normal text-foreground", className)}
      data-slot="breadcrumb-page"
      {...props}
    />
  );
}
export function BreadcrumbSeparator({ children = "/", className, ...props }: ComponentProps<"li">) {
  return (
    <li
      aria-hidden="true"
      className={cn("text-muted-foreground", className)}
      data-slot="breadcrumb-separator"
      {...props}
    >
      {children}
    </li>
  );
}
