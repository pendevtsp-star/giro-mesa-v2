import { SERVICE_MODE_PRESENTATION, type ServiceMode } from "../../operations.shared";

const SERVICE_MODES: ServiceMode[] = ["full_service", "quick_service", "bar", "hybrid"];

export function ServiceModePicker({
  legend,
  name,
  onChange,
  value,
}: {
  legend: string;
  name: string;
  onChange: (mode: ServiceMode) => void;
  value: ServiceMode;
}) {
  return (
    <fieldset className="service-mode-picker">
      <legend>{legend}</legend>
      <div className="service-mode-picker__options">
        {SERVICE_MODES.map((mode) => {
          const presentation = SERVICE_MODE_PRESENTATION[mode];
          return (
            <label className="service-mode-option" data-selected={value === mode} key={mode}>
              <input
                checked={value === mode}
                name={name}
                onChange={() => onChange(mode)}
                type="radio"
                value={mode}
              />
              <span>
                <strong>{presentation.label}</strong>
                <small>{presentation.description}</small>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
