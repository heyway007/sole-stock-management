import type { PostgrestError } from "@supabase/supabase-js";
import {
  createInventorySupabaseClient,
  type InventorySupabaseClient,
  type Json,
} from "@/lib/supabase";
import type { StockDocument, StockDocumentLine } from "@/features/inventory/domain/types";
import type {
  ProductionOrder,
  ProductionOrderInput,
  ProductionOrderLine,
  ProductionOrderReceiptResult,
  ProductionOrderStatus,
} from "../domain/types";
import {
  ProductionOrderValidationException,
  validateProductionOrder,
} from "../domain/validation";
import type { ProductionOrderRepository } from "./production-order-repository";

export const PENDING_PRODUCTION_ORDERS_STORAGE_KEY = "sole-stock.production-orders.pending.v1";

interface PendingRequest {
  requestId: string;
  inFlight?: Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isStatus(value: unknown): value is ProductionOrderStatus {
  return value === "OPEN" || value === "RECEIVED" || value === "CANCELLED";
}

function mappedLine(value: unknown): ProductionOrderLine {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.variantId)
    || typeof value.lineNumber !== "number"
    || !Number.isInteger(value.lineNumber)
    || value.lineNumber < 1
    || !isNonEmptyString(value.modelName)
    || !isNonEmptyString(value.colorName)
    || typeof value.size !== "number"
    || !Number.isFinite(value.size)
    || value.size <= 0
    || typeof value.quantity !== "number"
    || !Number.isInteger(value.quantity)
    || value.quantity < 1) {
    throw new Error("ข้อมูลใบผลิตจากเซิร์ฟเวอร์ไม่ถูกต้อง");
  }
  return {
    id: value.id,
    variantId: value.variantId,
    lineNumber: value.lineNumber,
    modelName: value.modelName,
    colorName: value.colorName,
    size: value.size,
    quantity: value.quantity,
  };
}

function mappedOrder(value: unknown): ProductionOrder {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.number)
    || !isIsoDate(value.orderDate)
    || !isIsoDate(value.expectedDate)
    || value.expectedDate < value.orderDate
    || typeof value.note !== "string"
    || !isStatus(value.status)
    || (value.receivedDocumentId !== null && !isNonEmptyString(value.receivedDocumentId))
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || (value.receivedAt !== null && !isTimestamp(value.receivedAt))
    || (value.cancelledAt !== null && !isTimestamp(value.cancelledAt))
    || !Array.isArray(value.lines)
    || value.lines.length === 0) {
    throw new Error("ข้อมูลใบผลิตจากเซิร์ฟเวอร์ไม่ถูกต้อง");
  }
  const lines = value.lines.map(mappedLine);
  const terminalFieldsAreValid = value.status === "OPEN"
    ? value.receivedDocumentId === null && value.receivedAt === null && value.cancelledAt === null
    : value.status === "RECEIVED"
      ? isNonEmptyString(value.receivedDocumentId) && isTimestamp(value.receivedAt) && value.cancelledAt === null
      : value.receivedDocumentId === null && value.receivedAt === null && isTimestamp(value.cancelledAt);
  const lineNumbers = lines.map((line) => line.lineNumber);
  if (!terminalFieldsAreValid
    || new Set(lines.map((line) => line.id)).size !== lines.length
    || new Set(lines.map((line) => line.variantId)).size !== lines.length
    || lineNumbers.some((lineNumber, index) => lineNumber !== index + 1)) {
    throw new Error("ข้อมูลใบผลิตจากเซิร์ฟเวอร์ไม่ถูกต้อง");
  }
  return {
    id: value.id,
    number: value.number,
    orderDate: value.orderDate,
    expectedDate: value.expectedDate,
    note: value.note,
    status: value.status,
    receivedDocumentId: value.receivedDocumentId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    receivedAt: value.receivedAt,
    cancelledAt: value.cancelledAt,
    lines,
  };
}

function mappedReceiptDocument(value: unknown): StockDocument {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.number)
    || value.type !== "RECEIPT"
    || !isIsoDate(value.effectiveDate)
    || typeof value.reference !== "string"
    || typeof value.note !== "string"
    || !isTimestamp(value.createdAt)
    || !Array.isArray(value.lines)
    || value.lines.length === 0) {
    throw new Error("ข้อมูลเอกสารรับเข้าจากเซิร์ฟเวอร์ไม่ถูกต้อง");
  }
  const lines = value.lines.map((line): StockDocumentLine => {
    if (!isRecord(line)
      || !isNonEmptyString(line.id)
      || !isNonEmptyString(line.variantId)
      || typeof line.delta !== "number"
      || !Number.isInteger(line.delta)
      || line.delta <= 0) {
      throw new Error("ข้อมูลเอกสารรับเข้าจากเซิร์ฟเวอร์ไม่ถูกต้อง");
    }
    return { id: line.id, variantId: line.variantId, delta: line.delta };
  });
  return {
    id: value.id,
    number: value.number,
    type: "RECEIPT",
    effectiveDate: value.effectiveDate,
    reference: value.reference,
    note: value.note,
    createdAt: value.createdAt,
    lines,
  };
}

function mappedReceipt(value: unknown): ProductionOrderReceiptResult {
  if (!isRecord(value)) {
    throw new Error("ข้อมูลการรับเข้าใบผลิตจากเซิร์ฟเวอร์ไม่ถูกต้อง");
  }
  return {
    order: mappedOrder(value.order),
    document: mappedReceiptDocument(value.document),
  };
}

function errorFields(error: unknown): { code: string; message: string } {
  if (!error || typeof error !== "object") return { code: "", message: "" };
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : "",
    message: typeof candidate.message === "string" ? candidate.message : "",
  };
}

