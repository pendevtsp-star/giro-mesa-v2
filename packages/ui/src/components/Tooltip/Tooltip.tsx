import { cloneElement, type ReactElement, useId } from "react";
import "./Tooltip.css";

export function Tooltip({
  children,
  content,
}: {
  children: ReactElement<{ "aria-describedby"?: string; className?: string }>;
  content: string;
}) {
  const id = useId();
  return (
    <span className="gm-tooltip">
      {cloneElement(children, {
        "aria-describedby": id,
        className: `gm-tooltip__trigger ${children.props.className ?? ""}`,
      })}
      <span className="gm-tooltip__content" id={id} role="tooltip">
        {content}
      </span>
    </span>
  );
}
