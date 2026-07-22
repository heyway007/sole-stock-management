import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
}

export function Button({ className = "", variant = "primary", type = "button", ...props }: ButtonProps) {
  return <button className={`button button--${variant} ${className}`.trim()} type={type} {...props} />;
}
