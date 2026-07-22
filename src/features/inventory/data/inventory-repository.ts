import type { Color, InventorySnapshot, ProductVariant, ShoeModel, StockDocument, StockDocumentInput } from "@/features/inventory/domain/types";

export interface InventoryRepository {
  load(): Promise<InventorySnapshot>;
  subscribe?(listener: () => void): () => void;
  postDocument(input: StockDocumentInput): Promise<StockDocument>;
  ensureVariant(modelId: string, colorId: string, size: number): Promise<ProductVariant>;
  saveLowStockThreshold(variantId: string, threshold: number): Promise<void>;
  addModel(name: string): Promise<ShoeModel>;
  renameModel(id: string, name: string): Promise<void>;
  setModelActive(id: string, active: boolean): Promise<void>;
  addColor(name: string): Promise<Color>;
  renameColor(id: string, name: string): Promise<void>;
  setColorActive(id: string, active: boolean): Promise<void>;
}
