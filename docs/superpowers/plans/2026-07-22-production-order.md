# Printable Production Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted production orders that can be edited, cancelled, printed as A4 portrait documents, and manually received into stock exactly once.

**Architecture:** Keep production orders in their own domain, repository, provider, tables, and routes because an open order is not an inventory movement. Supabase mutations use narrow `security definer` RPCs; receiving locks the order, delegates the receipt to the existing `post_stock_document` RPC, and links the resulting ledger document in one transaction. Demo mode stores orders separately but delegates receipt to the existing demo inventory repository and refreshes the inventory provider afterward.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Zod 4, Supabase/PostgreSQL, SweetAlert2, Vitest, Testing Library, Playwright, CSS print media.

## Global Constraints

- Production orders remain separate from `MovementType`; saving and printing never change inventory.
- Statuses are exactly `OPEN`, `RECEIVED`, and `CANCELLED`; only `OPEN` may be edited, cancelled, or received.
- Receipt is manual, complete, and one-time. Do not implement partial receipt.
- Lines are manually selected from existing active variants; do not create variants or suggest replenishment quantities.
- Persist model, color, and size snapshots on every line for stable historical printing.
- Print through `window.print()` using A4 portrait option B: one row per model/color/size line.
- Keep the app open to `anon` and `authenticated` without roles or login.
- All visible copy and recoverable errors are Thai; internal enum/RPC names stay English.
- Preserve the existing uncommitted `next-env.d.ts` change and never stage it.
- Supabase CLI is currently unlinked. Do not claim production deployment until migrations `202607220003` and `202607220004` exist remotely.

---

### Task 1: Define production-order domain types, validation, and selectors

**Files:**
- Create: `src/features/production-orders/domain/types.ts`
- Create: `src/features/production-orders/domain/validation.ts`
- Create: `src/features/production-orders/domain/selectors.ts`
- Create: `tests/unit/production-order-domain.test.ts`

**Interfaces:**
- Produces: `ProductionOrder`, `ProductionOrderInput`, `ProductionOrderLine`, `ProductionOrderStatus`, `ProductionOrderReceiptResult`.
- Produces: `validateProductionOrder(input): ProductionOrderValidationResult`.
- Produces: `summarizeProductionOrder(order)` and `filterProductionOrders(orders, filters)`.

- [ ] **Step 1: Write failing domain tests**

Create `tests/unit/production-order-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterProductionOrders, summarizeProductionOrder } from "@/features/production-orders/domain/selectors";
import type { ProductionOrder, ProductionOrderInput } from "@/features/production-orders/domain/types";
import { validateProductionOrder } from "@/features/production-orders/domain/validation";

const validInput: ProductionOrderInput = {
  orderDate: "2026-07-22",
  expectedDate: "2026-08-05",
  note: "รอบต้นเดือน",
  lines: [
    { variantId: "variant-1", quantity: 4 },
    { variantId: "variant-2", quantity: 6 },
  ],
};

const order: ProductionOrder = {
  id: "order-1",
  number: "PO-20260722-000001",
  orderDate: "2026-07-22",
  expectedDate: "2026-08-05",
  note: "รอบต้นเดือน",
  status: "OPEN",
  receivedDocumentId: null,
  createdAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
  receivedAt: null,
  cancelledAt: null,
  lines: [
    { id: "line-1", variantId: "variant-1", lineNumber: 1, modelName: "Paris", colorName: "Black", size: 38, quantity: 4 },
    { id: "line-2", variantId: "variant-2", lineNumber: 2, modelName: "Paris", colorName: "Black", size: 38.5, quantity: 6 },
  ],
};

describe("production-order domain", () => {
  it("accepts a complete order and normalizes its note", () => {
    expect(validateProductionOrder({ ...validInput, note: "  รอบต้นเดือน  " })).toEqual({
      success: true,
      data: validInput,
    });
  });

  it.each([
    ["expected date", { ...validInput, expectedDate: "2026-07-21" }, "expectedDate"],
    ["empty lines", { ...validInput, lines: [] }, "lines"],
    ["quantity", { ...validInput, lines: [{ variantId: "variant-1", quantity: 1.5 }] }, "lines.0.quantity"],
    ["duplicate variant", { ...validInput, lines: [...validInput.lines, { variantId: "variant-1", quantity: 2 }] }, "lines.2.variantId"],
  ])("rejects invalid %s", (_label, input, path) => {
    const result = validateProductionOrder(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
  });

  it("summarizes and searches snapshotted order lines", () => {
    expect(summarizeProductionOrder(order)).toEqual({ lineCount: 2, totalPairs: 10 });
    expect(filterProductionOrders([order], { query: "paris black", status: "ALL" })).toEqual([order]);
    expect(filterProductionOrders([order], { query: "", status: "RECEIVED" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the domain test and verify RED**

```powershell
npm test -- tests/unit/production-order-domain.test.ts
```

Expected: FAIL because the production-order domain modules do not exist.

- [ ] **Step 3: Implement the domain contracts**

Create `src/features/production-orders/domain/types.ts`:

```ts
import type { StockDocument } from "@/features/inventory/domain/types";

export type ProductionOrderStatus = "OPEN" | "RECEIVED" | "CANCELLED";

export interface ProductionOrderLineInput {
  variantId: string;
  quantity: number;
}

export interface ProductionOrderInput {
  id?: string;
  orderDate: string;
  expectedDate: string;
  note: string;
  lines: ProductionOrderLineInput[];
}

export interface ProductionOrderLine extends ProductionOrderLineInput {
  id: string;
  lineNumber: number;
  modelName: string;
  colorName: string;
  size: number;
}

export interface ProductionOrder {
  id: string;
  number: string;
  orderDate: string;
  expectedDate: string;
  note: string;
  status: ProductionOrderStatus;
  receivedDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
  cancelledAt: string | null;
  lines: ProductionOrderLine[];
}

export interface ProductionOrderReceiptResult {
  order: ProductionOrder;
  document: StockDocument;
}

export interface ProductionOrderValidationError {
  path: string;
  code: "REQUIRED" | "INVALID_DATE_RANGE" | "INVALID_QUANTITY" | "DUPLICATE_VARIANT";
  message: string;
}
```

Create `src/features/production-orders/domain/validation.ts`:

```ts
import { z } from "zod";
import type { ProductionOrderInput, ProductionOrderValidationError } from "./types";

const schema = z.object({
  id: z.string().trim().min(1).optional(),
  orderDate: z.iso.date(),
  expectedDate: z.iso.date(),
  note: z.string(),
  lines: z.array(z.object({
    variantId: z.string().trim().min(1),
    quantity: z.number().finite().int().positive(),
  })).min(1),
});

export type ProductionOrderValidationResult =
  | { success: true; data: ProductionOrderInput }
  | { success: false; errors: ProductionOrderValidationError[] };

export class ProductionOrderValidationException extends Error {
  constructor(readonly errors: ProductionOrderValidationError[]) {
    super(errors[0]?.message ?? "กรุณาตรวจสอบข้อมูลใบผลิต");
    this.name = "ProductionOrderValidationException";
  }
}

