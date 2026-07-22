import type { StockDocument } from "@/features/inventory/domain/types";

export type ProductionOrderStatus = "OPEN" | "RECEIVED" | "CANCELLED";

export interface ProductionOrderLineInput {
  variantId: string;
  quantity: number;
}

export interface ProductionOrderInput {
  id?: string;
  orderDate: string;
  expectedDate: string;
  note: string;
  lines: ProductionOrderLineInput[];
}

export interface ProductionOrderLine extends ProductionOrderLineInput {
  id: string;
  lineNumber: number;
  modelName: string;
  colorName: string;
  size: number;
}

export interface ProductionOrder {
  id: string;
  number: string;
  orderDate: string;
  expectedDate: string;
  note: string;
  status: ProductionOrderStatus;
  receivedDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
  cancelledAt: string | null;
  lines: ProductionOrderLine[];
}

export interface ProductionOrderReceiptResult {
  order: ProductionOrder;
  document: StockDocument;
}

export interface ProductionOrderValidationError {
  path: string;
  code: "REQUIRED" | "INVALID_DATE_RANGE" | "INVALID_QUANTITY" | "DUPLICATE_VARIANT";
  message: string;
}
