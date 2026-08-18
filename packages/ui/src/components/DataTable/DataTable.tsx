import type { ReactNode, TableHTMLAttributes } from "react";
import "./DataTable.css";

export function DataTable({
  caption,
  children,
  className = "",
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { caption: string; children: ReactNode }) {
  return (
    <div className="gm-data-table__scroll">
      <table className={`gm-data-table ${className}`} {...props}>
        <caption className="gm-sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
