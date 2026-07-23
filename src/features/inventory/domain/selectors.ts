import type { InventorySnapshot } from "./types";
import { compareSizeLabels } from "./size-label";

export interface InventoryFilters {
  query: string;
  modelId: string | null;
  colorId: string | null;
  status: "ALL" | "LOW" | "OUT";
}

export interface InventoryRow {
  variantId: string;
  modelName: string;
  colorName: string;
  size: string;
  quantity: number;
  lowStockThreshold: number;
  status: "NORMAL" | "LOW" | "OUT";
}

export interface DashboardSummary {
  totalOnHand: number;
  receivedThisMonth: number;
  issuedThisMonth: number;
  lowStockCount: number;
}

export function inventoryRows(snapshot: InventorySnapshot): InventoryRow[] {
  const models = new Map(snapshot.models.map((model) => [model.id, model]));
  const colors = new Map(snapshot.colors.map((color) => [color.id, color]));

  return snapshot.variants
    .filter((variant) => variant.active)
    .flatMap((variant) => {
      const model = models.get(variant.modelId);
      const color = colors.get(variant.colorId);
      if (!model || !color) return [];

      const quantity = snapshot.balances[variant.id] ?? 0;
      const status = quantity === 0
        ? "OUT"
        : quantity <= variant.lowStockThreshold
          ? "LOW"
          : "NORMAL";
      return [{
        variantId: variant.id,
        modelName: model.name,
        colorName: color.name,
        size: variant.size,
        quantity,
        lowStockThreshold: variant.lowStockThreshold,
        status,
      } satisfies InventoryRow];
    })
    .sort((left, right) =>
      left.modelName.localeCompare(right.modelName, "en", { sensitivity: "base" })
      || left.colorName.localeCompare(right.colorName, "en", { sensitivity: "base" })
      || compareSizeLabels(left.modelName, left.size, right.size)
      || left.variantId.localeCompare(right.variantId),
    );
}

export function selectLowStock(snapshot: InventorySnapshot): InventoryRow[] {
  return inventoryRows(snapshot).filter((row) => row.status !== "NORMAL");
}

export function filterInventory(snapshot: InventorySnapshot, filters: InventoryFilters): InventoryRow[] {
  const query = filters.query.trim().toLocaleLowerCase("en-US");
  return inventoryRows(snapshot).filter((row) => {
    if (filters.modelId && snapshot.variants.find((variant) => variant.id === row.variantId)?.modelId !== filters.modelId) return false;
    if (filters.colorId && snapshot.variants.find((variant) => variant.id === row.variantId)?.colorId !== filters.colorId) return false;
    if (filters.status !== "ALL" && row.status !== filters.status) return false;
    if (!query) return true;
    return row.modelName.toLocaleLowerCase("en-US").includes(query)
      || row.colorName.toLocaleLowerCase("en-US").includes(query)
      || row.size.toLocaleLowerCase().includes(query);
  });
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function selectDashboardSummary(snapshot: InventorySnapshot, currentDate = new Date()): DashboardSummary {
  const currentMonth = monthKey(currentDate);
  const monthlyDocuments = snapshot.documents.filter((document) =>
    document.effectiveDate.slice(0, 7) === currentMonth && document.type !== "EXCHANGE",
  );

  return {
    totalOnHand: Object.values(snapshot.balances).reduce((total, quantity) => total + quantity, 0),
    receivedThisMonth: monthlyDocuments
      .filter((document) => document.type === "RECEIPT")
      .flatMap((document) => document.lines)
      .filter((line) => line.delta > 0)
      .reduce((total, line) => total + line.delta, 0),
    issuedThisMonth: monthlyDocuments
      .flatMap((document) => document.lines)
      .filter((line) => line.delta < 0)
      .reduce((total, line) => total + Math.abs(line.delta), 0),
    lowStockCount: selectLowStock(snapshot).length,
  };
}
