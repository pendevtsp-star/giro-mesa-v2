import "./StatusDot.css";

export function StatusDot({
  tone = "success",
  pulse = false,
}: {
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
  pulse?: boolean;
}) {
  const colorMap = {
    success: "var(--gm-success)",
    warning: "var(--gm-warning)",
    danger: "var(--gm-danger)",
    info: "var(--gm-info)",
    neutral: "var(--gm-muted)",
  };
  return (
    <span
      className={`gm-status-dot ${pulse ? "gm-status-dot--pulse" : ""}`}
      style={{ backgroundColor: colorMap[tone] }}
    />
  );
}
