import type { InputHTMLAttributes, ReactNode } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  leadingIcon?: ReactNode;
}

export function Field({ label, error, leadingIcon, id, className = "", ...props }: FieldProps) {
  const inputId = id ?? props.name;
  const errorId = error && inputId ? `${inputId}-error` : undefined;
  return (
    <label className="form-field" htmlFor={inputId}>
      <span className="form-field__label">{label}</span>
      <span className={`form-field__control${error ? " has-error" : ""}`}>
        {leadingIcon && <span className="form-field__prefix" aria-hidden>{leadingIcon}</span>}
        <input id={inputId} className={className} aria-invalid={error ? true : undefined} aria-describedby={errorId} {...props} />
      </span>
      {error && <span className="form-field__error" id={errorId} role="alert">{error}</span>}
    </label>
  );
}