function schemaError(path: string): ProductionOrderValidationError {
  if (path.endsWith(".quantity")) {
    return { path, code: "INVALID_QUANTITY", message: "จำนวนต้องเป็นจำนวนเต็มมากกว่า 0" };
  }
  return { path, code: "REQUIRED", message: "กรุณากรอกข้อมูลให้ครบถ้วน" };
}

export function validateProductionOrder(input: ProductionOrderInput): ProductionOrderValidationResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => schemaError(issue.path.map(String).join("."))),
    };
  }

  const normalized: ProductionOrderInput = { ...parsed.data, note: parsed.data.note.trim() };
  const errors: ProductionOrderValidationError[] = [];

  if (normalized.expectedDate < normalized.orderDate) {
    errors.push({ path: "expectedDate", code: "INVALID_DATE_RANGE", message: "วันที่กำหนดรับต้องไม่ก่อนวันที่สั่งผลิต" });
  }

  const seen = new Set<string>();
  normalized.lines.forEach((line, index) => {
    const variantId = line.variantId;
    if (seen.has(variantId)) {
      errors.push({ path: `lines.${index}.variantId`, code: "DUPLICATE_VARIANT", message: "ไม่สามารถเลือกรุ่น สี และไซซ์ซ้ำในใบเดียวกันได้" });
    }
    seen.add(variantId);
  });

  if (errors.length) return { success: false, errors };
  return { success: true, data: normalized };
}
```

Create `src/features/production-orders/domain/selectors.ts`:

```ts
import type { ProductionOrder, ProductionOrderStatus } from "./types";

export interface ProductionOrderFilters {
  query: string;
  status: ProductionOrderStatus | "ALL";
}

export function summarizeProductionOrder(order: ProductionOrder) {
  return {
    lineCount: order.lines.length,
    totalPairs: order.lines.reduce((total, line) => total + line.quantity, 0),
  };
}

export function filterProductionOrders(orders: ProductionOrder[], filters: ProductionOrderFilters) {
  const query = filters.query.trim().toLocaleLowerCase("th-TH");
  return orders.filter((order) => {
    if (filters.status !== "ALL" && order.status !== filters.status) return false;
    if (!query) return true;
    const search = [order.number, order.note, ...order.lines.flatMap((line) => [line.modelName, line.colorName, String(line.size)])]
      .join(" ").toLocaleLowerCase("th-TH");
    return query.split(/\s+/).every((term) => search.includes(term));
  });
}
```

- [ ] **Step 4: Run domain tests and typecheck**

```powershell
npm test -- tests/unit/production-order-domain.test.ts
npm run typecheck
```

Expected: domain tests and TypeScript pass.

- [ ] **Step 5: Commit the domain**

```powershell
git add src/features/production-orders/domain tests/unit/production-order-domain.test.ts
git diff --cached --check
git commit -m "feat: add production order domain"
```

---

### Task 2: Add the repository contract and demo persistence

**Files:**
- Create: `src/features/production-orders/data/production-order-repository.ts`
- Create: `src/features/production-orders/data/demo-production-order-repository.ts`
- Create: `tests/unit/demo-production-order-repository.test.ts`

**Interfaces:**
- Consumes: production-order types from Task 1 and `InventoryRepository.postDocument`.
- Produces: `ProductionOrderRepository.load/save/cancel/receive/subscribe`.

- [ ] **Step 1: Write failing demo repository tests**

Create a memory `Storage`, deterministic IDs, and these assertions in `tests/unit/demo-production-order-repository.test.ts`:

```ts
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function deterministicIds() {
  let current = 0;
  return () => `00000000-0000-4000-8000-${String(++current).padStart(12, "0")}`;
}

async function fixtureWithOpenOrder() {
  const storage = new MemoryStorage();
  const inventory = new DemoInventoryRepository(storage, { createId: deterministicIds() });
  const repository = new DemoProductionOrderRepository(storage, inventory, {
    createId: deterministicIds(),
    now: () => "2026-07-22T10:00:00.000Z",
  });
  const snapshot = await inventory.load();
  const order = await repository.save({
    orderDate: "2026-07-22",
    expectedDate: "2026-08-05",
    note: "",
    lines: snapshot.variants.slice(0, 2).map((variant, index) => ({
      variantId: variant.id,
      quantity: index + 4,
    })),
  });
  return { storage, inventory, repository, order };
}

it("creates, edits, cancels, and preserves snapshotted catalog names", async () => {
  const storage = new MemoryStorage();
  const inventory = new DemoInventoryRepository(storage);
  const snapshot = await inventory.load();
  const first = snapshot.variants[0];
  const second = snapshot.variants[1];
  const repository = new DemoProductionOrderRepository(storage, inventory, { createId: deterministicIds() });

  const created = await repository.save({
    orderDate: "2026-07-22", expectedDate: "2026-08-05", note: "รอบแรก",
    lines: [{ variantId: first.id, quantity: 4 }],
  });
  expect(created).toMatchObject({ number: "PO-20260722-000001", status: "OPEN" });
  expect(created.lines[0]).toMatchObject({ modelName: "Paris", colorName: "Black", size: 38, quantity: 4 });

  const edited = await repository.save({
    id: created.id, orderDate: created.orderDate, expectedDate: "2026-08-08", note: "แก้แล้ว",
    lines: [{ variantId: second.id, quantity: 6 }],
  });
  expect(edited).toMatchObject({ id: created.id, number: created.number, expectedDate: "2026-08-08" });
  await expect(repository.cancel(created.id)).resolves.toMatchObject({ status: "CANCELLED" });
  await expect(repository.save({ ...edited, id: created.id })).rejects.toThrow("แก้ไขได้เฉพาะใบผลิตที่รอรับเข้า");
});
```

Add a receipt test:

```ts
it("receives every line once and returns the same linked document on retry", async () => {
  const { repository, inventory, order } = await fixtureWithOpenOrder();
  const before = await inventory.load();
  const result = await repository.receive(order.id, "2026-07-22");
  const after = await inventory.load();

  expect(result.order).toMatchObject({ status: "RECEIVED", receivedDocumentId: result.document.id });
  expect(result.document).toMatchObject({ type: "RECEIPT", reference: order.number });
  for (const line of order.lines) {
    expect(after.balances[line.variantId] - before.balances[line.variantId]).toBe(line.quantity);
  }
  await expect(repository.receive(order.id, "2026-07-22")).resolves.toEqual(result);
  expect((await inventory.load()).documents).toHaveLength(after.documents.length);
});
```

- [ ] **Step 2: Run demo repository tests to verify RED**

```powershell
npm test -- tests/unit/demo-production-order-repository.test.ts
```

Expected: FAIL because repository modules do not exist.

- [ ] **Step 3: Define the repository contract**

Create `src/features/production-orders/data/production-order-repository.ts`:

```ts
import type { ProductionOrder, ProductionOrderInput, ProductionOrderReceiptResult } from "../domain/types";

export interface ProductionOrderRepository {
  load(): Promise<ProductionOrder[]>;
  subscribe?(listener: () => void): () => void;
  save(input: ProductionOrderInput): Promise<ProductionOrder>;
  cancel(orderId: string): Promise<ProductionOrder>;
  receive(orderId: string, effectiveDate: string): Promise<ProductionOrderReceiptResult>;
}
```

- [ ] **Step 4: Implement the demo repository**

Create `src/features/production-orders/data/demo-production-order-repository.ts` with:

```ts
export const PRODUCTION_ORDER_STORAGE_KEY = "sole-stock.production-orders.v1";
const PRODUCTION_ORDER_LOCK = "sole-stock.production-orders.mutation.v1";

