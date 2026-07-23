import type {
  InventoryLockManager,
} from "@/features/inventory/data/demo-repository";
import type { InventoryRepository } from "@/features/inventory/data/inventory-repository";
import type { InventorySnapshot, StockDocument } from "@/features/inventory/domain/types";
import { normalizeSizeLabel } from "@/features/inventory/domain/size-label";
import type {
  ProductionOrder,
  ProductionOrderInput,
  ProductionOrderLine,
  ProductionOrderLineInput,
  ProductionOrderReceiptResult,
} from "../domain/types";
import {
  ProductionOrderValidationException,
  validateProductionOrder,
} from "../domain/validation";
import type { ProductionOrderRepository } from "./production-order-repository";

export const PRODUCTION_ORDER_STORAGE_KEY = "sole-stock.production-orders.v1";
const PRODUCTION_ORDER_LOCK = "sole-stock.production-orders.mutation.v1";

function browserLockManager(): InventoryLockManager | undefined {
  if (typeof navigator === "undefined" || !navigator.locks) return undefined;
  return {
    request: (name, callback) => navigator.locks.request(name, () => callback()),
  };
}

interface DemoState {
  version: 1;
  revision: number;
  orders: ProductionOrder[];
  receipts: Record<string, StockDocument>;
}

interface DemoProductionOrderRepositoryOptions {
  createId?: () => string;
  now?: () => string;
  lockManager?: InventoryLockManager;
}

export class DemoProductionOrderRepository implements ProductionOrderRepository {
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly lockManager: InventoryLockManager | undefined;

