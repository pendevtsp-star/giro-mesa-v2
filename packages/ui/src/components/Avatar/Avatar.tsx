import "./Avatar.css";

export function Avatar({
  initials,
  size = "md",
  src,
}: {
  initials: string;
  size?: "sm" | "md" | "lg";
  src?: string | null;
}) {
  return (
    <span className={`gm-avatar gm-avatar--${size}`}>
      {src ? <img alt="" src={src} /> : initials}
    </span>
  );
}
