import type { ReactNode } from "react";

export function SplitLayout({
  main,
  aside,
  reverse = false,
}: {
  main: ReactNode;
  aside: ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className={`gm-split-layout ${reverse ? "gm-split-layout--reverse" : ""}`}
      data-slot="split-layout"
    >
      <div className="gm-split-layout__main" data-slot="split-layout-main">
        {main}
      </div>
      <div className="gm-split-layout__aside" data-slot="split-layout-aside">
        {aside}
      </div>
    </div>
  );
}
