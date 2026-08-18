import "./Skeleton.css";

export function Skeleton({
  width,
  height = "1em",
  rounded = false,
}: {
  width?: string;
  height?: string;
  rounded?: boolean;
}) {
  return (
    <span
      className={`gm-skeleton ${rounded ? "gm-skeleton--rounded" : ""}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
