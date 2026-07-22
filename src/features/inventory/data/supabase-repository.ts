import type { PostgrestError } from "@supabase/supabase-js";
import { createInventorySupabaseClient, type InventorySupabaseClient, type Json } from "@/lib/supabase";
import type {
  Color,
  InventorySnapshot,
  MovementType,
  ProductVariant,
  ShoeModel,
  StockDocument,
  StockDocumentInput,
  StockDocumentLine,
} from "@/features/inventory/domain/types";
import type { InventoryRepository } from "./inventory-repository";

export const PENDING_POSTS_STORAGE_KEY = "sole-stock.supabase.pending-posts.v1";

export interface PendingPostsLockManager {
  request<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
}

function browserPendingPostsLockManager(): PendingPostsLockManager | undefined {
  if (typeof navigator === "undefined" || !navigator.locks) return undefined;
  return {
    request: (name, callback) => navigator.locks.request(name, () => callback()),
  };
}

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
  client_request_id: string;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isMovementType(value: unknown): value is MovementType {
  return value === "RECEIPT"
    || value === "SALE"
    || value === "DAMAGE"
    || value === "ADJUSTMENT"
    || value === "EXCHANGE";
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function hasUniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function invalidSnapshot(): never {
  throw toInventoryRepositoryError(new Error("INVALID_SNAPSHOT_RESPONSE"));
}

function snapshotRows(payload: unknown): InventoryDatabaseRows {
  if (!isRecord(payload)
    || !Array.isArray(payload.models)
    || !Array.isArray(payload.colors)
    || !Array.isArray(payload.variants)
    || !Array.isArray(payload.balances)
    || !Array.isArray(payload.documents)
    || !Array.isArray(payload.lines)) {
    return invalidSnapshot();
  }

  if (!payload.models.every((value): value is ModelRow => isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && typeof value.active === "boolean")
    || !payload.colors.every((value): value is ColorRow => isRecord(value)
      && isNonEmptyString(value.id)
      && isNonEmptyString(value.name)
      && typeof value.active === "boolean")) {
    return invalidSnapshot();
  }

  const modelIds = new Set(payload.models.map((model) => model.id));
  const colorIds = new Set(payload.colors.map((color) => color.id));
  if (!hasUniqueValues([...modelIds]) || modelIds.size !== payload.models.length
    || !hasUniqueValues([...colorIds]) || colorIds.size !== payload.colors.length
    || !payload.variants.every((value): value is VariantRow => {
      if (!isRecord(value)
        || !isNonEmptyString(value.id)
        || !isNonEmptyString(value.model_id)
        || !modelIds.has(value.model_id)
        || !isNonEmptyString(value.color_id)
        || !colorIds.has(value.color_id)
        || (typeof value.size !== "string" && typeof value.size !== "number")
        || (typeof value.size === "string" && value.size.trim() === "")
        || !Number.isFinite(Number(value.size))
        || Number(value.size) <= 0
        || typeof value.low_stock_threshold !== "number"
        || !Number.isInteger(value.low_stock_threshold)
        || value.low_stock_threshold < 0
        || typeof value.active !== "boolean") {
        return false;
      }
      return true;
    })) {
    return invalidSnapshot();
  }

  const variantIds = new Set(payload.variants.map((variant) => variant.id));
  if (variantIds.size !== payload.variants.length
    || payload.balances.length !== payload.variants.length
    || !payload.balances.every((value): value is BalanceRow => isRecord(value)
      && isNonEmptyString(value.variant_id)
      && variantIds.has(value.variant_id)
      && typeof value.quantity === "number"
      && Number.isInteger(value.quantity)
      && value.quantity >= 0)
    || new Set(payload.balances.map((balance) => balance.variant_id)).size !== payload.balances.length
    || !payload.documents.every((value): value is DocumentRow => isRecord(value)
      && isNonEmptyString(value.id)
      && isNonEmptyString(value.client_request_id)
      && isNonEmptyString(value.document_number)
      && isMovementType(value.movement_type)
      && isIsoDate(value.effective_date)
      && typeof value.reference === "string"
      && typeof value.note === "string"
      && isNonEmptyString(value.created_at)
      && Number.isFinite(Date.parse(value.created_at)))) {
    return invalidSnapshot();
  }

  const documentIds = new Set(payload.documents.map((document) => document.id));
  if (documentIds.size !== payload.documents.length
    || new Set(payload.documents.map((document) => document.document_number)).size !== payload.documents.length
    || !payload.lines.every((value): value is LineRow => isRecord(value)
      && isNonEmptyString(value.id)
      && isNonEmptyString(value.document_id)
      && documentIds.has(value.document_id)
      && isNonEmptyString(value.variant_id)
      && variantIds.has(value.variant_id)
      && typeof value.delta === "number"
      && Number.isInteger(value.delta)
      && value.delta !== 0
      && (value.exchange_section === null || value.exchange_section === "RETURNED" || value.exchange_section === "REPLACEMENT")
      && (value.note === null || typeof value.note === "string"))
    || new Set(payload.lines.map((line) => line.id)).size !== payload.lines.length) {
    return invalidSnapshot();
  }

  const documents = payload.documents;
  const lines = payload.lines;
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const documentIdsWithLines = new Set(lines.map((line) => line.document_id));
  if (documents.some((document) => !documentIdsWithLines.has(document.id))
    || documents.some((document) => {
      if (document.movement_type !== "EXCHANGE") return false;
      const sections = new Set(lines
        .filter((line) => line.document_id === document.id)
        .map((line) => line.exchange_section));
      return !sections.has("RETURNED") || !sections.has("REPLACEMENT");
    })
    || lines.some((line) => {
      const document = documentsById.get(line.document_id)!;
      if (document.movement_type === "EXCHANGE") {
        return line.exchange_section === null
          || (line.exchange_section === "RETURNED" ? line.delta <= 0 : line.delta >= 0);
      }
      if (line.exchange_section !== null) return true;
      return (document.movement_type === "RECEIPT" && line.delta < 0)
        || ((document.movement_type === "SALE" || document.movement_type === "DAMAGE") && line.delta > 0);
    })) {
    return invalidSnapshot();
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

function ensuredVariant(payload: unknown): ProductVariant {
  if (!isRecord(payload)
    || !isNonEmptyString(payload.id)
    || !isNonEmptyString(payload.modelId)
    || !isNonEmptyString(payload.colorId)
    || typeof payload.size !== "number"
    || !Number.isFinite(payload.size)
    || payload.size <= 0
    || Math.round(payload.size * 10) !== payload.size * 10
    || typeof payload.lowStockThreshold !== "number"
    || !Number.isInteger(payload.lowStockThreshold)
    || payload.lowStockThreshold < 0
    || typeof payload.active !== "boolean") {
    throw toInventoryRepositoryError(new Error("INVALID_VARIANT_RESPONSE"));
  }
  return {
    id: payload.id,
    modelId: payload.modelId,
    colorId: payload.colorId,
    size: payload.size,
    lowStockThreshold: payload.lowStockThreshold,
    active: payload.active,
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
  private readonly pendingInitializations = new Map<string, Promise<PendingPost>>();
  private readonly pendingStorage: Storage | undefined;
  private readonly pendingPostsLockManager: PendingPostsLockManager | undefined;

  constructor(
    private readonly url: string,
    anonymousKey: string,
    client?: InventorySupabaseClient,
    private readonly createRequestId: () => string = () => globalThis.crypto.randomUUID(),
    pendingStorage?: Storage,
    pendingPostsLockManager?: PendingPostsLockManager,
  ) {
    this.client = client ?? createInventorySupabaseClient(url, anonymousKey);
    this.pendingStorage = pendingStorage
      ?? (typeof window === "undefined" ? undefined : window.localStorage);
    this.pendingPostsLockManager = pendingPostsLockManager ?? browserPendingPostsLockManager();
  }

  async load(): Promise<InventorySnapshot> {
    const result = await this.client.rpc("get_inventory_snapshot");
    throwFor(result.error);
    const rows = snapshotRows(result.data);
    await this.reconcileCommittedRequests(rows.documents.map((document) => document.client_request_id));
    return mapInventorySnapshot(rows);
  }

  async postDocument(input: StockDocumentInput): Promise<StockDocument> {
    const baseCommand = documentCommand(input);
    const fingerprint = JSON.stringify(baseCommand);
    let pending = this.pendingPosts.get(fingerprint);
    if (pending?.inFlight) return pending.inFlight;
    if (!pending) {
      const initialized = await this.initializePendingPost(fingerprint);
      pending = this.pendingPosts.get(fingerprint) ?? initialized;
      if (!this.pendingPosts.has(fingerprint)) this.pendingPosts.set(fingerprint, pending);
      if (pending.inFlight) return pending.inFlight;
    }

    const command = isRecord(baseCommand)
      ? { ...baseCommand, requestId: pending.requestId }
      : baseCommand;
    const attempt = this.postCommand(command);
    pending.inFlight = attempt;

    try {
      const document = await attempt;
      this.pendingPosts.delete(fingerprint);
      await this.withPendingPostsLock(() => this.clearPersistedRequestId(fingerprint));
      return document;
    } catch (error) {
      pending.inFlight = undefined;
      throw error;
    }
  }

  async clearStock(effectiveDate: string): Promise<StockDocument | null> {
    const result = await this.client.rpc("clear_inventory_stock", {
      command: { requestId: this.createRequestId(), effectiveDate },
    });
    throwFor(result.error);
    return result.data === null ? null : postedDocument(result.data);
  }

  private pendingEntryKey(fingerprint: string): string {
    return `${this.url}\u0000${fingerprint}`;
  }

  private pendingStorageKey(fingerprint: string): string {
    return `${PENDING_POSTS_STORAGE_KEY}:${encodeURIComponent(this.pendingEntryKey(fingerprint))}`;
  }

  private withPendingPostsLock<T>(callback: () => Promise<T> | T): Promise<T> {
    if (this.pendingPostsLockManager) {
      return this.pendingPostsLockManager.request(PENDING_POSTS_STORAGE_KEY, callback);
    }
    return Promise.resolve(callback());
  }

  private async initializePendingPost(fingerprint: string): Promise<PendingPost> {
    const activeInitialization = this.pendingInitializations.get(fingerprint);
    if (activeInitialization) return activeInitialization;

    const initialization = this.withPendingPostsLock(() => {
      const pending = {
        requestId: this.persistedRequestId(fingerprint) ?? this.createRequestId(),
      };
      this.persistRequestId(fingerprint, pending.requestId);
      return pending;
    });
    this.pendingInitializations.set(fingerprint, initialization);
    try {
      return await initialization;
    } finally {
      this.pendingInitializations.delete(fingerprint);
    }
  }

  private readPersistedRequests(): Record<string, string> {
    if (!this.pendingStorage) return {};
    try {
      const raw = this.pendingStorage.getItem(PENDING_POSTS_STORAGE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length > 0,
      ));
    } catch {
      return {};
    }
  }

  private persistedRequestId(fingerprint: string): string | undefined {
    if (!this.pendingStorage) return undefined;
    try {
      const direct = this.pendingStorage.getItem(this.pendingStorageKey(fingerprint));
      if (direct) return direct;

      // Migrate request IDs written by the former shared JSON registry while
      // already holding the cross-tab lock.
      const legacy = this.readPersistedRequests();
      const entryKey = this.pendingEntryKey(fingerprint);
      const requestId = legacy[entryKey];
      if (!requestId) return undefined;
      this.pendingStorage.setItem(this.pendingStorageKey(fingerprint), requestId);
      delete legacy[entryKey];
      this.writePersistedRequests(legacy);
      return requestId;
    } catch {
      return undefined;
    }
  }

  private persistRequestId(fingerprint: string, requestId: string): void {
    if (!this.pendingStorage) return;
    try {
      this.pendingStorage.setItem(this.pendingStorageKey(fingerprint), requestId);
    } catch {
      // The in-memory retry identity still protects retries in this repository instance.
    }
  }

  private clearPersistedRequestId(fingerprint: string): void {
    if (!this.pendingStorage) return;
    try {
      this.pendingStorage.removeItem(this.pendingStorageKey(fingerprint));
      const legacy = this.readPersistedRequests();
      delete legacy[this.pendingEntryKey(fingerprint)];
      this.writePersistedRequests(legacy);
    } catch {
      // A confirmed post remains successful even if browser cleanup is unavailable.
    }
  }

  private writePersistedRequests(pending: Record<string, string>): void {
    if (!this.pendingStorage) return;
    if (Object.keys(pending).length === 0) {
      this.pendingStorage.removeItem(PENDING_POSTS_STORAGE_KEY);
    } else {
      this.pendingStorage.setItem(PENDING_POSTS_STORAGE_KEY, JSON.stringify(pending));
    }
  }

  private async reconcileCommittedRequests(requestIds: string[]): Promise<void> {
    const committed = new Set(requestIds);
    for (const [fingerprint, pending] of this.pendingPosts) {
      if (committed.has(pending.requestId)) this.pendingPosts.delete(fingerprint);
    }
    if (!this.pendingStorage || committed.size === 0) return;
    try {
      await this.withPendingPostsLock(() => {
        const storageKeys = Array.from(
          { length: this.pendingStorage!.length },
          (_, index) => this.pendingStorage!.key(index),
        ).filter((key): key is string => !!key);
        const prefix = `${PENDING_POSTS_STORAGE_KEY}:`;
        for (const key of storageKeys) {
          if (!key.startsWith(prefix)) continue;
          let entryKey: string;
          try {
            entryKey = decodeURIComponent(key.slice(prefix.length));
          } catch {
            continue;
          }
          const requestId = this.pendingStorage!.getItem(key);
          if (entryKey.startsWith(`${this.url}\u0000`) && requestId && committed.has(requestId)) {
            this.pendingStorage!.removeItem(key);
          }
        }

        const legacy = this.readPersistedRequests();
        for (const [key, requestId] of Object.entries(legacy)) {
          if (key.startsWith(`${this.url}\u0000`) && committed.has(requestId)) delete legacy[key];
        }
        this.writePersistedRequests(legacy);
      });
    } catch {
      // Snapshot loading remains useful even if local retry cleanup is unavailable.
    }
  }

  private async postCommand(command: Json): Promise<StockDocument> {
    const result = await this.client.rpc("post_stock_document", { command });
    throwFor(result.error);
    return postedDocument(result.data);
  }

  async ensureVariant(modelId: string, colorId: string, size: number): Promise<ProductVariant> {
    if (!Number.isFinite(size) || size <= 0 || Math.round(size * 10) !== size * 10) {
      throw new Error("ไซซ์รองเท้าต้องเป็นเลขทศนิยมบวกไม่เกิน 1 ตำแหน่ง");
    }
    const result = await this.client.rpc("ensure_product_variant", {
      p_model_id: modelId,
      p_color_id: colorId,
      p_size: size,
    });
    throwFor(result.error);
    return ensuredVariant(result.data);
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
