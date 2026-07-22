import { describe, expect, it } from "vitest";
import { filterProductionOrders, summarizeProductionOrder } from "@/features/production-orders/domain/selectors";
import type { ProductionOrder, ProductionOrderInput } from "@/features/production-orders/domain/types";
import { validateProductionOrder } from "@/features/production-orders/domain/validation";

const validInput: ProductionOrderInput = {
  orderDate: "2026-07-22",
  expectedDate: "2026-08-05",
  note: "รอบต้นเดือน",
  lines: [
    { variantId: "variant-1", quantity: 4 },
    { variantId: "variant-2", quantity: 6 },
  ],
};

const order: ProductionOrder = {
  id: "order-1",
  number: "PO-20260722-000001",
  orderDate: "2026-07-22",
  expectedDate: "2026-08-05",
  note: "รอบต้นเดือน",
  status: "OPEN",
  receivedDocumentId: null,
  createdAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
  receivedAt: null,
  cancelledAt: null,
  lines: [
    {
      id: "line-1",
      variantId: "variant-1",
      lineNumber: 1,
      modelName: "Paris",
      colorName: "Black",
      size: 38,
      quantity: 4,
    },
    {
      id: "line-2",
      variantId: "variant-2",
      lineNumber: 2,
      modelName: "Paris",
      colorName: "Black",
      size: 38.5,
      quantity: 6,
    },
  ],
};

describe("production-order domain", () => {
  it("accepts a complete order and normalizes its note", () => {
    expect(validateProductionOrder({ ...validInput, note: "  รอบต้นเดือน  " })).toEqual({
      success: true,
      data: validInput,
    });
  });

  it.each([
    ["expected date", { ...validInput, expectedDate: "2026-07-21" }, "expectedDate"],
    ["empty lines", { ...validInput, lines: [] }, "lines"],
    ["quantity", { ...validInput, lines: [{ variantId: "variant-1", quantity: 1.5 }] }, "lines.0.quantity"],
    [
      "duplicate variant",
      { ...validInput, lines: [...validInput.lines, { variantId: "variant-1", quantity: 2 }] },
      "lines.2.variantId",
    ],
  ])("rejects invalid %s", (_label, input, path) => {
    const result = validateProductionOrder(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
    }
  });

  it("summarizes and searches snapshotted order lines", () => {
    expect(summarizeProductionOrder(order)).toEqual({ lineCount: 2, totalPairs: 10 });
    expect(filterProductionOrders([order], { query: "paris black", status: "ALL" })).toEqual([order]);
    expect(filterProductionOrders([order], { query: "", status: "RECEIVED" })).toEqual([]);
  });
});
