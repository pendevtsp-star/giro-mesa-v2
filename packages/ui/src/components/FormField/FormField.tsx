import type { ReactNode } from "react";

export function FormField({
  label,
  error,
  children,
  required,
  htmlFor,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
  htmlFor: string;
}) {
  return (
    <div className="gm-form-field" data-slot="form-item">
      <span className="gm-form-field__label" data-slot="form-label">
        <label htmlFor={htmlFor}>{label}</label>
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {children}
      {error && (
        <span className="gm-form-field__error" data-slot="form-message" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
