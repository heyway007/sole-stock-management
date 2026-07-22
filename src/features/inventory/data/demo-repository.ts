import { postDocument } from "@/features/inventory/domain/post-document";
import type { Color, InventorySnapshot, ShoeModel, StockDocument, StockDocumentInput } from "@/features/inventory/domain/types";
import type { InventoryRepository } from "./inventory-repository";
import { createSeedSnapshot } from "./seed";

export const INVENTORY_STORAGE_KEY = "sole-stock.inventory.v1";

function cloneSnapshot(snapshot: InventorySnapshot): InventorySnapshot {
  return {
    ...snapshot,
    models: snapshot.models.map((model) => ({ ...model })),
    colors: snapshot.colors.map((color) => ({ ...color })),
    variants: snapshot.variants.map((variant) => ({ ...variant })),
    balances: { ...snapshot.balances },
    documents: snapshot.documents.map((document) => ({
      ...document,
      lines: document.lines.map((line) => ({ ...line })),
    })),
  };
}

function isSnapshot(value: unknown): value is InventorySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<InventorySnapshot>;
  return snapshot.version === 1
    && Array.isArray(snapshot.models)
    && Array.isArray(snapshot.colors)
    && Array.isArray(snapshot.variants)
    && Array.isArray(snapshot.documents)
    && !!snapshot.balances
    && typeof snapshot.balances === "object"
    && !Array.isArray(snapshot.balances);
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

function validatedName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("กรุณาระบุชื่อให้ครบถ้วน");
  return trimmed;
}

function errorForPost(error: unknown): Error {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("INSUFFICIENT_STOCK")) return new Error("สต็อกไม่เพียงพอสำหรับรายการนี้");
  if (message.includes("VARIANT_NOT_FOUND")) return new Error("ไม่พบสินค้าที่เลือก");
  return new Error("กรุณาตรวจสอบข้อมูลเอกสารให้ถูกต้อง");
}

export class DemoInventoryRepository implements InventoryRepository {
  private snapshot: InventorySnapshot | null = null;

  constructor(private readonly storage: Storage) {}

  async load(): Promise<InventorySnapshot> {
    return cloneSnapshot(this.current());
  }

  async postDocument(input: StockDocumentInput): Promise<StockDocument> {
    const current = this.current();
    const ordinal = current.documents.length + 1;
    let next: InventorySnapshot;
    try {
      next = postDocument(current, input, {
        documentId: () => `doc-${ordinal}`,
        lineId: (index) => `doc-${ordinal}-line-${index + 1}`,
        documentNumber: () => `STK-${input.effectiveDate.replaceAll("-", "")}-${String(ordinal).padStart(4, "0")}`,
        now: () => new Date().toISOString(),
      });
    } catch (error) {
      throw errorForPost(error);
    }
    const document = next.documents.at(-1)!;
    this.publish(next);
    return { ...document, lines: document.lines.map((line) => ({ ...line })) };
  }

  async saveLowStockThreshold(variantId: string, threshold: number): Promise<void> {
    if (!Number.isInteger(threshold) || threshold < 0) {
      throw new Error("เกณฑ์สต็อกต่ำต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
    }
    this.mutate((snapshot) => {
      if (!snapshot.variants.some((variant) => variant.id === variantId)) throw new Error("ไม่พบสินค้าที่เลือก");
      return {
        ...snapshot,
        variants: snapshot.variants.map((variant) =>
          variant.id === variantId ? { ...variant, lowStockThreshold: threshold } : variant,
        ),
      };
    });
  }

  async addModel(name: string): Promise<ShoeModel> {
    const trimmed = validatedName(name);
    const model: ShoeModel = { id: `model-${encodeURIComponent(normalizedName(trimmed))}`, name: trimmed, active: true };
    this.mutate((snapshot) => {
      if (snapshot.models.some((item) => normalizedName(item.name) === normalizedName(trimmed))) {
        throw new Error("มีชื่อรุ่นนี้ซ้ำอยู่แล้ว");
      }
      return { ...snapshot, models: [...snapshot.models, model] };
    });
    return { ...model };
  }

  async renameModel(id: string, name: string): Promise<void> {
    this.renameCatalog("models", id, name, "รุ่น");
  }

  async setModelActive(id: string, active: boolean): Promise<void> {
    this.setCatalogActive("models", id, active, "รุ่น");
  }

  async addColor(name: string): Promise<Color> {
    const trimmed = validatedName(name);
    const color: Color = { id: `color-${encodeURIComponent(normalizedName(trimmed))}`, name: trimmed, active: true };
    this.mutate((snapshot) => {
      if (snapshot.colors.some((item) => normalizedName(item.name) === normalizedName(trimmed))) {
        throw new Error("มีชื่อสีนี้ซ้ำอยู่แล้ว");
      }
      return { ...snapshot, colors: [...snapshot.colors, color] };
    });
    return { ...color };
  }

  async renameColor(id: string, name: string): Promise<void> {
    this.renameCatalog("colors", id, name, "สี");
  }

  async setColorActive(id: string, active: boolean): Promise<void> {
    this.setCatalogActive("colors", id, active, "สี");
  }

  private current(): InventorySnapshot {
    if (this.snapshot) return this.snapshot;
    const stored = this.storage.getItem(INVENTORY_STORAGE_KEY);
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (isSnapshot(parsed)) {
          this.snapshot = cloneSnapshot(parsed);
          return this.snapshot;
        }
      } catch {
        // Corrupt persisted data intentionally remains untouched until a successful mutation.
      }
    }
    this.snapshot = createSeedSnapshot();
    return this.snapshot;
  }

  private mutate(project: (snapshot: InventorySnapshot) => InventorySnapshot): void {
    const next = project(this.current());
    this.publish(next);
  }

  private publish(next: InventorySnapshot): void {
    this.storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(next));
    this.snapshot = next;
  }

  private renameCatalog(kind: "models" | "colors", id: string, name: string, label: string): void {
    const trimmed = validatedName(name);
    this.mutate((snapshot) => {
      const records = snapshot[kind];
      if (!records.some((record) => record.id === id)) throw new Error(`ไม่พบ${label}ที่เลือก`);
      if (records.some((record) => record.id !== id && normalizedName(record.name) === normalizedName(trimmed))) {
        throw new Error(`มีชื่อ${label}นี้ซ้ำอยู่แล้ว`);
      }
      return { ...snapshot, [kind]: records.map((record) => record.id === id ? { ...record, name: trimmed } : record) };
    });
  }

  private setCatalogActive(kind: "models" | "colors", id: string, active: boolean, label: string): void {
    this.mutate((snapshot) => {
      const records = snapshot[kind];
      if (!records.some((record) => record.id === id)) throw new Error(`ไม่พบ${label}ที่เลือก`);
      return { ...snapshot, [kind]: records.map((record) => record.id === id ? { ...record, active } : record) };
    });
  }
}