function browserLockManager(): InventoryLockManager | undefined {
  if (typeof navigator === "undefined" || !navigator.locks) return undefined;
  return { request: (name, callback) => navigator.locks.request(name, () => callback()) };
}

interface DemoState {
  version: 1;
  revision: number;
  orders: ProductionOrder[];
  receipts: Record<string, StockDocument>;
}

export class DemoProductionOrderRepository implements ProductionOrderRepository {
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly lockManager: InventoryLockManager | undefined;

  constructor(
    private readonly storage: Storage,
    private readonly inventory: InventoryRepository,
    private readonly options: { createId?: () => string; now?: () => string; lockManager?: InventoryLockManager } = {},
  ) {
    this.createId = options.createId ?? (() => globalThis.crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
    this.lockManager = options.lockManager ?? browserLockManager();
  }

  async load() { return structuredClone(this.current().orders); }

  async save(input: ProductionOrderInput) {
    const validated = validateProductionOrder(input);
    if (!validated.success) throw new ProductionOrderValidationException(validated.errors);
    return this.mutate(async (state) => {
      const catalog = await this.inventory.load();
      const existing = input.id ? state.orders.find((order) => order.id === input.id) : undefined;
      if (input.id && (!existing || existing.status !== "OPEN")) throw new Error("แก้ไขได้เฉพาะใบผลิตที่รอรับเข้า");
      const lines = validated.data.lines.map((line, index) => snapshotLine(catalog, line, index + 1, this.createId()));
      const now = this.now();
      const order: ProductionOrder = existing ? {
        ...existing, ...validated.data, updatedAt: now, lines,
      } : {
        id: this.createId(), number: nextNumber(state, validated.data.orderDate),
        ...validated.data, status: "OPEN", receivedDocumentId: null,
        createdAt: now, updatedAt: now, receivedAt: null, cancelledAt: null, lines,
      };
      return { state: { ...state, orders: existing ? state.orders.map((item) => item.id === order.id ? order : item) : [...state.orders, order] }, result: order };
    });
  }

  async cancel(orderId: string) {
    return this.mutate(async (state) => {
      const order = requiredOrder(state, orderId);
      if (order.status === "RECEIVED") throw new Error("ใบผลิตนี้รับเข้าสต๊อกแล้ว");
      if (order.status === "CANCELLED") return { state, result: order };
      const cancelled = { ...order, status: "CANCELLED" as const, cancelledAt: this.now(), updatedAt: this.now() };
      return { state: replaceOrder(state, cancelled), result: cancelled };
    });
  }

  async receive(orderId: string, effectiveDate: string) {
    return this.mutate(async (state) => {
      const order = requiredOrder(state, orderId);
      if (order.status === "CANCELLED") throw new Error("ไม่สามารถรับใบผลิตที่ยกเลิกแล้ว");
      if (order.status === "RECEIVED") return { state, result: receiptResult(state, order) };
      const document = await this.inventory.postDocument({
        type: "RECEIPT", effectiveDate, reference: order.number,
        note: `รับเข้าจากใบผลิต ${order.number}`,
        lines: order.lines.map((line) => ({ variantId: line.variantId, size: line.size, quantity: line.quantity })),
      });
      const received = { ...order, status: "RECEIVED" as const, receivedDocumentId: document.id, receivedAt: this.now(), updatedAt: this.now() };
      return { state: storeReceipt(replaceOrder(state, received), document), result: { order: received, document } };
    });
  }

  subscribe(listener: () => void) {
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
      return isDemoState(parsed) ? structuredClone(parsed) : emptyState();
    } catch {
      return emptyState();
    }
  }

  private async mutate<T>(project: (state: DemoState) => Promise<{ state: DemoState; result: T }>) {
    const operation = async () => {
      const current = this.current();
      const projected = await project(current);
      const latestRevision = this.current().revision;
      if (latestRevision !== current.revision) throw new Error("ข้อมูลใบผลิตมีการเปลี่ยนแปลง กรุณาลองอีกครั้ง");
      const next = { ...projected.state, revision: current.revision + 1 };
      this.storage.setItem(PRODUCTION_ORDER_STORAGE_KEY, JSON.stringify(next));
      return structuredClone(projected.result);
    };
    return this.lockManager ? this.lockManager.request(PRODUCTION_ORDER_LOCK, operation) : operation();
  }
}
```

Define every helper used above in the same file:

```ts
function emptyState(): DemoState {
  return { version: 1, revision: 0, orders: [], receipts: {} };
}

function isDemoState(value: unknown): value is DemoState {
  if (!value || typeof value !== "object") return false;
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

function nextNumber(state: DemoState, orderDate: string) {
  return `PO-${orderDate.replaceAll("-", "")}-${String(state.orders.length + 1).padStart(6, "0")}`;
}

function requiredOrder(state: DemoState, orderId: string) {
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) throw new Error("ไม่พบใบผลิตที่เลือก");
  return order;
}

function replaceOrder(state: DemoState, order: ProductionOrder): DemoState {
  return { ...state, orders: state.orders.map((candidate) => candidate.id === order.id ? order : candidate) };
}

function storeReceipt(state: DemoState, document: StockDocument): DemoState {
  return { ...state, receipts: { ...state.receipts, [document.id]: document } };
}

function receiptResult(state: DemoState, order: ProductionOrder): ProductionOrderReceiptResult {
  const document = order.receivedDocumentId ? state.receipts[order.receivedDocumentId] : undefined;
  if (!document) throw new Error("ไม่พบเอกสารรับเข้าของใบผลิต");
  return { order, document };
}

