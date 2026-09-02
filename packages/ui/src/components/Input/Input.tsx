import type { ChangeEvent, ComponentProps } from "react";
import { cn } from "../../lib/utils";

type InputProps = ComponentProps<"input"> & { "data-currency"?: "brl" };

function formatBrazilianCurrencyInput(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(digits) / 100);
}

export function Input({ className, type, onChange, ...props }: InputProps) {
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
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        if (props["data-currency"] === "brl")
          event.currentTarget.value = formatBrazilianCurrencyInput(event.currentTarget.value);
        onChange?.(event);
      }}
    />
  );
}
