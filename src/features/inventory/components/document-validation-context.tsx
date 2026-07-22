"use client";

import { createContext, useContext } from "react";
import type { ValidationError } from "@/features/inventory/domain/types";

export interface DocumentValidationContextValue {
  errors: ValidationError[];
  errorFor(path: string): string | null;
  clearErrors(paths: string[]): void;
  clearAllErrors(): void;
}

const emptyContext: DocumentValidationContextValue = {
  errors: [],
  errorFor: () => null,
  clearErrors: () => undefined,
  clearAllErrors: () => undefined,
};

export const DocumentValidationContext = createContext<DocumentValidationContextValue>(emptyContext);

export function useDocumentValidation() {
  return useContext(DocumentValidationContext);
}
