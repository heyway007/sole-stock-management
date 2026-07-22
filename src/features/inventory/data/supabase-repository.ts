import type { PostgrestError } from "@supabase/supabase-js";
import { createInventorySupabaseClient, type InventorySupabaseClient, type Json } from "@/lib/supabase";
import type {
  Color,
  InventorySnapshot,
  MovementType,
  ShoeModel,
  StockDocument,
  StockDocumentInput,
  StockDocumentLine,
} from "@/features/inventory/domain/types";
import type { InventoryRepository } from "./inventory-repository";

interface ModelRow {
  id: string;
  name: string;
  active: boolean;
}

interface ColorRow {
  id: string;
  name: string;
  active: boolean;
}

interface VariantRow {
  id: string;
  model_id: string;
  color_id: string;
  size: string | number;
  low_stock_threshold: number;
  active: boolean;
}

interface BalanceRow {
  variant_id: string;
  quantity: number;
}

interface DocumentRow {
  id: string;
  document_number: string;
  movement_type: MovementType;
  effective_date: string;
  reference: string;
  note: string;
  created_at: string;
}

interface LineRow {
  id: string;
  document_id: string;
  variant_id: string;
  delta: number;
  exchange_section: "RETURNED" | "REPLACEMENT" | null;
  note: string | null;
}

interface PendingPost {
  requestId: string;
  inFlight?: Promise<StockDocument>;
}

export interface InventoryDatabaseRows {
  models: ModelRow[];
  colors: ColorRow[];
  variants: VariantRow[];
  balances: BalanceRow[];
  documents: DocumentRow[];
  lines: LineRow[];
}

