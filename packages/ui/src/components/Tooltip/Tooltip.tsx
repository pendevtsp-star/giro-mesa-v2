"use client";

import { cloneElement, type ReactElement, useId } from "react";
import { cn } from "../../lib/utils";

export function Tooltip({
  children,
  content,
}: {
  children: ReactElement<{
    "aria-describedby"?: string;
    "data-slot"?: string;
    className?: string;
  }>;
  content: string;
}) {
  const id = useId();
  return (
    <span className="gm-tooltip" data-slot="tooltip">
      {cloneElement(children, {
        "aria-describedby": id,
        className: cn("gm-tooltip__trigger", children.props.className),
        "data-slot": "tooltip-trigger",
      })}
      <span className="gm-tooltip__content" data-slot="tooltip-content" id={id} role="tooltip">
        {content}
      </span>
    </span>
  );
}
