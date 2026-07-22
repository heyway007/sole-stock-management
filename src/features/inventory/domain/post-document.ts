import { validateDocument } from "./validation";
import type { InventorySnapshot, StockDocument, StockDocumentInput, StockDocumentLine, StockDocumentLineInput } from "./types";

export interface DocumentIdFactory {
  documentId(): string;
  lineId(index: number): string;
  documentNumber(): string;
  now(): string;
}

function deltaFor(type: StockDocumentInput["type"], line: StockDocumentLineInput): number {
  if (type === "RECEIPT") return line.quantity;
  if (type === "SALE" || type === "DAMAGE") return -line.quantity;
  if (type === "ADJUSTMENT") return line.direction === "IN" ? line.quantity : -line.quantity;
  return line.section === "RETURNED" ? line.quantity : -line.quantity;
}

export function postDocument(
  snapshot: InventorySnapshot,
  input: StockDocumentInput,
  ids: DocumentIdFactory,
): InventorySnapshot {
  const validated = validateDocument(input);
  if (!validated.success) {
    throw new Error(`VALIDATION_FAILED: ${validated.errors.map((error) => error.code).join(",")}`);
  }
  if (validated.data.type === "ADJUSTMENT" && validated.data.lines.some((line) => !line.direction)) {
    throw new Error("VALIDATION_FAILED: ADJUSTMENT_DIRECTION_REQUIRED");
  }

  const balances = { ...snapshot.balances };
  const deltasByVariant = new Map<string, number>();
  const lines: StockDocumentLine[] = validated.data.lines.map((line, index) => {
    const variant = snapshot.variants.find((candidate) => candidate.id === line.variantId);
    if (!variant || variant.size !== line.size) throw new Error("VARIANT_NOT_FOUND");

    const delta = deltaFor(validated.data.type, line);
    deltasByVariant.set(line.variantId, (deltasByVariant.get(line.variantId) ?? 0) + delta);

    return Object.freeze({
      id: ids.lineId(index),
      variantId: line.variantId,
      delta,
      ...(line.section ? { section: line.section } : {}),
      ...(line.note ? { note: line.note } : {}),
    });
  });
  for (const [variantId, delta] of deltasByVariant) {
    const projectedBalance = (balances[variantId] ?? 0) + delta;
    if (projectedBalance < 0) throw new Error("INSUFFICIENT_STOCK");
    balances[variantId] = projectedBalance;
  }
  const document: StockDocument = {
    id: ids.documentId(),
    number: ids.documentNumber(),
    type: validated.data.type,
    effectiveDate: validated.data.effectiveDate,
    reference: validated.data.reference ?? "",
    note: validated.data.note ?? "",
    createdAt: ids.now(),
    lines: Object.freeze(lines) as unknown as StockDocumentLine[],
  };
  Object.freeze(document);

  return { ...snapshot, balances, documents: [...snapshot.documents, document] };
}