export function toProductionOrderRepositoryError(error: unknown): Error {
  if (error instanceof ProductionOrderValidationException) return error;
  if (error instanceof Error && /[\u0E00-\u0E7F]/.test(error.message)) return error;
  const { message } = errorFields(error);
  if (message.includes("PRODUCTION_ORDER_NOT_FOUND")) return new Error("ไม่พบใบผลิตที่เลือก");
  if (message.includes("PRODUCTION_ORDER_RECEIVED")) return new Error("ใบผลิตนี้รับเข้าสต๊อกแล้ว");
  if (message.includes("PRODUCTION_ORDER_CANCELLED")) return new Error("ใบผลิตนี้ถูกยกเลิกแล้ว");
  if (message.includes("PRODUCTION_ORDER_NOT_OPEN")) return new Error("แก้ไขได้เฉพาะใบผลิตที่รอรับเข้า");
  if (message.includes("PRODUCTION_VARIANT_NOT_FOUND")) return new Error("ไม่พบสินค้าที่เปิดใช้งาน");
  if (message.includes("DUPLICATE_PRODUCTION_VARIANT")) return new Error("ไม่สามารถเลือกรุ่น สี และไซซ์ซ้ำในใบเดียวกันได้");
  if (message.includes("INVALID_PRODUCTION_ORDER")) return new Error("กรุณาตรวจสอบข้อมูลใบผลิตให้ถูกต้อง");
  return new Error("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
}

function throwFor(error: PostgrestError | null): void {
  if (error) throw toProductionOrderRepositoryError(error);
}

function commandFor(input: ProductionOrderInput): Json {
  return {
    ...(input.id ? { orderId: input.id } : {}),
    orderDate: input.orderDate,
    expectedDate: input.expectedDate,
    note: input.note,
    lines: input.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
    })),
  };
}

export class SupabaseProductionOrderRepository implements ProductionOrderRepository {
  private readonly client: InventorySupabaseClient;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pendingStorage: Storage | undefined;

  constructor(
    private readonly url: string,
    anonymousKey: string,
    client?: InventorySupabaseClient,
    private readonly createRequestId: () => string = () => globalThis.crypto.randomUUID(),
    pendingStorage?: Storage,
  ) {
    this.client = client ?? createInventorySupabaseClient(url, anonymousKey);
    this.pendingStorage = pendingStorage
      ?? (typeof window === "undefined" ? undefined : window.localStorage);
  }

  async load(): Promise<ProductionOrder[]> {
    const result = await this.client.rpc("get_production_orders");
    throwFor(result.error);
    if (!Array.isArray(result.data)) {
      throw new Error("ข้อมูลใบผลิตจากเซิร์ฟเวอร์ไม่ถูกต้อง");
    }
    return result.data.map(mappedOrder);
  }

  async save(input: ProductionOrderInput): Promise<ProductionOrder> {
    const validated = validateProductionOrder(input);
    if (!validated.success) throw new ProductionOrderValidationException(validated.errors);
    const baseCommand = commandFor(validated.data);
    if (validated.data.id) {
      return this.saveCommand(baseCommand);
    }
    const key = `create:${JSON.stringify(baseCommand)}`;
    return this.withRequest(key, (requestId) => this.saveCommand({
      ...(baseCommand as Record<string, Json | undefined>),
      requestId,
    }));
  }

  async cancel(orderId: string): Promise<ProductionOrder> {
    const result = await this.client.rpc("cancel_production_order", {
      command: { orderId },
    });
    throwFor(result.error);
    return mappedOrder(result.data);
  }

  async receive(orderId: string, effectiveDate: string): Promise<ProductionOrderReceiptResult> {
    return this.withRequest(`receive:${orderId}`, async (requestId) => {
      const result = await this.client.rpc("receive_production_order", {
        command: { requestId, orderId, effectiveDate },
      });
      throwFor(result.error);
      return mappedReceipt(result.data);
    });
  }

  private async saveCommand(command: Json): Promise<ProductionOrder> {
    const result = await this.client.rpc("save_production_order", { command });
    throwFor(result.error);
    return mappedOrder(result.data);
  }

  private storageKey(key: string): string {
    return `${PENDING_PRODUCTION_ORDERS_STORAGE_KEY}:${encodeURIComponent(`${this.url}\u0000${key}`)}`;
  }

  private requestIdFor(key: string): string {
    const active = this.pending.get(key);
    if (active) return active.requestId;
    let requestId: string | null = null;
    try {
      requestId = this.pendingStorage?.getItem(this.storageKey(key)) ?? null;
    } catch {
      requestId = null;
    }
    requestId ||= this.createRequestId();
    this.pending.set(key, { requestId });
    try {
      this.pendingStorage?.setItem(this.storageKey(key), requestId);
    } catch {
      // In-memory identity still protects retries in this repository instance.
    }
    return requestId;
  }

  private async withRequest<T>(key: string, operation: (requestId: string) => Promise<T>): Promise<T> {
    const requestId = this.requestIdFor(key);
    const pending = this.pending.get(key)!;
    if (pending.inFlight) return pending.inFlight as Promise<T>;
    const attempt = operation(requestId);
    pending.inFlight = attempt;
    try {
      const result = await attempt;
      this.pending.delete(key);
      try {
        this.pendingStorage?.removeItem(this.storageKey(key));
      } catch {
        // A confirmed RPC remains successful when local cleanup is unavailable.
      }
      return result;
    } catch (error) {
      pending.inFlight = undefined;
      throw toProductionOrderRepositoryError(error);
    }
  }
}
