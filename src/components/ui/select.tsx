import type { PropsWithChildren, SelectHTMLAttributes } from "react";

interface SelectProps extends PropsWithChildren<SelectHTMLAttributes<HTMLSelectElement>> {
  label: string;
}

export function Select({ label, id, children, ...props }: SelectProps) {
  const selectId = id ?? props.name;
  return (
    <label className="form-field" htmlFor={selectId}>
      <span className="form-field__label">{label}</span>
      <span className="select-control">
        <select id={selectId} {...props}>{children}</select>
      </span>
    </label>
  );
}