  constructor(
    private readonly storage: Storage,
    private readonly inventory: InventoryRepository,
    options: DemoProductionOrderRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? (() => globalThis.crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
    this.lockManager = options.lockManager ?? browserLockManager();
  }

  async load(): Promise<ProductionOrder[]> {
    return structuredClone(this.current().orders);
  }

  async save(input: ProductionOrderInput): Promise<ProductionOrder> {
    const validated = validateProductionOrder(input);
    if (!validated.success) {
      throw new ProductionOrderValidationException(validated.errors);
    }

    return this.mutate(async (state) => {
      const catalog = await this.inventory.load();
      const existing = validated.data.id
        ? state.orders.find((order) => order.id === validated.data.id)
        : undefined;
      if (validated.data.id && (!existing || existing.status !== "OPEN")) {
        throw new Error("แก้ไขได้เฉพาะใบผลิตที่รอรับเข้า");
      }

      const lines = validated.data.lines.map((line, index) =>
        snapshotLine(catalog, line, index + 1, this.createId()));
      const now = this.now();
      const order: ProductionOrder = existing
        ? {
            ...existing,
            orderDate: validated.data.orderDate,
            expectedDate: validated.data.expectedDate,
            note: validated.data.note,
            updatedAt: now,
            lines,
          }
        : {
            id: this.createId(),
            number: nextNumber(state, validated.data.orderDate),
            orderDate: validated.data.orderDate,
            expectedDate: validated.data.expectedDate,
            note: validated.data.note,
            status: "OPEN",
            receivedDocumentId: null,
            createdAt: now,
            updatedAt: now,
            receivedAt: null,
            cancelledAt: null,
            lines,
          };

      return {
        state: existing
          ? replaceOrder(state, order)
          : { ...state, orders: [...state.orders, order] },
        result: order,
      };
    });
  }

  async cancel(orderId: string): Promise<ProductionOrder> {
    return this.mutate(async (state) => {
      const order = requiredOrder(state, orderId);
      if (order.status === "RECEIVED") {
        throw new Error("ใบผลิตนี้รับเข้าสต๊อกแล้ว");
      }
      if (order.status === "CANCELLED") return { state, result: order };

      const now = this.now();
      const cancelled: ProductionOrder = {
        ...order,
        status: "CANCELLED",
        cancelledAt: now,
        updatedAt: now,
      };
      return { state: replaceOrder(state, cancelled), result: cancelled };
    });
  }

  async receive(orderId: string, effectiveDate: string): Promise<ProductionOrderReceiptResult> {
    return this.mutate(async (state) => {
      const order = requiredOrder(state, orderId);
      if (order.status === "CANCELLED") {
        throw new Error("ไม่สามารถรับใบผลิตที่ยกเลิกแล้ว");
      }
      if (order.status === "RECEIVED") {
        return { state, result: receiptResult(state, order) };
      }

      const document = await this.inventory.postDocument({
        type: "RECEIPT",
        effectiveDate,
        reference: order.number,
        note: `รับเข้าจากใบผลิต ${order.number}`,
        lines: order.lines.map((line) => ({
          variantId: line.variantId,
          size: line.size,
          quantity: line.quantity,
        })),
      });
      const now = this.now();
      const received: ProductionOrder = {
        ...order,
        status: "RECEIVED",
        receivedDocumentId: document.id,
        receivedAt: now,
        updatedAt: now,
      };
      return {
        state: storeReceipt(replaceOrder(state, received), document),
        result: { order: received, document },
      };
    });
  }

  subscribe(listener: () => void): () => void {
    const target = typeof window === "undefined" ? undefined : window;
    if (!target) return () => undefined;
    const handle = (event: StorageEvent) => {
      if (event.key === null || event.key === PRODUCTION_ORDER_STORAGE_KEY) listener();
    };
    target.addEventListener("storage", handle);
    return () => target.removeEventListener("storage", handle);
  }

  private current(): DemoState {
    const raw = this.storage.getItem(PRODUCTION_ORDER_STORAGE_KEY);
    if (!raw) return emptyState();
    try {
      const parsed: unknown = JSON.parse(raw);
      const projected = projectDemoState(parsed);
      return projected ? structuredClone(projected) : emptyState();
    } catch {
      return emptyState();
    }
  }

  private async mutate<T>(
    project: (state: DemoState) => Promise<{ state: DemoState; result: T }>,
  ): Promise<T> {
    const operation = async () => {
      const current = this.current();
      const projected = await project(current);
      const latestRevision = this.current().revision;
      if (latestRevision !== current.revision) {
        throw new Error("ข้อมูลใบผลิตมีการเปลี่ยนแปลง กรุณาลองอีกครั้ง");
      }
      const next: DemoState = {
        ...projected.state,
        revision: current.revision + 1,
      };
      this.storage.setItem(PRODUCTION_ORDER_STORAGE_KEY, JSON.stringify(next));
      return structuredClone(projected.result);
    };
    return this.lockManager
      ? this.lockManager.request(PRODUCTION_ORDER_LOCK, operation)
      : operation();
  }
}

function emptyState(): DemoState {
  return { version: 1, revision: 0, orders: [], receipts: {} };
}

function nextNumber(state: DemoState, orderDate: string): string {
  return `PO-${orderDate.replaceAll("-", "")}-${String(state.orders.length + 1).padStart(6, "0")}`;
}

function requiredOrder(state: DemoState, orderId: string): ProductionOrder {
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) throw new Error("ไม่พบใบผลิตที่เลือก");
  return order;
}

function replaceOrder(state: DemoState, order: ProductionOrder): DemoState {
  return {
    ...state,
    orders: state.orders.map((candidate) => candidate.id === order.id ? order : candidate),
  };
}

function storeReceipt(state: DemoState, document: StockDocument): DemoState {
  return {
    ...state,
    receipts: { ...state.receipts, [document.id]: document },
  };
}

function receiptResult(
  state: DemoState,
  order: ProductionOrder,
): ProductionOrderReceiptResult {
  const document = order.receivedDocumentId
    ? state.receipts[order.receivedDocumentId]
    : undefined;
  if (!document) throw new Error("ไม่พบเอกสารรับเข้าของใบผลิต");
  return { order, document };
}