function mapLine(row: LineRow): StockDocumentLine {
  return {
    id: row.id,
    variantId: row.variant_id,
    delta: Number(row.delta),
    ...(row.exchange_section ? { section: row.exchange_section } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

function mapDocument(row: DocumentRow, lines: LineRow[]): StockDocument {
  return {
    id: row.id,
    number: row.document_number,
    type: row.movement_type,
    effectiveDate: row.effective_date,
    reference: row.reference,
    note: row.note,
    createdAt: row.created_at,
    lines: lines.map(mapLine),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function snapshotRows(payload: unknown): InventoryDatabaseRows {
  if (!isRecord(payload)
    || !Array.isArray(payload.models)
    || !Array.isArray(payload.colors)
    || !Array.isArray(payload.variants)
    || !Array.isArray(payload.balances)
    || !Array.isArray(payload.documents)
    || !Array.isArray(payload.lines)) {
    throw toInventoryRepositoryError(new Error("INVALID_SNAPSHOT_RESPONSE"));
  }
  return payload as unknown as InventoryDatabaseRows;
}

function postedDocument(payload: unknown): StockDocument {
  if (!isRecord(payload)
    || typeof payload.id !== "string"
    || typeof payload.number !== "string"
    || typeof payload.type !== "string"
    || typeof payload.effectiveDate !== "string"
    || typeof payload.reference !== "string"
    || typeof payload.note !== "string"
    || typeof payload.createdAt !== "string"
    || !Array.isArray(payload.lines)) {
    throw toInventoryRepositoryError(new Error("INVALID_DOCUMENT_RESPONSE"));
  }

  const lines = payload.lines.map((value) => {
    if (!isRecord(value)
      || typeof value.id !== "string"
      || typeof value.variantId !== "string"
      || typeof value.delta !== "number") {
      throw toInventoryRepositoryError(new Error("INVALID_DOCUMENT_RESPONSE"));
    }
    return {
      id: value.id,
      variantId: value.variantId,
      delta: value.delta,
      ...(value.section === "RETURNED" || value.section === "REPLACEMENT" ? { section: value.section } : {}),
      ...(typeof value.note === "string" && value.note ? { note: value.note } : {}),
    } satisfies StockDocumentLine;
  });

  return {
    id: payload.id,
    number: payload.number,
    type: payload.type as MovementType,
    effectiveDate: payload.effectiveDate,
    reference: payload.reference,
    note: payload.note,
    createdAt: payload.createdAt,
    lines,
  };
}

export function mapInventorySnapshot(rows: InventoryDatabaseRows): InventorySnapshot {
  const linesByDocument = new Map<string, LineRow[]>();
  for (const line of rows.lines) {
    const documentLines = linesByDocument.get(line.document_id) ?? [];
    documentLines.push(line);
    linesByDocument.set(line.document_id, documentLines);
  }

  const balances: Record<string, number> = Object.fromEntries(
    rows.variants.map((variant) => [variant.id, 0]),
  );
  for (const balance of rows.balances) balances[balance.variant_id] = Number(balance.quantity);

  return {
    version: 1,
    models: rows.models.map(({ id, name, active }) => ({ id, name, active })),
    colors: rows.colors.map(({ id, name, active }) => ({ id, name, active })),
    variants: rows.variants.map((variant) => ({
      id: variant.id,
      modelId: variant.model_id,
      colorId: variant.color_id,
      size: Number(variant.size),
      lowStockThreshold: variant.low_stock_threshold,
      active: variant.active,
    })),
    balances,
    documents: rows.documents.map((document) =>
      mapDocument(document, linesByDocument.get(document.id) ?? []),
    ),
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

export function toInventoryRepositoryError(error: unknown): Error {
  const { code, message } = errorFields(error);
  if (code === "P0001" && message.includes("INSUFFICIENT_STOCK")) {
    return new Error("สต็อกไม่เพียงพอสำหรับรายการนี้");
  }
  if (message.includes("VARIANT_NOT_FOUND")) return new Error("ไม่พบสินค้าที่เลือก");
  if (message.includes("INVALID_DOCUMENT")) return new Error("กรุณาตรวจสอบข้อมูลเอกสารให้ถูกต้อง");
  return new Error("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
}

function throwFor(error: PostgrestError | null): void {
  if (error) throw toInventoryRepositoryError(error);
}

function validatedName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("กรุณาระบุชื่อให้ครบถ้วน");
  return trimmed;
}

function catalogError(error: PostgrestError, label: "รุ่น" | "สี"): Error {
  if (error.code === "23505") return new Error(`มีชื่อ${label}นี้ซ้ำอยู่แล้ว`);
  return toInventoryRepositoryError(error);
}

function documentCommand(input: StockDocumentInput): Json {
  return {
    type: input.type,
    effectiveDate: input.effectiveDate,
    ...(input.reference !== undefined ? { reference: input.reference } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
    lines: input.lines.map((line) => ({
      variantId: line.variantId,
      size: line.size,
      quantity: line.quantity,
      ...(line.direction ? { direction: line.direction } : {}),
      ...(line.section ? { section: line.section } : {}),
      ...(line.note !== undefined ? { note: line.note } : {}),
    })),
  };
}

export class SupabaseInventoryRepository implements InventoryRepository {
  private readonly client: InventorySupabaseClient;
  private readonly pendingPosts = new Map<string, PendingPost>();

  constructor(
    url: string,
    anonymousKey: string,
    client?: InventorySupabaseClient,
    private readonly createRequestId: () => string = () => globalThis.crypto.randomUUID(),
  ) {
    this.client = client ?? createInventorySupabaseClient(url, anonymousKey);
  }

  async load(): Promise<InventorySnapshot> {
    const result = await this.client.rpc("get_inventory_snapshot");
    throwFor(result.error);
    return mapInventorySnapshot(snapshotRows(result.data));
  }

  async postDocument(input: StockDocumentInput): Promise<StockDocument> {
    const baseCommand = documentCommand(input);
    const fingerprint = JSON.stringify(baseCommand);
    let pending = this.pendingPosts.get(fingerprint);
    if (pending?.inFlight) return pending.inFlight;
    if (!pending) {
      pending = { requestId: this.createRequestId() };
      this.pendingPosts.set(fingerprint, pending);
    }

    const command = isRecord(baseCommand)
      ? { ...baseCommand, requestId: pending.requestId }
      : baseCommand;
    const attempt = this.postCommand(command);
    pending.inFlight = attempt;

    try {
      const document = await attempt;
      this.pendingPosts.delete(fingerprint);
      return document;
    } catch (error) {
      pending.inFlight = undefined;
      throw error;
    }
  }

  private async postCommand(command: Json): Promise<StockDocument> {
    const result = await this.client.rpc("post_stock_document", { command });
    throwFor(result.error);
    return postedDocument(result.data);
  }

  async saveLowStockThreshold(variantId: string, threshold: number): Promise<void> {
    if (!Number.isInteger(threshold) || threshold < 0) {
      throw new Error("เกณฑ์สต็อกต่ำต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
    }
    const result = await this.client.from("product_variants")
      .update({ low_stock_threshold: threshold })
      .eq("id", variantId)
      .select("id")
      .single();
    if (result.error?.code === "PGRST116") throw new Error("ไม่พบสินค้าที่เลือก");
    throwFor(result.error);
  }

  async addModel(name: string): Promise<ShoeModel> {
    const result = await this.client.from("shoe_models")
      .insert({ name: validatedName(name) })
      .select("id,name,active")
      .single();
    if (result.error) throw catalogError(result.error, "รุ่น");
    if (!result.data) throw toInventoryRepositoryError(new Error("MODEL_NOT_RETURNED"));
    return result.data;
  }

  async renameModel(id: string, name: string): Promise<void> {
    await this.renameCatalog("shoe_models", id, name, "รุ่น");
  }

  async setModelActive(id: string, active: boolean): Promise<void> {
    await this.setCatalogActive("shoe_models", id, active, "รุ่น");
  }

  async addColor(name: string): Promise<Color> {
    const result = await this.client.from("colors")
      .insert({ name: validatedName(name) })
      .select("id,name,active")
      .single();
    if (result.error) throw catalogError(result.error, "สี");
    if (!result.data) throw toInventoryRepositoryError(new Error("COLOR_NOT_RETURNED"));
    return result.data;
  }

  async renameColor(id: string, name: string): Promise<void> {
    await this.renameCatalog("colors", id, name, "สี");
  }

  async setColorActive(id: string, active: boolean): Promise<void> {
    await this.setCatalogActive("colors", id, active, "สี");
  }

  private async renameCatalog(
    table: "shoe_models" | "colors",
    id: string,
    name: string,
    label: "รุ่น" | "สี",
  ): Promise<void> {
    const result = await this.client.from(table)
      .update({ name: validatedName(name) })
      .eq("id", id)
      .select("id")
      .single();
    if (result.error?.code === "PGRST116") throw new Error(`ไม่พบ${label}ที่เลือก`);
    if (result.error) throw catalogError(result.error, label);
  }

  private async setCatalogActive(
    table: "shoe_models" | "colors",
    id: string,
    active: boolean,
    label: "รุ่น" | "สี",
  ): Promise<void> {
    const result = await this.client.from(table)
      .update({ active })
      .eq("id", id)
      .select("id")
      .single();
    if (result.error?.code === "PGRST116") throw new Error(`ไม่พบ${label}ที่เลือก`);
    throwFor(result.error);
  }
}
