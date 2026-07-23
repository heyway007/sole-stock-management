export type MovementType =
  | "RECEIPT"
  | "SALE"
  | "DAMAGE"
  | "ADJUSTMENT"
  | "EXCHANGE";

export interface ShoeModel {
  id: string;
  name: string;
  active: boolean;
}

export interface Color {
  id: string;
  name: string;
  active: boolean;
}

export interface ProductVariant {
  id: string;
  modelId: string;
  colorId: string;
  size: string;
  lowStockThreshold: number;
  active: boolean;
}

export interface StockDocumentLineInput {
  variantId: string;
  size: string;
  quantity: number;
  direction?: "IN" | "OUT";
  section?: "RETURNED" | "REPLACEMENT";
  note?: string;
}

export interface StockDocumentInput {
  type: MovementType;
  effectiveDate: string;
  reference?: string;
  note?: string;
  lines: StockDocumentLineInput[];
}

export interface StockDocumentLine {
  id: string;
  variantId: string;
  delta: number;
  section?: "RETURNED" | "REPLACEMENT";
  note?: string;
}

export interface StockDocument {
  id: string;
  number: string;
  type: MovementType;
  effectiveDate: string;
  reference: string;
  note: string;
  createdAt: string;
  lines: StockDocumentLine[];
}

export interface InventorySnapshot {
  version: 1;
  revision?: number;
  models: ShoeModel[];
  colors: Color[];
  variants: ProductVariant[];
  balances: Record<string, number>;
  documents: StockDocument[];
}

export interface ValidationError {
  path: string;
  code: "REQUIRED" | "INVALID_SIZE" | "INVALID_QUANTITY" | "DUPLICATE_VARIANT" | "INVALID_EXCHANGE";
  message: string;
}