function snapshotLine(snapshot: InventorySnapshot, input: ProductionOrderLineInput, lineNumber: number, id: string): ProductionOrderLine {
  const variant = snapshot.variants.find((candidate) => candidate.id === input.variantId && candidate.active);
  const model = variant && snapshot.models.find((candidate) => candidate.id === variant.modelId && candidate.active);
  const color = variant && snapshot.colors.find((candidate) => candidate.id === variant.colorId && candidate.active);
  if (!variant || !model || !color) throw new Error("ไม่พบสินค้าที่เปิดใช้งาน");
  return { id, variantId: variant.id, lineNumber, modelName: model.name, colorName: color.name, size: variant.size, quantity: input.quantity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isProductionOrderLineRecord(value: unknown): value is ProductionOrderLine {
  return isRecord(value)
    && typeof value.id === "string" && value.id.length > 0
    && typeof value.variantId === "string" && value.variantId.length > 0
    && Number.isInteger(value.lineNumber) && (value.lineNumber as number) > 0
    && typeof value.modelName === "string" && value.modelName.length > 0
    && typeof value.colorName === "string" && value.colorName.length > 0
    && typeof value.size === "number" && Number.isFinite(value.size) && value.size > 0
    && Number.isInteger(value.quantity) && (value.quantity as number) > 0;
}

function isProductionOrderRecord(value: unknown): value is ProductionOrder {
  if (!isRecord(value)
    || typeof value.id !== "string" || !value.id
    || typeof value.number !== "string" || !value.number
    || typeof value.orderDate !== "string" || typeof value.expectedDate !== "string"
    || typeof value.note !== "string"
    || !["OPEN", "RECEIVED", "CANCELLED"].includes(String(value.status))
    || (value.receivedDocumentId !== null && typeof value.receivedDocumentId !== "string")
    || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string"
    || (value.receivedAt !== null && typeof value.receivedAt !== "string")
    || (value.cancelledAt !== null && typeof value.cancelledAt !== "string")
    || value.expectedDate < value.orderDate
    || !Array.isArray(value.lines) || !value.lines.every(isProductionOrderLineRecord)) return false;
  const lines = value.lines as ProductionOrderLine[];
  return new Set(lines.map((line) => line.id)).size === lines.length
    && new Set(lines.map((line) => line.variantId)).size === lines.length;
}

function isStockDocumentRecord(value: unknown): value is StockDocument {
  return isRecord(value)
    && typeof value.id === "string" && value.id.length > 0
    && typeof value.number === "string" && value.number.length > 0
    && typeof value.type === "string"
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
```

Invalid JSON falls back to `emptyState()` without overwriting the stored value until a successful mutation.

- [ ] **Step 5: Run tests and typecheck**

```powershell
npm test -- tests/unit/demo-production-order-repository.test.ts
npm run typecheck
```

Expected: demo repository tests and TypeScript pass.

- [ ] **Step 6: Commit demo persistence**

```powershell
git add src/features/production-orders/data tests/unit/demo-production-order-repository.test.ts
git diff --cached --check
git commit -m "feat: persist demo production orders"
```

---

### Task 3: Add production-order tables and save/query/cancel RPCs

**Files:**
- Create: `supabase/migrations/202607220004_production_orders.sql`
- Modify: `tests/unit/supabase-migration.test.ts`

**Interfaces:**
- Consumes: existing catalog UUIDs and `stock_documents` table.
- Produces: internal `production_order_json(uuid)` plus public `get_production_orders()`, `save_production_order(jsonb)`, and `cancel_production_order(jsonb)` RPCs.

- [ ] **Step 1: Add failing migration contract assertions**

Read `202607220004_production_orders.sql` and assert:

```ts
expect(productionMigration).toContain("create table public.production_orders");
expect(productionMigration).toContain("create table public.production_order_lines");
expect(productionMigration).toContain("check (status in ('open', 'received', 'cancelled'))");
expect(productionMigration).toContain("unique (order_id, variant_id)");
expect(productionMigration).toContain("create or replace function public.production_order_json(target_order_id uuid)");
expect(productionMigration).toContain("create or replace function public.get_production_orders()");
expect(productionMigration).toContain("create or replace function public.save_production_order(command jsonb)");
expect(productionMigration).toContain("create or replace function public.cancel_production_order(command jsonb)");
expect(productionMigration).toContain("for update of production_order");
expect(productionMigration).toContain("join public.shoe_models model");
expect(productionMigration).toContain("join public.colors color");
expect(productionMigration).not.toMatch(/grant\s+(?:insert|update|delete)\s+on\s+public\.production_/);
```

- [ ] **Step 2: Run migration test and verify RED**

```powershell
npm test -- tests/unit/supabase-migration.test.ts
```

Expected: FAIL with `ENOENT` for migration `202607220004_production_orders.sql`.

- [ ] **Step 3: Create schema and read function**

The migration must create:

```sql
create sequence public.production_order_number_sequence;

create table public.production_orders (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  client_request_id uuid not null unique,
  order_number text not null unique,
  order_date date not null,
  expected_date date not null,
  note text not null default '',
  status text not null default 'OPEN' check (status in ('OPEN', 'RECEIVED', 'CANCELLED')),
  received_document_id uuid unique references public.stock_documents(id),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  received_at timestamptz,
  cancelled_at timestamptz,
  check (expected_date >= order_date),
  check ((status = 'RECEIVED') = (received_document_id is not null)),
  check ((status = 'RECEIVED') = (received_at is not null)),
  check ((status = 'CANCELLED') = (cancelled_at is not null))
);

create table public.production_order_lines (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  order_id uuid not null references public.production_orders(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  variant_id uuid not null references public.product_variants(id),
  model_name text not null check (btrim(model_name) <> ''),
  color_name text not null check (btrim(color_name) <> ''),
  size numeric(5,1) not null check (size > 0),
  quantity integer not null check (quantity > 0),
  unique (order_id, line_number),
  unique (order_id, variant_id)
);
```

Create the canonical serializer before the public RPCs so every response has exactly one shape:

```sql
create or replace function public.production_order_json(target_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select pg_catalog.jsonb_build_object(
    'id', production_order.id,
    'number', production_order.order_number,
    'orderDate', production_order.order_date,
    'expectedDate', production_order.expected_date,
    'note', production_order.note,
    'status', production_order.status,
    'receivedDocumentId', production_order.received_document_id,
    'createdAt', production_order.created_at,
    'updatedAt', production_order.updated_at,
    'receivedAt', production_order.received_at,
    'cancelledAt', production_order.cancelled_at,
    'lines', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', line.id,
        'variantId', line.variant_id,
        'lineNumber', line.line_number,
        'modelName', line.model_name,
        'colorName', line.color_name,
        'size', line.size,
        'quantity', line.quantity
      ) order by line.line_number)
      from public.production_order_lines line
      where line.order_id = production_order.id
    ), '[]'::jsonb)
  )
  from public.production_orders production_order
  where production_order.id = target_order_id;
$$;
```

`get_production_orders()` returns `coalesce(jsonb_agg(public.production_order_json(id) order by created_at desc), '[]'::jsonb)`. It must be `stable`, `security definer`, and use `set search_path = pg_catalog, public`.

- [ ] **Step 4: Implement save and cancel functions**

`save_production_order(command jsonb)` must:

- Validate `requestId`, ISO dates, note, and non-empty line array.
- Take `pg_advisory_xact_lock(hashtextextended(request_id::text, 0))`.
- Return an existing order when `client_request_id = request_id`.
- On create, allocate `PO-YYYYMMDD-` plus a six-digit global sequence.
- On edit, lock the order row with `FOR UPDATE OF production_order`, require `OPEN`, update header, delete old lines, and insert the replacement lines in one transaction.
- Validate positive integer quantities and unique UUID variants.
- Join active `product_variants`, `shoe_models`, and `colors`; insert names and size from the database rather than command text.
- Return the order by selecting it from the same canonical JSON helper used by `get_production_orders()`.

`cancel_production_order(command jsonb)` must lock the order, return a cancelled order idempotently, reject received orders, and update `status`, `cancelled_at`, and `updated_at` together.

- [ ] **Step 5: Apply ownership and narrow grants**

```sql
alter table public.production_orders enable row level security;
alter table public.production_order_lines enable row level security;
revoke all on public.production_orders, public.production_order_lines from public, anon, authenticated;
revoke all on sequence public.production_order_number_sequence from public, anon, authenticated;

alter function public.get_production_orders() owner to postgres;
alter function public.production_order_json(uuid) owner to postgres;
alter function public.save_production_order(jsonb) owner to postgres;
alter function public.cancel_production_order(jsonb) owner to postgres;
revoke all on function public.production_order_json(uuid) from public, anon, authenticated;
revoke all on function public.get_production_orders() from public, anon, authenticated;
revoke all on function public.save_production_order(jsonb) from public, anon, authenticated;
revoke all on function public.cancel_production_order(jsonb) from public, anon, authenticated;
grant execute on function public.get_production_orders() to anon, authenticated;
grant execute on function public.save_production_order(jsonb) to anon, authenticated;
grant execute on function public.cancel_production_order(jsonb) to anon, authenticated;
```

- [ ] **Step 6: Run migration tests and commit**

```powershell
npm test -- tests/unit/supabase-migration.test.ts
git add supabase/migrations/202607220004_production_orders.sql tests/unit/supabase-migration.test.ts
git diff --cached --check
git commit -m "feat: add production order persistence RPCs"
```

Expected: migration contracts pass and direct table writes remain ungranted.

---

### Task 4: Add the atomic receive RPC

**Files:**
- Modify: `supabase/migrations/202607220004_production_orders.sql`
- Modify: `tests/unit/supabase-migration.test.ts`

**Interfaces:**
- Consumes: `public.post_stock_document(command jsonb)` and production-order tables from Task 3.
- Produces: `receive_production_order(command jsonb) returns jsonb`.

- [ ] **Step 1: Add failing atomic-receipt migration assertions**

```ts
expect(productionMigration).toContain("create or replace function public.receive_production_order(command jsonb)");
expect(productionMigration).toContain("pg_catalog.pg_advisory_xact_lock");
expect(productionMigration).toMatch(/from public\.production_orders production_order[\s\S]*?for update of production_order/);
expect(productionMigration).toContain("if locked_order.status = 'received'");
expect(productionMigration).toContain("where document.id = locked_order.received_document_id");
expect(productionMigration).toContain("'requestid', receipt_request_id");
expect(productionMigration).toContain("'type', 'receipt'");
expect(productionMigration).toContain("'reference', locked_order.order_number");
expect(productionMigration).toContain("posted_document := public.post_stock_document(receipt_command);");
expect(productionMigration).toMatch(/update public\.production_orders[\s\S]*?received_document_id[\s\S]*?status = 'received'/);
expect(productionMigration).toContain("grant execute on function public.receive_production_order(jsonb) to anon, authenticated;");
```

- [ ] **Step 2: Run migration test and verify RED**

Expected: FAIL because `receive_production_order` is absent.

- [ ] **Step 3: Implement the receipt function**

Add a complete `security definer` PL/pgSQL function that:

```sql
select production_order.* into locked_order
from public.production_orders production_order
where production_order.id = order_id
for update of production_order;

if locked_order.status = 'RECEIVED' then
  select document.client_request_id into receipt_request_id
  from public.stock_documents document
  where document.id = locked_order.received_document_id;
  posted_document := public.post_stock_document(
    pg_catalog.jsonb_build_object('requestId', receipt_request_id)
  );
  return pg_catalog.jsonb_build_object(
    'order', public.production_order_json(locked_order.id),
    'document', posted_document
  );
end if;

if locked_order.status = 'CANCELLED' then
  raise exception using errcode = 'P0001', message = 'PRODUCTION_ORDER_CANCELLED';
end if;

select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'variantId', line.variant_id,
  'size', line.size,
  'quantity', line.quantity
) order by line.line_number)
into receipt_lines
from public.production_order_lines line
where line.order_id = order_id;

