import type { ReactNode } from "react";
import "./FormField.css";

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
    <div className="gm-form-field">
      <span className="gm-form-field__label">
        <label htmlFor={htmlFor}>{label}</label>
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {children}
      {error && (
        <span className="gm-form-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
