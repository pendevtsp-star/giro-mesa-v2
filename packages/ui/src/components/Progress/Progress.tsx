import "./Progress.css";

export function Progress({ value, label }: { value: number; label: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="gm-progress">
      <div className="gm-progress__meta">
        <span>{label}</span>
        <span>{bounded}%</span>
      </div>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={bounded}
        className="gm-progress__track"
        role="progressbar"
      >
        <span style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}