receipt_command := pg_catalog.jsonb_build_object(
  'requestId', request_id,
  'type', 'RECEIPT',
  'effectiveDate', effective_on::text,
  'reference', locked_order.order_number,
  'note', 'รับเข้าจากใบผลิต ' || locked_order.order_number,
  'lines', receipt_lines
);
posted_document := public.post_stock_document(receipt_command);

update public.production_orders
set status = 'RECEIVED',
    received_document_id = (posted_document ->> 'id')::uuid,
    received_at = statement_timestamp(),
    updated_at = statement_timestamp()
where id = order_id;

return pg_catalog.jsonb_build_object(
  'order', public.production_order_json(order_id),
  'document', posted_document
);
```

Declare `locked_order public.production_orders%rowtype`, `receipt_request_id uuid`, and the JSON/date variables used above. Validate command shape, UUIDs, and ISO date before this block, then take the request advisory lock before the row lock. The already-received branch deliberately recovers the original stock document's `client_request_id` and calls `post_stock_document` with only that ID; the existing idempotency branch returns the canonical document before validating the other fields. Use `production_order_json` for order output and do not duplicate response-shaping SQL.

- [ ] **Step 4: Add ownership/grants and run tests**

```sql
alter function public.receive_production_order(jsonb) owner to postgres;
revoke all on function public.receive_production_order(jsonb) from public, anon, authenticated;
grant execute on function public.receive_production_order(jsonb) to anon, authenticated;
```

```powershell
npm test -- tests/unit/supabase-migration.test.ts
```

Expected: migration tests pass.

- [ ] **Step 5: Commit atomic receiving**

```powershell
git add supabase/migrations/202607220004_production_orders.sql tests/unit/supabase-migration.test.ts
git diff --cached --check
git commit -m "feat: receive production orders atomically"
```

---

### Task 5: Add the Supabase repository and production-order provider

**Files:**
- Modify: `src/lib/supabase.ts`
- Create: `src/features/production-orders/data/supabase-production-order-repository.ts`
- Create: `src/features/production-orders/production-order-provider.tsx`
- Create: `src/features/production-orders/data/repository-factory.ts`
- Modify: `src/app/layout.tsx`
- Create: `tests/unit/supabase-production-order-repository.test.ts`
- Create: `tests/unit/production-order-repository-factory.test.ts`
- Create: `tests/components/production-order-provider.test.tsx`

**Interfaces:**
- Consumes: all production-order RPCs and `useInventory().refresh()`.
- Produces: `useProductionOrders()` with `orders`, `loading`, `error`, `warning`, `save`, `cancel`, `receive`, and `refresh`.

- [ ] **Step 1: Write failing Supabase client-contract tests**

Use the existing `ContractClient` pattern and assert:

```ts
expect(client.rpcCalls).toEqual([
  { name: "get_production_orders", args: undefined },
  { name: "save_production_order", args: { command: expect.objectContaining({ requestId: expect.any(String), orderDate: "2026-07-22" }) } },
  { name: "cancel_production_order", args: { command: { orderId: "order-1" } } },
  { name: "receive_production_order", args: { command: expect.objectContaining({ orderId: "order-1", effectiveDate: "2026-07-22" }) } },
]);
```

Also assert malformed nested payloads are rejected before mapping, create/receipt request UUIDs persist across failed responses, and terminal-status errors map to Thai copy.

In `tests/unit/production-order-repository-factory.test.ts`, mirror the inventory factory tests and assert that missing/partial environment selects `DemoProductionOrderRepository`, a complete Supabase environment selects the injected Supabase repository, and Demo receives the injected inventory repository and storage.

- [ ] **Step 2: Write a failing provider refresh test**

Render a fixture that displays the first order status. Save an order, receive it, and assert status changes from `รอรับเข้า` to `รับเข้าแล้ว`. Spy on the injected inventory repository load and assert inventory refresh occurs after receipt but not after ordinary save/cancel.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm test -- tests/unit/supabase-production-order-repository.test.ts tests/unit/production-order-repository-factory.test.ts tests/components/production-order-provider.test.tsx
```

