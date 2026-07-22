import type { InputHTMLAttributes, ReactNode } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  announceError?: boolean;
  leadingIcon?: ReactNode;
}

export function Field({ label, error, announceError = true, leadingIcon, id, className = "", ...props }: FieldProps) {
  const inputId = id ?? props.name;
  const labelId = inputId ? `${inputId}-label` : undefined;
  const errorId = error && inputId ? `${inputId}-error` : undefined;
  return (
    <label className="form-field" htmlFor={inputId}>
      <span className="form-field__label" id={labelId}>{label}</span>
      <span className={`form-field__control${error ? " has-error" : ""}`}>
        {leadingIcon && <span className="form-field__prefix" aria-hidden>{leadingIcon}</span>}
        <input id={inputId} className={className} aria-labelledby={labelId} aria-invalid={error ? true : undefined} aria-describedby={errorId} {...props} />
      </span>
      {error && <span className="form-field__error" id={errorId} role={announceError ? "alert" : undefined}>{error}</span>}
    </label>
  );
}
