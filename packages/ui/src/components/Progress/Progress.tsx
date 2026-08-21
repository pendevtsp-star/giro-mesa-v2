export function Progress({ value, label }: { value: number; label: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="gm-progress" data-slot="progress-root">
      <div className="gm-progress__meta" data-slot="progress-label">
        <span>{label}</span>
        <span>{bounded}%</span>
      </div>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={bounded}
        className="gm-progress__track"
        data-slot="progress"
        role="progressbar"
      >
        <span data-slot="progress-indicator" style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}