- [ ] **Step 4: Extend Supabase types and implement the adapter**

Add function contracts to `InventoryDatabase.public.Functions`:

```ts
get_production_orders: { Args: never; Returns: Json };
save_production_order: { Args: { command: Json }; Returns: Json };
cancel_production_order: { Args: { command: Json }; Returns: Json };
receive_production_order: { Args: { command: Json }; Returns: Json };
```

Implement `SupabaseProductionOrderRepository` with one strict mapper for orders/lines and the existing inventory mapper's strict stock-document shape for receipt results. Store retry IDs under `sole-stock.production-orders.pending.v1` only for operations that need lost-response reconciliation: create is keyed by a fingerprint of its normalized command and receipt is keyed by `orderId`. Clear an ID only after a successful mapped response. Edits and cancellation send only their authoritative `orderId` payload and do not reuse a create/receipt retry ID. Map `PRODUCTION_ORDER_NOT_FOUND`, `PRODUCTION_ORDER_NOT_OPEN`, `PRODUCTION_ORDER_CANCELLED`, `PRODUCTION_ORDER_RECEIVED`, and invalid-command errors to explicit Thai messages; retain a generic Thai save error for transport/unknown failures.

Create `repository-factory.ts` after the adapter exists:

```ts
import type { InventoryRepository } from "@/features/inventory/data/inventory-repository";
import { isSupabaseInventoryConfigured, selectInventoryRepository } from "@/features/inventory/data/repository-factory";
import { DemoProductionOrderRepository } from "./demo-production-order-repository";
import type { ProductionOrderRepository } from "./production-order-repository";
import { SupabaseProductionOrderRepository } from "./supabase-production-order-repository";

export interface ProductionOrderRepositoryFactoryOptions {
  environment?: Record<string, string | undefined>;
  storage?: Storage;
  inventoryRepository?: InventoryRepository;
  createSupabaseRepository?: () => ProductionOrderRepository;
  createDemoRepository?: (storage: Storage, inventory: InventoryRepository) => ProductionOrderRepository;
}

export interface ProductionOrderRepositorySelection {
  repository: ProductionOrderRepository;
  mode: "demo" | "supabase";
}

function environmentFor(options: ProductionOrderRepositoryFactoryOptions) {
  return options.environment ?? {
    NEXT_PUBLIC_INVENTORY_BACKEND: process.env.NEXT_PUBLIC_INVENTORY_BACKEND,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function selectProductionOrderRepository(
  options: ProductionOrderRepositoryFactoryOptions = {},
): ProductionOrderRepositorySelection {
  const environment = environmentFor(options);
  if (isSupabaseInventoryConfigured({ environment })) {
    const repository = options.createSupabaseRepository?.()
      ?? new SupabaseProductionOrderRepository(
        environment.NEXT_PUBLIC_SUPABASE_URL!,
        environment.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
    return { repository, mode: "supabase" };
  }

  const storage = options.storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!storage) throw new Error("ไม่สามารถเปิดพื้นที่จัดเก็บข้อมูลในเบราว์เซอร์ได้");
  const inventory = options.inventoryRepository
    ?? selectInventoryRepository({ environment, storage }).repository;
  const repository = options.createDemoRepository?.(storage, inventory)
    ?? new DemoProductionOrderRepository(storage, inventory);
  return { repository, mode: "demo" };
}
```

- [ ] **Step 5: Implement provider and root wiring**

`ProductionOrderProvider` follows the retained-snapshot pattern from `InventoryProvider`:

```tsx
interface ProductionOrderContextValue {
  orders: ProductionOrder[] | null;
  loading: boolean;
  error: string | null;
  warning: string | null;
  refresh(): Promise<void>;
  save(input: ProductionOrderInput): Promise<ProductionOrder>;
  cancel(orderId: string): Promise<ProductionOrder>;
  receive(orderId: string, effectiveDate: string): Promise<ProductionOrderReceiptResult>;
}

const receive = useCallback(async (orderId: string, effectiveDate: string) => {
  const result = await runMutation((repository) => repository.receive(orderId, effectiveDate));
  await inventory.refresh();
  return result;
}, [inventory, runMutation]);
```

`runMutation` refreshes the production-order snapshot after success. On failure it makes a best-effort production-order refresh before rethrowing the mapped Thai error, so a concurrent receive/cancel replaces stale `OPEN` state while an ordinary network failure retains the previous snapshot and exposes a warning. `receive` performs that order refresh first and then awaits `inventory.refresh()` before returning the result.

Nest it inside inventory context in `src/app/layout.tsx`:

```tsx
<InventoryProvider>
  <ProductionOrderProvider>
    <AppShell>{children}</AppShell>
  </ProductionOrderProvider>
</InventoryProvider>
```

- [ ] **Step 6: Run focused tests, typecheck, and lint**

```powershell
npm test -- tests/unit/supabase-production-order-repository.test.ts tests/unit/production-order-repository-factory.test.ts tests/components/production-order-provider.test.tsx
npm run typecheck
npm run lint
```

- [ ] **Step 7: Commit data/provider wiring**

```powershell
git add src/lib/supabase.ts src/features/production-orders src/app/layout.tsx tests/unit/supabase-production-order-repository.test.ts tests/unit/production-order-repository-factory.test.ts tests/components/production-order-provider.test.tsx
git diff --cached --check
git commit -m "feat: connect production order repositories"
```

---

### Task 6: Add navigation and the production-order list

**Files:**
- Modify: `src/components/app-shell.tsx`
- Create: `src/features/production-orders/components/production-order-status.tsx`
- Create: `src/app/production-orders/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/components/app-shell.test.tsx`
- Create: `tests/components/production-order-list.test.tsx`

**Interfaces:**
- Consumes: provider orders and Task 1 selectors.
- Produces: `/production-orders` with search, status filter, totals, desktop table, and mobile cards.

- [ ] **Step 1: Write failing navigation/list tests**

Update expected links with `["ใบผลิตออเดอร์", "/production-orders"]` and change the navigation count text from seven to eight.

List tests must assert:

```tsx
expect(await screen.findByRole("heading", { name: "ใบผลิตออเดอร์" })).toBeInTheDocument();
expect(screen.getByRole("link", { name: "สร้างใบผลิต" })).toHaveAttribute("href", "/production-orders/new");
expect(within(screen.getByRole("table", { name: "รายการใบผลิตออเดอร์" })).getByText("PO-20260722-000001")).toBeInTheDocument();
await user.type(screen.getByRole("searchbox", { name: "ค้นหาใบผลิต" }), "Paris Black");
expect(screen.getByText("10 คู่")).toBeInTheDocument();
await user.selectOptions(screen.getByRole("combobox", { name: "สถานะใบผลิต" }), "CANCELLED");
expect(screen.getByRole("status", { name: "ไม่พบใบผลิต" })).toBeInTheDocument();
```

