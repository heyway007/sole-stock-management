import { postDocument } from "@/features/inventory/domain/post-document";
import type {
  Color,
  InventorySnapshot,
  ProductVariant,
  ShoeModel,
  StockDocument,
  StockDocumentInput,
  StockDocumentLine,
} from "@/features/inventory/domain/types";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCatalogRecord(value: unknown): value is ShoeModel | Color {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && typeof value.active === "boolean";
}

function isVariant(value: unknown, modelIds: Set<string>, colorIds: Set<string>): value is ProductVariant {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.modelId)
    && modelIds.has(value.modelId)
    && isNonEmptyString(value.colorId)
    && colorIds.has(value.colorId)
    && typeof value.size === "number"
    && Number.isFinite(value.size)
    && value.size > 0
    && typeof value.lowStockThreshold === "number"
    && Number.isInteger(value.lowStockThreshold)
    && value.lowStockThreshold >= 0
    && typeof value.active === "boolean";
}

function isDocumentLine(value: unknown, variantIds: Set<string>): value is StockDocumentLine {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.variantId)
    && variantIds.has(value.variantId)
    && typeof value.delta === "number"
    && Number.isInteger(value.delta)
    && value.delta !== 0
    && (value.section === undefined || value.section === "RETURNED" || value.section === "REPLACEMENT")
    && (value.note === undefined || typeof value.note === "string");
}

function isDocument(value: unknown, variantIds: Set<string>): value is StockDocument {
  const movementTypes = new Set(["RECEIPT", "SALE", "DAMAGE", "ADJUSTMENT", "EXCHANGE"]);
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.number)
    || typeof value.type !== "string"
    || !movementTypes.has(value.type)
    || !isNonEmptyString(value.effectiveDate)
    || typeof value.reference !== "string"
    || typeof value.note !== "string"
    || !isNonEmptyString(value.createdAt)
    || !Array.isArray(value.lines)
    || value.lines.length === 0
    || !value.lines.every((line) => isDocumentLine(line, variantIds))) {
    return false;
  }
  return new Set(value.lines.map((line) => line.id)).size === value.lines.length;
}

function hasUniqueIds(records: Array<{ id: string }>): boolean {
  return new Set(records.map((record) => record.id)).size === records.length;
}

function isSnapshot(value: unknown): value is InventorySnapshot {
  if (!isRecord(value)) return false;
  const balances = value.balances;
  if (value.version !== 1
    || !Array.isArray(value.models)
    || !Array.isArray(value.colors)
    || !Array.isArray(value.variants)
    || !Array.isArray(value.documents)
    || !isRecord(balances)
    || !value.models.every(isCatalogRecord)
    || !value.colors.every(isCatalogRecord)) {
    return false;
  }

  const modelIds = new Set(value.models.map((model) => model.id));
  const colorIds = new Set(value.colors.map((color) => color.id));
  if (!hasUniqueIds(value.models) || !hasUniqueIds(value.colors)
    || !value.variants.every((variant) => isVariant(variant, modelIds, colorIds))) {
    return false;
  }

  const variantIds = new Set(value.variants.map((variant) => variant.id));
  if (!hasUniqueIds(value.variants)
    || Object.keys(balances).length !== value.variants.length
    || !Object.keys(balances).every((variantId) => variantIds.has(variantId))
    || !value.variants.every((variant) => {
      const balance = balances[variant.id];
      return typeof balance === "number" && Number.isFinite(balance) && Number.isInteger(balance) && balance >= 0;
    })
    || !value.documents.every((document) => isDocument(document, variantIds))) {
    return false;
  }

  return hasUniqueIds(value.documents)
    && new Set(value.documents.map((document) => document.number)).size === value.documents.length;
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
