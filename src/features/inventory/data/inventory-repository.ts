import type { Color, InventorySnapshot, ShoeModel, StockDocument, StockDocumentInput } from "@/features/inventory/domain/types";

export interface InventoryRepository {
  load(): Promise<InventorySnapshot>;
  postDocument(input: StockDocumentInput): Promise<StockDocument>;
  saveLowStockThreshold(variantId: string, threshold: number): Promise<void>;
  addModel(name: string): Promise<ShoeModel>;
  renameModel(id: string, name: string): Promise<void>;
  setModelActive(id: string, active: boolean): Promise<void>;
  addColor(name: string): Promise<Color>;
  renameColor(id: string, name: string): Promise<void>;
  setColorActive(id: string, active: boolean): Promise<void>;
}
