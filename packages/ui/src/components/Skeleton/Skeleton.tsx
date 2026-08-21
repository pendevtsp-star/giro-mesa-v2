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
      aria-hidden="true"
      className={`gm-skeleton ${rounded ? "gm-skeleton--rounded" : ""}`}
      data-slot="skeleton"
      style={{ width, height }}
    />
  );
}
