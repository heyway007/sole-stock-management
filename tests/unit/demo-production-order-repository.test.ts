import { describe, expect, it } from "vitest";
import {
  DemoProductionOrderRepository,
  PRODUCTION_ORDER_STORAGE_KEY,
} from "@/features/production-orders/data/demo-production-order-repository";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";

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
      unitPrice: 300 + index,
    })),
  });
  return { storage, inventory, repository, order };
}

describe("DemoProductionOrderRepository", () => {
  it("creates, edits, cancels, and preserves snapshotted catalog names", async () => {
    const storage = new MemoryStorage();
    const inventory = new DemoInventoryRepository(storage);
    const snapshot = await inventory.load();
    const first = snapshot.variants[0];
    const second = snapshot.variants[1];
    const repository = new DemoProductionOrderRepository(storage, inventory, {
      createId: deterministicIds(),
      now: () => "2026-07-22T10:00:00.000Z",
    });

    const created = await repository.save({
      orderDate: "2026-07-22",
      expectedDate: "2026-08-05",
      note: "รอบแรก",
      lines: [{ variantId: first.id, quantity: 4, unitPrice: 327.5 }],
    });
    expect(created).toMatchObject({
      number: "PO-20260722-000001",
      status: "OPEN",
    });
    expect(created.lines[0]).toMatchObject({
      modelName: "Paris",
      colorName: "Black",
      size: "XS",
      quantity: 4,
      unitPrice: 327.5,
    });

    const edited = await repository.save({
      id: created.id,
      orderDate: created.orderDate,
      expectedDate: "2026-08-08",
      note: "แก้แล้ว",
      lines: [{ variantId: second.id, quantity: 6, unitPrice: 265 }],
    });
    expect(edited).toMatchObject({
      id: created.id,
      number: created.number,
      expectedDate: "2026-08-08",
    });
    await expect(repository.cancel(created.id)).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(repository.save({
      id: created.id,
      orderDate: edited.orderDate,
      expectedDate: edited.expectedDate,
      note: edited.note,
      lines: edited.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? 1,
      })),
    })).rejects.toThrow("แก้ไขได้เฉพาะใบผลิตที่รอรับเข้า");
  });

  it("receives every line once and returns the same linked document on retry", async () => {
    const { repository, inventory, order } = await fixtureWithOpenOrder();
    const before = await inventory.load();
    const result = await repository.receive({ orderId: order.id, effectiveDate: "2026-07-22" });
    const after = await inventory.load();

    expect(result.order).toMatchObject({
      status: "RECEIVED",
      receivedDocumentId: result.document.id,
    });
    expect(result.document).toMatchObject({ type: "RECEIPT", reference: order.number });
    for (const line of order.lines) {
      expect(after.balances[line.variantId] - before.balances[line.variantId]).toBe(line.quantity);
    }
    await expect(repository.receive({ orderId: order.id, effectiveDate: "2026-07-22" })).resolves.toEqual(result);
    expect((await inventory.load()).documents).toHaveLength(after.documents.length);
  });

  it("receives one line partially and leaves the order open with progress", async () => {
    const { repository, inventory, order } = await fixtureWithOpenOrder();
    const before = await inventory.load();

    const result = await repository.receive({
      orderId: order.id,
      effectiveDate: "2026-07-22",
      lines: [{ lineId: order.lines[0].id, quantity: 2 }],
    });
    const after = await inventory.load();

    expect(result.order.status).toBe("OPEN");
    expect(result.order.lines[0].receivedQuantity).toBe(2);
    expect(result.order.lines[1].receivedQuantity).toBe(0);
    expect(after.balances[order.lines[0].variantId] - before.balances[order.lines[0].variantId]).toBe(2);
    expect(after.balances[order.lines[1].variantId] - before.balances[order.lines[1].variantId]).toBe(0);
  });

  it("repeats partial receipts and marks the order received only when every line is complete", async () => {
    const { repository, order } = await fixtureWithOpenOrder();

    await repository.receive({
      orderId: order.id,
      effectiveDate: "2026-07-22",
      lines: [{ lineId: order.lines[0].id, quantity: 2 }],
    });
    const final = await repository.receive({
      orderId: order.id,
      effectiveDate: "2026-07-22",
      lines: [
        { lineId: order.lines[0].id, quantity: 2 },
        { lineId: order.lines[1].id, quantity: 5 },
      ],
    });

    expect(final.order.status).toBe("RECEIVED");
    expect(final.order.lines.every((line) => line.receivedQuantity === line.quantity)).toBe(true);
    expect(final.order.receiptDocumentIds).toHaveLength(2);
  });

  it("receives only remaining quantities when the page-level command omits lines", async () => {
    const { repository, inventory, order } = await fixtureWithOpenOrder();
    await repository.receive({
      orderId: order.id,
      effectiveDate: "2026-07-22",
      lines: [{ lineId: order.lines[0].id, quantity: 1 }],
    });
    const before = await inventory.load();

    const result = await repository.receive({ orderId: order.id, effectiveDate: "2026-07-22" });
    const receiptDeltas = new Map(result.document.lines.map((line) => [line.variantId, line.delta]));

    expect(receiptDeltas.get(order.lines[0].variantId)).toBe(3);
    expect(receiptDeltas.get(order.lines[1].variantId)).toBe(5);
    expect(result.order.status).toBe("RECEIVED");
    expect((await inventory.load()).documents.length).toBe(before.documents.length + 1);
  });

  it("rejects a partial receipt above the remaining quantity without mutating state", async () => {
    const { repository, inventory, order } = await fixtureWithOpenOrder();
    const before = await inventory.load();

    await expect(repository.receive({
      orderId: order.id,
      effectiveDate: "2026-07-22",
      lines: [{ lineId: order.lines[0].id, quantity: 5 }],
    })).rejects.toThrow();

    expect((await inventory.load()).documents).toEqual(before.documents);
    expect((await repository.load())[0].lines[0].receivedQuantity).toBe(0);
  });

  it("normalizes legacy open orders without received progress fields", async () => {
    const { storage, inventory, order } = await fixtureWithOpenOrder();
    const persisted = JSON.parse(storage.getItem(PRODUCTION_ORDER_STORAGE_KEY)!);
    delete persisted.receiptRequests;
    delete persisted.orders[0].receiptDocumentIds;
    delete persisted.orders[0].lines[0].receivedQuantity;
    storage.setItem(PRODUCTION_ORDER_STORAGE_KEY, JSON.stringify(persisted));

    const loaded = await new DemoProductionOrderRepository(storage, inventory).load();

    expect(loaded[0].receiptDocumentIds).toEqual([]);
    expect(loaded[0].lines[0].receivedQuantity).toBe(0);
  });

  it("keeps corrupt persisted data untouched until a successful mutation", async () => {
    const storage = new MemoryStorage();
    storage.setItem(PRODUCTION_ORDER_STORAGE_KEY, "{bad-json");
    const inventory = new DemoInventoryRepository(storage);
    const repository = new DemoProductionOrderRepository(storage, inventory, {
      createId: deterministicIds(),
    });

    await expect(repository.load()).resolves.toEqual([]);
    expect(storage.getItem(PRODUCTION_ORDER_STORAGE_KEY)).toBe("{bad-json");

    const variant = (await inventory.load()).variants[0];
    await repository.save({
      orderDate: "2026-07-22",
      expectedDate: "2026-07-22",
      note: "",
      lines: [{ variantId: variant.id, quantity: 1, unitPrice: 100 }],
    });
    expect(JSON.parse(storage.getItem(PRODUCTION_ORDER_STORAGE_KEY) ?? "null")).toMatchObject({
      version: 1,
      revision: 1,
    });
  });

  it("upgrades legacy numeric line sizes without changing order identities", async () => {
    const { storage, inventory, order } = await fixtureWithOpenOrder();
    const persisted = JSON.parse(
      storage.getItem(PRODUCTION_ORDER_STORAGE_KEY)!,
    ) as {
      orders: Array<{
        id: string;
        lines: Array<{ id: string; size: string | number; unitPrice?: number }>;
      }>;
    };
    const originalLineId = persisted.orders[0].lines[0].id;
    persisted.orders[0].lines[0].size = 38;
    delete persisted.orders[0].lines[0].unitPrice;
    storage.setItem(PRODUCTION_ORDER_STORAGE_KEY, JSON.stringify(persisted));

    const loaded = await new DemoProductionOrderRepository(
      storage,
      inventory,
    ).load();

    expect(loaded[0].id).toBe(order.id);
    expect(loaded[0].lines[0]).toMatchObject({
      id: originalLineId,
      size: "38",
      unitPrice: null,
    });
  });
});
