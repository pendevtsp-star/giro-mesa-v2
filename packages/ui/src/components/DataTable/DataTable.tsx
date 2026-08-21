import type { ReactNode, TableHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function DataTable({
  caption,
  children,
  className = "",
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { caption: string; children: ReactNode }) {
  return (
    <div className="gm-data-table__scroll" data-slot="table-container">
      <table className={cn("gm-data-table", className)} data-slot="table" {...props}>
        <caption className="gm-sr-only" data-slot="table-caption">
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}
