import { describe, expect, it } from "vitest";
import { DemoInventoryRepository, INVENTORY_STORAGE_KEY } from "@/features/inventory/data/demo-repository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("DemoInventoryRepository", () => {
  it("loads the deterministic initial seed", async () => {
    const snapshot = await new DemoInventoryRepository(new MemoryStorage()).load();
    expect(snapshot.version).toBe(1);
    expect(snapshot.models.map((model) => model.name)).toEqual(["Paris", "Castor", "Weave"]);
    expect(snapshot.variants).toHaveLength(63);
    expect(snapshot.variants.every((variant) => variant.lowStockThreshold === 3)).toBe(true);
  });

  it("persists a catalog mutation across repository instances", async () => {
    const storage = new MemoryStorage();
    await new DemoInventoryRepository(storage).addModel("  Runner  ");
    const snapshot = await new DemoInventoryRepository(storage).load();
    expect(snapshot.models).toContainEqual(expect.objectContaining({ name: "Runner", active: true }));
  });

  it("rejects catalog duplicates without case or surrounding-space sensitivity", async () => {
    const repository = new DemoInventoryRepository(new MemoryStorage());
    await expect(repository.addColor(" black ")).rejects.toThrow(/ชื่อ.*ซ้ำ/);
  });

  it("deactivates catalog records without deleting them", async () => {
    const repository = new DemoInventoryRepository(new MemoryStorage());
    const before = await repository.load();
    await repository.setModelActive(before.models[0].id, false);
    const after = await repository.load();
    expect(after.models[0]).toEqual({ ...before.models[0], active: false });
  });

  it("rejects negative and fractional low-stock thresholds", async () => {
    const repository = new DemoInventoryRepository(new MemoryStorage());
    const variantId = (await repository.load()).variants[0].id;
    await expect(repository.saveLowStockThreshold(variantId, -1)).rejects.toThrow(/เกณฑ์/);
    await expect(repository.saveLowStockThreshold(variantId, 1.5)).rejects.toThrow(/เกณฑ์/);
  });

  it("leaves local state and storage unchanged when a document fails", async () => {
    const storage = new MemoryStorage();
    const repository = new DemoInventoryRepository(storage);
    const before = await repository.load();
    const first = before.variants[0];
    const second = before.variants[1];

    await expect(repository.postDocument({
      type: "SALE",
      effectiveDate: "2026-07-22",
      lines: [
        { variantId: first.id, size: first.size, quantity: 1 },
        { variantId: second.id, size: second.size, quantity: 999 },
      ],
    })).rejects.toThrow(/สต็อกไม่เพียงพอ/);

    expect(await repository.load()).toEqual(before);
    expect(await new DemoInventoryRepository(storage).load()).toEqual(before);
    expect(storage.getItem(INVENTORY_STORAGE_KEY)).toBeNull();
  });

  it("returns a Thai validation error for malformed document input", async () => {
    const repository = new DemoInventoryRepository(new MemoryStorage());
    await expect(repository.postDocument({
      type: "SALE",
      effectiveDate: 7 as never,
      lines: [],
    })).rejects.toThrow(/กรุณา/);
  });

  it("falls back from corrupt or incompatible storage without overwriting it", async () => {
    const storage = new MemoryStorage();
    storage.setItem(INVENTORY_STORAGE_KEY, "not-json");
    expect((await new DemoInventoryRepository(storage).load()).version).toBe(1);
    expect(storage.getItem(INVENTORY_STORAGE_KEY)).toBe("not-json");
    storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify({ version: 2 }));
    expect((await new DemoInventoryRepository(storage).load()).version).toBe(1);
    expect(storage.getItem(INVENTORY_STORAGE_KEY)).toBe(JSON.stringify({ version: 2 }));
  });
});
