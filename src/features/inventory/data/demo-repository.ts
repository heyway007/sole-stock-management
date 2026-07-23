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
import { normalizeSizeLabel } from "@/features/inventory/domain/size-label";
import type { InventoryRepository } from "./inventory-repository";
import { createSeedSnapshot } from "./seed";

export const INVENTORY_STORAGE_KEY = "sole-stock.inventory.v1";
const INVENTORY_LOCK_NAME = "sole-stock.inventory.mutation.v1";

export interface InventoryLockManager {
  request<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
}

export interface DemoInventoryRepositoryOptions {
  createId?: () => string;
  lockManager?: InventoryLockManager;
  storageEventTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
}

function browserLockManager(): InventoryLockManager | undefined {
  if (typeof navigator === "undefined" || !navigator.locks) return undefined;
  return {
    request: (name, callback) => navigator.locks.request(name, () => callback()),
  };
}

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
  const normalizedSize = isRecord(value) ? normalizeSizeLabel(value.size) : null;
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.modelId)
    && modelIds.has(value.modelId)
    && isNonEmptyString(value.colorId)
    && colorIds.has(value.colorId)
    && typeof value.size === "string"
    && normalizedSize === value.size
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
    || (value.revision !== undefined && (!Number.isInteger(value.revision) || (value.revision as number) < 0))
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
  private readonly createId: () => string;
  private readonly lockManager: InventoryLockManager | undefined;
  private readonly storageEventTarget: Pick<EventTarget, "addEventListener" | "removeEventListener"> | undefined;

  constructor(
    private readonly storage: Storage,
    options: DemoInventoryRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? (() => globalThis.crypto.randomUUID());
    this.lockManager = options.lockManager ?? browserLockManager();
    this.storageEventTarget = options.storageEventTarget
      ?? (typeof window === "undefined" ? undefined : window);
  }

  async load(): Promise<InventorySnapshot> {
    return cloneSnapshot(this.current());
  }

  subscribe(listener: () => void): () => void {
    if (!this.storageEventTarget) return () => undefined;
    const handleStorage = (event: Event) => {
      const storageEvent = event as StorageEvent;
      if (storageEvent.key !== null && storageEvent.key !== INVENTORY_STORAGE_KEY) return;
      if (storageEvent.storageArea && storageEvent.storageArea !== this.storage) return;
      this.snapshot = null;
      listener();
    };
    this.storageEventTarget.addEventListener("storage", handleStorage);
    return () => this.storageEventTarget?.removeEventListener("storage", handleStorage);
  }

  async postDocument(input: StockDocumentInput): Promise<StockDocument> {
    return this.mutate((current) => this.projectDocument(current, input));
  }

  async clearStock(effectiveDate: string): Promise<StockDocument | null> {
    return this.mutate((current) => {
      const lines = current.variants.flatMap((variant) => {
        const quantity = current.balances[variant.id] ?? 0;
        return quantity > 0
          ? [{ variantId: variant.id, size: variant.size, quantity, direction: "OUT" as const }]
          : [];
      });
      if (lines.length === 0) return { snapshot: current, result: null };
      return this.projectDocument(current, {
        type: "ADJUSTMENT",
        effectiveDate,
        reference: "CLEAR-STOCK",
        note: "ล้างสต๊อกทั้งคลัง",
        lines,
      });
    });
  }

  async ensureVariant(modelId: string, colorId: string, size: string): Promise<ProductVariant> {
    const normalizedSize = normalizeSizeLabel(size);
    if (!normalizedSize) throw new Error("กรุณาระบุไซซ์รองเท้า");
    return this.mutate((snapshot) => {
      if (!snapshot.models.some((model) => model.id === modelId && model.active)) {
        throw new Error("ไม่พบรุ่นรองเท้าที่เปิดใช้งาน");
      }
      if (!snapshot.colors.some((color) => color.id === colorId && color.active)) {
        throw new Error("ไม่พบสีที่เปิดใช้งาน");
      }
      const existing = snapshot.variants.find((variant) =>
        variant.modelId === modelId
        && variant.colorId === colorId
        && variant.size.toLocaleLowerCase() === normalizedSize.toLocaleLowerCase(),
      );
      if (existing) {
        const variant = existing.active ? existing : { ...existing, active: true };
        return {
          snapshot: existing.active
            ? snapshot
            : { ...snapshot, variants: snapshot.variants.map((item) => item.id === variant.id ? variant : item) },
          result: { ...variant },
        };
      }
      const variant: ProductVariant = {
        id: this.createId(),
        modelId,
        colorId,
        size: normalizedSize,
        lowStockThreshold: 3,
        active: true,
      };
      return {
        snapshot: {
          ...snapshot,
          variants: [...snapshot.variants, variant],
          balances: { ...snapshot.balances, [variant.id]: 0 },
        },
        result: { ...variant },
      };
    });
  }

  async saveLowStockThreshold(variantId: string, threshold: number): Promise<void> {
    if (!Number.isInteger(threshold) || threshold < 0) {
      throw new Error("เกณฑ์สต็อกต่ำต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
    }
    await this.mutate((snapshot) => {
      if (!snapshot.variants.some((variant) => variant.id === variantId)) throw new Error("ไม่พบสินค้าที่เลือก");
      return {
        snapshot: {
          ...snapshot,
          variants: snapshot.variants.map((variant) =>
            variant.id === variantId ? { ...variant, lowStockThreshold: threshold } : variant,
          ),
        },
        result: undefined,
      };
    });
  }

  async addModel(name: string): Promise<ShoeModel> {
    const trimmed = validatedName(name);
    const model: ShoeModel = { id: this.createId(), name: trimmed, active: true };
    await this.mutate((snapshot) => {
      if (snapshot.models.some((item) => normalizedName(item.name) === normalizedName(trimmed))) {
        throw new Error("มีชื่อรุ่นนี้ซ้ำอยู่แล้ว");
      }
      return { snapshot: { ...snapshot, models: [...snapshot.models, model] }, result: undefined };
    });
    return { ...model };
  }

  async renameModel(id: string, name: string): Promise<void> {
    await this.renameCatalog("models", id, name, "รุ่น");
  }

  async setModelActive(id: string, active: boolean): Promise<void> {
    await this.setCatalogActive("models", id, active, "รุ่น");
  }

  async addColor(name: string): Promise<Color> {
    const trimmed = validatedName(name);
    const color: Color = { id: this.createId(), name: trimmed, active: true };
    await this.mutate((snapshot) => {
      if (snapshot.colors.some((item) => normalizedName(item.name) === normalizedName(trimmed))) {
        throw new Error("มีชื่อสีนี้ซ้ำอยู่แล้ว");
      }
      return { snapshot: { ...snapshot, colors: [...snapshot.colors, color] }, result: undefined };
    });
    return { ...color };
  }

  async renameColor(id: string, name: string): Promise<void> {
    await this.renameCatalog("colors", id, name, "สี");
  }

  async setColorActive(id: string, active: boolean): Promise<void> {
    await this.setCatalogActive("colors", id, active, "สี");
  }

  private readStoredSnapshot(): InventorySnapshot | null {
    const stored = this.storage.getItem(INVENTORY_STORAGE_KEY);
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (isSnapshot(parsed)) {
          return cloneSnapshot(parsed);
        }
      } catch {
        // Corrupt persisted data intentionally remains untouched until a successful mutation.
      }
    }
    return null;
  }

  private projectDocument(
    current: InventorySnapshot,
    input: StockDocumentInput,
  ): { snapshot: InventorySnapshot; result: StockDocument } {
    const ordinal = current.documents.length + 1;
    const documentId = this.createId();
    const lineIds = input.lines.map(() => this.createId());
    let next: InventorySnapshot;
    try {
      next = postDocument(current, input, {
        documentId: () => documentId,
        lineId: (index) => lineIds[index],
        documentNumber: () => `STK-${input.effectiveDate.replaceAll("-", "")}-${String(ordinal).padStart(4, "0")}`,
        now: () => new Date().toISOString(),
      });
    } catch (error) {
      throw errorForPost(error);
    }
    const document = next.documents.at(-1)!;
    return {
      snapshot: next,
      result: { ...document, lines: document.lines.map((line) => ({ ...line })) },
    };
  }

  private current(): InventorySnapshot {
    this.snapshot = this.readStoredSnapshot() ?? createSeedSnapshot();
    return this.snapshot;
  }

  private async mutate<T>(
    project: (snapshot: InventorySnapshot) => { snapshot: InventorySnapshot; result: T },
  ): Promise<T> {
    const operation = () => {
      const current = this.readStoredSnapshot() ?? createSeedSnapshot();
      const baseRevision = current.revision ?? 0;
      const projected = project(current);
      const latestRevision = this.readStoredSnapshot()?.revision ?? 0;
      if (latestRevision !== baseRevision) {
        throw new Error("ข้อมูลสต็อกมีการเปลี่ยนแปลง กรุณาลองอีกครั้ง");
      }
      const next = { ...projected.snapshot, revision: baseRevision + 1 };
      this.publish(next);
      return projected.result;
    };
    return this.lockManager
      ? this.lockManager.request(INVENTORY_LOCK_NAME, operation)
      : operation();
  }

  private publish(next: InventorySnapshot): void {
    this.storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(next));
    this.snapshot = next;
  }

  private async renameCatalog(kind: "models" | "colors", id: string, name: string, label: string): Promise<void> {
    const trimmed = validatedName(name);
    await this.mutate((snapshot) => {
      const records = snapshot[kind];
      if (!records.some((record) => record.id === id)) throw new Error(`ไม่พบ${label}ที่เลือก`);
      if (records.some((record) => record.id !== id && normalizedName(record.name) === normalizedName(trimmed))) {
        throw new Error(`มีชื่อ${label}นี้ซ้ำอยู่แล้ว`);
      }
      return {
        snapshot: { ...snapshot, [kind]: records.map((record) => record.id === id ? { ...record, name: trimmed } : record) },
        result: undefined,
      };
    });
  }

  private async setCatalogActive(kind: "models" | "colors", id: string, active: boolean, label: string): Promise<void> {
    await this.mutate((snapshot) => {
      const records = snapshot[kind];
      if (!records.some((record) => record.id === id)) throw new Error(`ไม่พบ${label}ที่เลือก`);
      return {
        snapshot: { ...snapshot, [kind]: records.map((record) => record.id === id ? { ...record, active } : record) },
        result: undefined,
      };
    });
  }
}