Add provider fixtures for the initial loading state, an initial Thai error with a retry button, and a retained-data warning. The list must continue showing the previous rows when only `warning` is set.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm test -- tests/components/app-shell.test.tsx tests/components/production-order-list.test.tsx
```

- [ ] **Step 3: Add navigation/status component/list page**

Add `ClipboardList` to `navigationItems`. `ProductionOrderStatus` maps:

```ts
const labels = { OPEN: "รอรับเข้า", RECEIVED: "รับเข้าแล้ว", CANCELLED: "ยกเลิก" } as const;
const tones = { OPEN: "warning", RECEIVED: "success", CANCELLED: "neutral" } as const;
```

The page uses `filterProductionOrders`, renders a `Field` searchbox, status `Select`, summary counts, a desktop table, and mobile cards. Every row/card links to `/production-orders/${order.id}` and includes accessible order number text.

- [ ] **Step 4: Add responsive styling and run tests**

Add focused `.production-order-*` rules; reuse page header, filter panel, table, status badge, and card tokens. Ensure mobile action/link targets are at least 44px and no fixed-width table leaks outside its scroll wrapper.

```powershell
npm test -- tests/components/app-shell.test.tsx tests/components/production-order-list.test.tsx
npm run typecheck
npm run lint
```

- [ ] **Step 5: Commit list UI**

```powershell
git add src/components/app-shell.tsx src/features/production-orders/components src/app/production-orders/page.tsx src/app/globals.css tests/components/app-shell.test.tsx tests/components/production-order-list.test.tsx
git diff --cached --check
git commit -m "feat: add production order list"
```

---

### Task 7: Build create and edit forms

**Files:**
- Create: `src/features/production-orders/components/production-order-form.tsx`
- Create: `src/app/production-orders/new/page.tsx`
- Create: `src/app/production-orders/[id]/edit/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/components/production-order-form.test.tsx`

**Interfaces:**
- Consumes: active variants from `useInventory`, validation from Task 1, and provider `save`.
- Produces: create/edit forms with manual dependent selections and unsaved-change guard.

- [ ] **Step 1: Write failing form tests**

Assert create defaults, dependent selections, totals, duplicate/date errors, retained values after a repository rejection, and edit terminal guard:

```tsx
await user.selectOptions(screen.getByRole("combobox", { name: "รุ่นสินค้า รายการ 1" }), "paris");
await user.selectOptions(screen.getByRole("combobox", { name: "สีสินค้า รายการ 1" }), "black");
await user.selectOptions(screen.getByRole("combobox", { name: "ไซซ์ รายการ 1" }), "paris-black-38");
await user.type(screen.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" }), "4");
expect(screen.getByText("รวม 4 คู่")).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "บันทึกใบผลิต" }));
expect(save).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ variantId: "paris-black-38", quantity: 4 }] }));
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm test -- tests/components/production-order-form.test.tsx
```

- [ ] **Step 3: Implement the reusable form**

Use `createDocumentLine`/`DocumentLineEditor` with `allowVariantCreation={false}` and `showAvailable={false}`. Build `DocumentVariantOption[]` only from active variants whose model and color are also active, using `available: 0` because balances are intentionally irrelevant. Convert drafts to `{ variantId, quantity: Number(...) }` and call `validateProductionOrder` before `save`.

Wrap the editor in `DocumentValidationContext.Provider`. Keep `ProductionOrderValidationError[]` as the authoritative form errors; adapt only `lines.*` entries to the inventory context's `{ path, code, message }` shape (`INVALID_DATE_RANGE` cannot occur on a line, and maps defensively to `REQUIRED`). Implement `errorFor`, `clearErrors`, and `clearAllErrors` against the production error state so changing one dependent selector removes that line's stale message while header errors remain visible beside their fields.

Provide explicit controlled props:

```ts
interface ProductionOrderFormProps {
  order?: ProductionOrder;
  onSaved(order: ProductionOrder): void;
}
```

The form owns order date, expected date, note, lines, validation errors, submit state, and `useUnsavedChanges`. A new form defaults `orderDate` to the user's local date, starts `expectedDate` at that same date, and explains that the order number will be generated after saving. For edit, refuse rendering the form unless `order.status === "OPEN"`; show a Thai terminal-state page with a link back to detail.

- [ ] **Step 4: Implement route wrappers**

- New route renders `ProductionOrderForm` and sends successful saves to `/production-orders/[id]`.
- Edit route reads `useParams<{ id: string }>()`, waits for provider data, resolves the order, and renders not-found/retry states explicitly.

- [ ] **Step 5: Run form tests, typecheck, and lint**

```powershell
npm test -- tests/components/production-order-form.test.tsx
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit forms**

```powershell
git add src/features/production-orders/components/production-order-form.tsx src/app/production-orders/new src/app/production-orders/[id]/edit src/app/globals.css tests/components/production-order-form.test.tsx
git diff --cached --check
git commit -m "feat: create and edit production orders"
```

---

### Task 8: Add detail, cancellation, and manual full receipt

**Files:**
- Create: `src/features/production-orders/components/production-order-actions.tsx`
- Create: `src/app/production-orders/[id]/page.tsx`
- Modify: `src/app/history/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/components/production-order-detail.test.tsx`
- Create: `tests/components/production-order-actions.test.tsx`
- Modify: `tests/components/history-page.test.tsx`

**Interfaces:**
- Consumes: provider `cancel` and `receive`, SweetAlert2, production order status.
- Produces: detail page and guarded terminal actions.

- [ ] **Step 1: Write failing detail/action tests**

Mock SweetAlert2 as in `clear-stock-button.test.tsx` and assert:

- `OPEN` shows print, edit, cancel, receive.
- `RECEIVED` shows print and linked receipt but not edit/cancel/receive.
- `CANCELLED` shows print only.
- Cancellation confirmation calls `cancel(id)` and shows success.
- Receipt confirmation text includes number and pair total, calls `receive(id, localDate)`, blocks outside click while loading, and reports the returned stock document number.
- Mutation errors stay inside the confirmation with Thai validation copy.
- With `window.history` set to `/history?document=receipt`, the history page opens `รายละเอียดเอกสาร STK-20260701-0001` after the inventory snapshot loads; closing the modal removes only the `document` parameter and preserves any other query parameters.

- [ ] **Step 2: Run action tests and verify RED**

```powershell
npm test -- tests/components/production-order-detail.test.tsx tests/components/production-order-actions.test.tsx tests/components/history-page.test.tsx
```

- [ ] **Step 3: Implement actions**

`ProductionOrderActions` accepts:

```ts
interface ProductionOrderActionsProps {
  order: ProductionOrder;
  onCancel(orderId: string): Promise<ProductionOrder>;
  onReceive(orderId: string, effectiveDate: string): Promise<ProductionOrderReceiptResult>;
}
```

Use two separate SweetAlert2 dialogs. Cancellation copy states that history remains. Receipt copy states `รับ ${totalPairs} คู่ จากใบผลิต ${order.number} เข้าสต๊อกทั้งหมด` and has `showLoaderOnConfirm`, `allowOutsideClick`, and `allowEscapeKey` guards. Use a local-date helper identical to clear stock.

