import type { StockDocument } from "@/features/inventory/domain/types";

export type ProductionOrderStatus = "OPEN" | "RECEIVED" | "CANCELLED";

export interface ProductionOrderLineInput {
  variantId: string;
  quantity: number;
  unitPrice: number;
}

export interface ProductionOrderInput {
  id?: string;
  orderDate: string;
  expectedDate: string;
  note: string;
  discount: number;
  lines: ProductionOrderLineInput[];
}

export interface ProductionOrderLine {
  id: string;
  variantId: string;
  lineNumber: number;
  modelName: string;
  colorName: string;
  size: string;
  quantity: number;
  receivedQuantity: number;
  unitPrice: number | null;
}

export interface ProductionOrderReceiptLineInput {
  lineId: string;
  quantity: number;
}

export interface ProductionOrderReceiptInput {
  orderId: string;
  effectiveDate: string;
  lines?: ProductionOrderReceiptLineInput[];
}

export interface ProductionOrder {
  id: string;
  number: string;
  orderDate: string;
  expectedDate: string;
  note: string;
  discount: number;
  status: ProductionOrderStatus;
  receivedDocumentId: string | null;
  receiptDocumentIds: string[];
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
  code: "REQUIRED" | "INVALID_DATE_RANGE" | "INVALID_QUANTITY" | "INVALID_UNIT_PRICE" | "INVALID_DISCOUNT" | "DUPLICATE_VARIANT";
  message: string;
}