function snapshotLine(
  snapshot: InventorySnapshot,
  input: ProductionOrderLineInput,
  lineNumber: number,
  id: string,
): ProductionOrderLine {
  const variant = snapshot.variants.find((candidate) =>
    candidate.id === input.variantId && candidate.active);
  const model = variant && snapshot.models.find((candidate) =>
    candidate.id === variant.modelId && candidate.active);
  const color = variant && snapshot.colors.find((candidate) =>
    candidate.id === variant.colorId && candidate.active);
  if (!variant || !model || !color) throw new Error("ไม่พบสินค้าที่เปิดใช้งาน");
  return {
    id,
    variantId: variant.id,
    lineNumber,
    modelName: model.name,
    colorName: color.name,
    size: variant.size,
    quantity: input.quantity,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isProductionOrderLineRecord(value: unknown): value is ProductionOrderLine {
  const size = isRecord(value) ? normalizeSizeLabel(value.size) : null;
  return isRecord(value)
    && typeof value.id === "string" && value.id.length > 0
    && typeof value.variantId === "string" && value.variantId.length > 0
    && Number.isInteger(value.lineNumber) && (value.lineNumber as number) > 0
    && typeof value.modelName === "string" && value.modelName.length > 0
    && typeof value.colorName === "string" && value.colorName.length > 0
    && typeof value.size === "string" && size === value.size
    && Number.isInteger(value.quantity) && (value.quantity as number) > 0;
}

function isProductionOrderRecord(value: unknown): value is ProductionOrder {
  if (!isRecord(value)
    || typeof value.id !== "string" || !value.id
    || typeof value.number !== "string" || !value.number
    || typeof value.orderDate !== "string"
    || typeof value.expectedDate !== "string"
    || typeof value.note !== "string"
    || !["OPEN", "RECEIVED", "CANCELLED"].includes(String(value.status))
    || (value.receivedDocumentId !== null && typeof value.receivedDocumentId !== "string")
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || (value.receivedAt !== null && typeof value.receivedAt !== "string")
    || (value.cancelledAt !== null && typeof value.cancelledAt !== "string")
    || value.expectedDate < value.orderDate
    || !Array.isArray(value.lines)
    || !value.lines.every(isProductionOrderLineRecord)) return false;

  const order = value as unknown as ProductionOrder;
  const terminalFieldsAreValid = order.status === "OPEN"
    ? order.receivedDocumentId === null && order.receivedAt === null && order.cancelledAt === null
    : order.status === "RECEIVED"
      ? !!order.receivedDocumentId && !!order.receivedAt && order.cancelledAt === null
      : order.receivedDocumentId === null && order.receivedAt === null && !!order.cancelledAt;
  return terminalFieldsAreValid
    && new Set(order.lines.map((line) => line.id)).size === order.lines.length
    && new Set(order.lines.map((line) => line.variantId)).size === order.lines.length;
}

function isStockDocumentRecord(value: unknown): value is StockDocument {
  return isRecord(value)
    && typeof value.id === "string" && value.id.length > 0
    && typeof value.number === "string" && value.number.length > 0
    && ["RECEIPT", "SALE", "DAMAGE", "ADJUSTMENT", "EXCHANGE"].includes(String(value.type))
    && typeof value.effectiveDate === "string"
    && typeof value.reference === "string"
    && typeof value.note === "string"
    && typeof value.createdAt === "string"
    && Array.isArray(value.lines)
    && value.lines.length > 0
    && value.lines.every((line) => isRecord(line)
      && typeof line.id === "string" && line.id.length > 0
      && typeof line.variantId === "string" && line.variantId.length > 0
      && Number.isInteger(line.delta) && line.delta !== 0);
}

function isDemoState(value: unknown): value is DemoState {
  if (!isRecord(value)) return false;
  const state = value as Partial<DemoState>;
  return state.version === 1
    && Number.isInteger(state.revision)
    && (state.revision ?? -1) >= 0
    && Array.isArray(state.orders)
    && state.orders.every(isProductionOrderRecord)
    && !!state.receipts
    && typeof state.receipts === "object"
    && Object.values(state.receipts).every(isStockDocumentRecord);
}

function projectDemoState(value: unknown): DemoState | null {
  if (!isRecord(value) || !Array.isArray(value.orders)) return null;

  const orders = value.orders.map((candidate) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.lines)) {
      return candidate;
    }
    return {
      ...candidate,
      lines: candidate.lines.map((line) => {
        if (!isRecord(line)) return line;
        const size = normalizeSizeLabel(line.size);
        return size ? { ...line, size } : line;
      }),
    };
  });
  const projected = { ...value, orders };
  return isDemoState(projected) ? projected : null;
}
