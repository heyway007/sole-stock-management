import { describe, expect, it } from "vitest";
import {
  filterInventory,
  selectDashboardSummary,
  selectLowStock,
} from "@/features/inventory/domain/selectors";
import type { InventorySnapshot } from "@/features/inventory/domain/types";

function makeSnapshot(): InventorySnapshot {
  return {
    version: 1,
    models: [
      { id: "model-z", name: "Zeta", active: true },
      { id: "model-a", name: "Alpha", active: true },
    ],
    colors: [
      { id: "color-black", name: "Black", active: true },
      { id: "color-red", name: "Red", active: true },
    ],
    variants: [
      { id: "z-red-40", modelId: "model-z", colorId: "color-red", size: "40", lowStockThreshold: 3, active: true },
      { id: "a-black-38.5", modelId: "model-a", colorId: "color-black", size: "38.5", lowStockThreshold: 3, active: true },
      { id: "a-black-40", modelId: "model-a", colorId: "color-black", size: "40", lowStockThreshold: 3, active: true },
      { id: "inactive", modelId: "model-a", colorId: "color-red", size: "39", lowStockThreshold: 3, active: false },
    ],
    balances: { "z-red-40": 0, "a-black-38.5": 3, "a-black-40": 9, inactive: 1 },
    documents: [
      {
        id: "receipt", number: "STK-1", type: "RECEIPT", effectiveDate: "2026-07-01", reference: "", note: "", createdAt: "2026-07-01T00:00:00Z",
        lines: [{ id: "receipt-line", variantId: "a-black-40", delta: 4 }],
      },
      {
        id: "issue", number: "STK-2", type: "SALE", effectiveDate: "2026-07-02", reference: "", note: "", createdAt: "2026-07-02T00:00:00Z",
        lines: [{ id: "issue-line", variantId: "a-black-40", delta: -2 }],
      },
      {
        id: "exchange", number: "STK-3", type: "EXCHANGE", effectiveDate: "2026-07-03", reference: "", note: "", createdAt: "2026-07-03T00:00:00Z",
        lines: [
          { id: "exchange-return", variantId: "a-black-40", delta: 1, section: "RETURNED" },
          { id: "exchange-replacement", variantId: "z-red-40", delta: -1, section: "REPLACEMENT" },
        ],
      },
      {
        id: "previous", number: "STK-4", type: "RECEIPT", effectiveDate: "2026-06-30", reference: "", note: "", createdAt: "2026-06-30T00:00:00Z",
        lines: [{ id: "previous-line", variantId: "a-black-40", delta: 100 }],
      },
    ],
  };
}

describe("inventory selectors", () => {
  it("summarizes current-month receipts, issues, on-hand pairs, and low stock without counting exchanges", () => {
    expect(selectDashboardSummary(makeSnapshot(), new Date("2026-07-22T12:00:00Z"))).toEqual({
      totalOnHand: 13,
      receivedThisMonth: 4,
      issuedThisMonth: 2,
      lowStockCount: 2,
    });
  });

  it("returns active low-stock variants at or below their thresholds", () => {
    expect(selectLowStock(makeSnapshot()).map((row) => [row.variantId, row.status])).toEqual([
      ["a-black-38.5", "LOW"],
      ["z-red-40", "OUT"],
    ]);
  });

  it("searches model, color, and decimal size case-insensitively", () => {
    const snapshot = makeSnapshot();
    const filters = { modelId: null, colorId: null, status: "ALL" as const };

    expect(filterInventory(snapshot, { ...filters, query: "ALPHA" }).map((row) => row.variantId)).toEqual(["a-black-38.5", "a-black-40"]);
    expect(filterInventory(snapshot, { ...filters, query: "blAcK" }).map((row) => row.variantId)).toEqual(["a-black-38.5", "a-black-40"]);
    expect(filterInventory(snapshot, { ...filters, query: "38.5" }).map((row) => row.variantId)).toEqual(["a-black-38.5"]);
  });

  it("filters active rows by model, color, and stock status in stable catalog order", () => {
    const snapshot = makeSnapshot();
    const base = { query: "", modelId: null, colorId: null };

    expect(filterInventory(snapshot, { ...base, status: "ALL" }).map((row) => row.variantId)).toEqual([
      "a-black-38.5", "a-black-40", "z-red-40",
    ]);
    expect(filterInventory(snapshot, { ...base, modelId: "model-a", status: "ALL" }).map((row) => row.variantId)).toEqual(["a-black-38.5", "a-black-40"]);
    expect(filterInventory(snapshot, { ...base, colorId: "color-red", status: "ALL" }).map((row) => row.variantId)).toEqual(["z-red-40"]);
    expect(filterInventory(snapshot, { ...base, status: "LOW" }).map((row) => row.variantId)).toEqual(["a-black-38.5"]);
    expect(filterInventory(snapshot, { ...base, status: "OUT" }).map((row) => row.variantId)).toEqual(["z-red-40"]);
  });
});
