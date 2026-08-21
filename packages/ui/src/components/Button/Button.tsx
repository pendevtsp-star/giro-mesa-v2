import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({
  className = "",
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn("gm-button", `gm-button--${variant}`, `gm-button--${size}`, className)}
      data-slot="button"
      type={type}
      {...props}
    />
  );
}
