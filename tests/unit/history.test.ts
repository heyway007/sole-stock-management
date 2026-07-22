import { describe, expect, it } from "vitest";
import { selectHistory, type HistoryFilters } from "@/features/inventory/domain/history";
import type { InventorySnapshot } from "@/features/inventory/domain/types";

const snapshot: InventorySnapshot = {
  version: 1,
  models: [
    { id: "paris", name: "Paris", active: true },
    { id: "castor", name: "Castor", active: true },
  ],
  colors: [
    { id: "black", name: "Black", active: true },
    { id: "olive", name: "Olive", active: true },
  ],
  variants: [
    { id: "paris-black-38.5", modelId: "paris", colorId: "black", size: 38.5, lowStockThreshold: 3, active: true },
    { id: "castor-olive-42", modelId: "castor", colorId: "olive", size: 42, lowStockThreshold: 3, active: true },
  ],
  balances: { "paris-black-38.5": 8, "castor-olive-42": 2 },
  documents: [
    {
      id: "doc-old",
      number: "STK-20260701-0001",
      type: "RECEIPT",
      effectiveDate: "2026-07-01",
      reference: "PO-Paris",
      note: "",
      createdAt: "2026-07-01T09:00:00.000Z",
      lines: [
        { id: "line-1", variantId: "paris-black-38.5", delta: 10 },
        { id: "line-2", variantId: "castor-olive-42", delta: 4 },
      ],
    },
    {
      id: "doc-mid",
      number: "STK-20260715-0002",
      type: "SALE",
      effectiveDate: "2026-07-15",
      reference: "ORDER-77",
      note: "",
      createdAt: "2026-07-15T10:00:00.000Z",
      lines: [{ id: "line-3", variantId: "paris-black-38.5", delta: -2 }],
    },
    {
      id: "doc-new",
      number: "STK-20260715-0003",
      type: "EXCHANGE",
      effectiveDate: "2026-07-15",
      reference: "EX-88",
      note: "",
      createdAt: "2026-07-15T11:00:00.000Z",
      lines: [
        { id: "line-4", variantId: "paris-black-38.5", delta: 1, section: "RETURNED" },
        { id: "line-5", variantId: "castor-olive-42", delta: -2, section: "REPLACEMENT" },
      ],
    },
  ],
};

const allFilters: HistoryFilters = { query: "", type: "ALL", startDate: "", endDate: "" };

describe("selectHistory", () => {
  it("includes both date-range boundaries and filters by movement type", () => {
    expect(selectHistory(snapshot, { ...allFilters, startDate: "2026-07-01", endDate: "2026-07-15" })).toHaveLength(3);
    expect(selectHistory(snapshot, { ...allFilters, startDate: "2026-07-15", endDate: "2026-07-15", type: "SALE" }).map((row) => row.documentId)).toEqual(["doc-mid"]);
  });

  it.each(["stk-20260701", "po-paris", "PARIS", "black", "38.5", "castor", "OLIVE", "42"])(
    "searches document fields and joined catalog data using %s",
    (query) => {
      const rows = selectHistory(snapshot, { ...allFilters, query });
      expect(rows.map((row) => row.documentId)).toContain("doc-old");
    },
  );

  it("orders newest first and calculates each signed total without mutating documents", () => {
    const before = structuredClone(snapshot.documents);
    const rows = selectHistory(snapshot, allFilters);

    expect(rows.map((row) => row.documentId)).toEqual(["doc-new", "doc-mid", "doc-old"]);
    expect(rows.map((row) => row.pairMovement)).toEqual([-1, -2, 14]);
    expect(rows[0]).toEqual({
      documentId: "doc-new",
      number: "STK-20260715-0003",
      type: "EXCHANGE",
      effectiveDate: "2026-07-15",
      reference: "EX-88",
      lineCount: 2,
      pairMovement: -1,
    });
    expect(snapshot.documents).toEqual(before);
  });

  it("filters documents by a linked line variant", () => {
    const rows = selectHistory(snapshot, { ...allFilters, variantId: "castor-olive-42" });
    expect(rows.map((row) => row.documentId)).toEqual(["doc-new", "doc-old"]);
  });
});
