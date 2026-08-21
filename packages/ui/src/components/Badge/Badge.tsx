import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva("gm-badge", {
  variants: {
    tone: {
      neutral: "gm-badge--neutral",
      success: "gm-badge--success",
      warning: "gm-badge--warning",
      danger: "gm-badge--danger",
      info: "gm-badge--info",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <span className={cn(badgeVariants({ tone }))} data-slot="badge">
      {children}
    </span>
  );
}
