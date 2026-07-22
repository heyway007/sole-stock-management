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
      lines: [{ variantId: first.id, quantity: 4 }],
    });
    expect(created).toMatchObject({
      number: "PO-20260722-000001",
      status: "OPEN",
    });
    expect(created.lines[0]).toMatchObject({
      modelName: "Paris",
      colorName: "Black",
      size: 38,
      quantity: 4,
    });

    const edited = await repository.save({
      id: created.id,
      orderDate: created.orderDate,
      expectedDate: "2026-08-08",
      note: "แก้แล้ว",
      lines: [{ variantId: second.id, quantity: 6 }],
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
      lines: edited.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
    })).rejects.toThrow("แก้ไขได้เฉพาะใบผลิตที่รอรับเข้า");
  });

  it("receives every line once and returns the same linked document on retry", async () => {
    const { repository, inventory, order } = await fixtureWithOpenOrder();
    const before = await inventory.load();
    const result = await repository.receive(order.id, "2026-07-22");
    const after = await inventory.load();

    expect(result.order).toMatchObject({
      status: "RECEIVED",
      receivedDocumentId: result.document.id,
    });
    expect(result.document).toMatchObject({ type: "RECEIPT", reference: order.number });
    for (const line of order.lines) {
      expect(after.balances[line.variantId] - before.balances[line.variantId]).toBe(line.quantity);
    }
    await expect(repository.receive(order.id, "2026-07-22")).resolves.toEqual(result);
    expect((await inventory.load()).documents).toHaveLength(after.documents.length);
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
      lines: [{ variantId: variant.id, quantity: 1 }],
    });
    expect(JSON.parse(storage.getItem(PRODUCTION_ORDER_STORAGE_KEY) ?? "null")).toMatchObject({
      version: 1,
      revision: 1,
    });
  });
});
