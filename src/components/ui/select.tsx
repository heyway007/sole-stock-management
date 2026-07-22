import type { PropsWithChildren, SelectHTMLAttributes } from "react";

interface SelectProps extends PropsWithChildren<SelectHTMLAttributes<HTMLSelectElement>> {
  label: string;
  error?: string | null;
  announceError?: boolean;
}

export function Select({ label, error, announceError = true, id, children, ...props }: SelectProps) {
  const selectId = id ?? props.name;
  const labelId = selectId ? `${selectId}-label` : undefined;
  const errorId = error && selectId ? `${selectId}-error` : undefined;
  return (
    <label className="form-field" htmlFor={selectId}>
      <span className="form-field__label" id={labelId}>{label}</span>
      <span className={`select-control${error ? " has-error" : ""}`}>
        <select id={selectId} aria-labelledby={labelId} aria-invalid={error ? true : undefined} aria-describedby={errorId} {...props}>{children}</select>
      </span>
      {error && <span className="form-field__error" id={errorId} role={announceError ? "alert" : undefined}>{error}</span>}
    </label>
  );
}
