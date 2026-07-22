import type { InventorySnapshot, MovementType } from "@/features/inventory/domain/types";

export interface HistoryFilters {
  query: string;
  type: MovementType | "ALL";
  startDate: string;
  endDate: string;
  variantId?: string;
}

export interface HistoryRow {
  documentId: string;
  number: string;
  type: MovementType;
  effectiveDate: string;
  reference: string;
  lineCount: number;
  pairMovement: number;
}

export function selectHistory(snapshot: InventorySnapshot, filters: HistoryFilters): HistoryRow[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("en-US");
  const variants = new Map(snapshot.variants.map((variant) => [variant.id, variant]));
  const models = new Map(snapshot.models.map((model) => [model.id, model]));
  const colors = new Map(snapshot.colors.map((color) => [color.id, color]));

  return snapshot.documents
    .filter((document) => !filters.variantId || document.lines.some((line) => line.variantId === filters.variantId))
    .filter((document) => filters.type === "ALL" || document.type === filters.type)
    .filter((document) => !filters.startDate || document.effectiveDate >= filters.startDate)
    .filter((document) => !filters.endDate || document.effectiveDate <= filters.endDate)
    .filter((document) => {
      if (!normalizedQuery) return true;
      const joinedLineText = document.lines.map((line) => {
        const variant = variants.get(line.variantId);
        if (!variant) return "";
        return `${models.get(variant.modelId)?.name ?? ""} ${colors.get(variant.colorId)?.name ?? ""} ${variant.size}`;
      }).join(" ");
      return `${document.number} ${document.reference} ${joinedLineText}`
        .toLocaleLowerCase("en-US")
        .includes(normalizedQuery);
    })
    .toSorted((left, right) =>
      right.effectiveDate.localeCompare(left.effectiveDate)
      || right.createdAt.localeCompare(left.createdAt)
      || right.number.localeCompare(left.number),
    )
    .map((document) => ({
      documentId: document.id,
      number: document.number,
      type: document.type,
      effectiveDate: document.effectiveDate,
      reference: document.reference,
      lineCount: document.lines.length,
      pairMovement: document.lines.reduce((total, line) => total + line.delta, 0),
    }));
}
