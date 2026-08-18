import type { ReactNode } from "react";
import "./SplitLayout.css";

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
    <div className={`gm-split-layout ${reverse ? "gm-split-layout--reverse" : ""}`}>
      <div className="gm-split-layout__main">{main}</div>
      <div className="gm-split-layout__aside">{aside}</div>
    </div>
  );
}
