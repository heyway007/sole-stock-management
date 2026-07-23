import type { ProductionOrder, ProductionOrderStatus } from "./types";
import { lineTotalMinor } from "./money";

export interface ProductionOrderFilters {
  query: string;
  status: ProductionOrderStatus | "ALL";
}

export function summarizeProductionOrder(order: ProductionOrder) {
  const lineTotals = order.lines.map((line) =>
    lineTotalMinor(line.quantity, line.unitPrice));
  const hasCompletePricing = lineTotals.every((value) => value !== null);
  return {
    lineCount: order.lines.length,
    totalPairs: order.lines.reduce((total, line) => total + line.quantity, 0),
    hasCompletePricing,
    totalAmountMinor: hasCompletePricing
      ? lineTotals.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null,
  };
}

export function filterProductionOrders(
  orders: ProductionOrder[],
  filters: ProductionOrderFilters,
): ProductionOrder[] {
  const query = filters.query.trim().toLocaleLowerCase("th-TH");
  return orders.filter((order) => {
    if (filters.status !== "ALL" && order.status !== filters.status) return false;
    if (!query) return true;
    const searchable = [
      order.number,
      order.note,
      ...order.lines.flatMap((line) => [line.modelName, line.colorName, String(line.size)]),
    ].join(" ").toLocaleLowerCase("th-TH");
    return query.split(/\s+/).every((term) => searchable.includes(term));
  });
}