- [ ] **Step 4: Implement detail route**

Resolve the order by route ID. Render header data, status, responsive line table/cards, totals, note, and terminal timestamps. For received orders, resolve `receivedDocumentId` against `useInventory().snapshot.documents`, display the stock document number, and link it to `/history?document=<receivedDocumentId>`; while inventory is refreshing, use a Thai loading/fallback label without dropping the link. Put `ProductionOrderActions` in the page header/action section.

Extend `HistoryPageContent` to synchronize `searchParams.get("document")` into `selectedDocumentId`, using the same query/state synchronization pattern already used for `variant`. Once `snapshot` contains that ID, the existing modal opens automatically. Route every modal close action through:

```tsx
function closeSelectedDocument() {
  const next = new URLSearchParams(searchParams.toString());
  next.delete("document");
  const query = next.toString();
  router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  setDocumentState({ query: null, selected: null });
}
```

An unknown document ID must leave the page usable without opening a modal; it must not throw or discard the history rows.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/components/production-order-detail.test.tsx tests/components/production-order-actions.test.tsx tests/components/history-page.test.tsx
npm run typecheck
npm run lint
git add src/features/production-orders/components/production-order-actions.tsx src/app/production-orders/[id]/page.tsx src/app/history/page.tsx src/app/globals.css tests/components/production-order-detail.test.tsx tests/components/production-order-actions.test.tsx tests/components/history-page.test.tsx
git diff --cached --check
git commit -m "feat: manage production order lifecycle"
```

---

### Task 9: Add A4 portrait print preview

**Files:**
- Create: `src/features/production-orders/components/production-order-print.tsx`
- Create: `src/app/production-orders/[id]/print/page.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/components/production-order-print.test.tsx`

**Interfaces:**
- Consumes: approved visual option B and provider order data.
- Produces: `/production-orders/[id]/print` and explicit `window.print()` button.

- [ ] **Step 1: Write failing print tests**

```tsx
it("renders every required A4 field and calls browser print", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
  renderPrintRoute(openOrder);
  expect(await screen.findByRole("heading", { name: "ใบผลิตออเดอร์" })).toBeInTheDocument();
  expect(screen.getByText("PO-20260722-000001")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "รายการสั่งผลิต" })).toHaveTextContent("Paris");
  expect(screen.getByText("รวมทั้งหมด 10 คู่")).toBeInTheDocument();
  expect(screen.getByText("ผู้สั่งผลิต")).toBeInTheDocument();
  expect(screen.getByText("ผู้รับออเดอร์")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "พิมพ์ใบผลิต" }));
  expect(print).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm test -- tests/components/production-order-print.test.tsx
```

- [ ] **Step 3: Implement print component and route**

Render SOLE STOCK, title, number, dates, status, line table (`#`, `รุ่น / สี`, `ไซซ์`, `จำนวน`), note, total pairs, and both signature lines. Keep the print button and back link inside `.print-controls.print-hidden`.

- [ ] **Step 4: Add print media CSS**

```css
@page { size: A4 portrait; margin: 12mm; }

@media print {
  .sidebar, .mobile-nav, .print-hidden { display: none !important; }
  .app-shell { display: block; min-height: auto; }
  .app-main { overflow: visible; padding: 0; }
  .production-print-page { width: auto; max-width: none; margin: 0; color: #000; background: #fff; box-shadow: none; }
  .production-print-table thead { display: table-header-group; }
  .production-print-table tr, .production-print-signatures { break-inside: avoid; }
}
```

Screen CSS presents the A4 page centered on a neutral preview background without causing horizontal overflow on mobile.

- [ ] **Step 5: Run print tests/build and commit**

```powershell
npm test -- tests/components/production-order-print.test.tsx
npm run typecheck
npm run lint
npm run build
git add src/features/production-orders/components/production-order-print.tsx src/app/production-orders/[id]/print src/app/globals.css tests/components/production-order-print.test.tsx
git diff --cached --check
git commit -m "feat: print A4 production orders"
```

Expected: print test and production build pass with the new dynamic routes.

---

### Task 10: Cover the complete workflow, verify, deploy migrations, and push

**Files:**
- Modify: `tests/e2e/inventory.spec.ts`

**Interfaces:**
- Consumes: all prior tasks.
- Verifies: no-login create/edit/print/receive/cancel flow, one receipt, responsive navigation, and remote RPC availability.

- [ ] **Step 1: Extend desktop E2E**

After creating `E2E Runner` and `E2E White`, create a two-line production order. Assert number/status/totals, edit the expected date, open print preview, and check all required print fields.

Use print media emulation:

```ts
await page.emulateMedia({ media: "print" });
await expect(page.getByRole("navigation", { name: "เมนูหลัก" })).toBeHidden();
await expect(page.getByRole("table", { name: "รายการสั่งผลิต" })).toBeVisible();
await page.emulateMedia({ media: "screen" });
```

Return to detail, confirm receipt, capture the receipt number, and assert:

```ts
await expect(page.getByText("รับเข้าแล้ว")).toBeVisible();
await expect(page.getByRole("link", { name: new RegExp(receiptNumber) })).toBeVisible();
await expect(page.getByRole("link", { name: "แก้ไข" })).toHaveCount(0);
await expect(page.getByRole("button", { name: "รับเข้าสต๊อก" })).toHaveCount(0);
```

Verify inventory increased by each ordered quantity and history has exactly one `RECEIPT` row whose reference is the production-order number. Create and cancel a second order; verify its quantities never change stock.

- [ ] **Step 2: Extend mobile route checks**

Add `ใบผลิตออเดอร์` to mobile navigation checks. Verify the link and `สร้างใบผลิต` touch targets are at least 44px and list cards/print preview have no document overflow.

- [ ] **Step 3: Run focused E2E**

```powershell
npm run e2e -- tests/e2e/inventory.spec.ts
```

Expected: desktop 1440×900, mobile 390×844, and mobile-min 360×800 pass.

- [ ] **Step 4: Run every local regression check**

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e -- tests/e2e/inventory.spec.ts
git diff --check
```

Expected: all Vitest suites, TypeScript, ESLint, every production route, and all three Playwright projects pass.

- [ ] **Step 5: Commit E2E coverage**

```powershell
git add tests/e2e/inventory.spec.ts
git diff --cached --check
git commit -m "test: cover production order workflow"
```

- [ ] **Step 6: Link Supabase or stop for user action**

```powershell
npx supabase db push --dry-run
```

If it reports `Cannot find project ref`, stop and ask the user to run:

```powershell
npx supabase login
npx supabase link --project-ref ozbhdorqtktirsexycnp
```

Do not expose access tokens or database passwords and do not claim deployment while unlinked.

- [ ] **Step 7: Dry-run and apply migrations**

```powershell
npx supabase db push --dry-run
npx supabase db push
```

Expected: pending migrations include `202607220003_clear_inventory_stock.sql` if it is still absent remotely, followed by `202607220004_production_orders.sql`. Both apply successfully.

- [ ] **Step 8: Verify final scope and push master**

```powershell
git status --short
git log --oneline -15
git push origin master
```

Expected: `next-env.d.ts` is the only unstaged file, no environment files are tracked, and `origin/master` advances through the clear-stock and production-order commits.
