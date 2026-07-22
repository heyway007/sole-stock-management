import { describe, expect, it } from "vitest";
import { DemoInventoryRepository, INVENTORY_STORAGE_KEY } from "@/features/inventory/data/demo-repository";
import { createSeedSnapshot } from "@/features/inventory/data/seed";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class SerialLockManager {
  calls = 0;
  maxActive = 0;
  private active = 0;
  private tail = Promise.resolve();

  request<T>(_name: string, callback: () => Promise<T> | T): Promise<T> {
    this.calls += 1;
    const run = this.tail.then(async () => {
      this.active += 1;
      this.maxActive = Math.max(this.maxActive, this.active);
      try {
        return await callback();
      } finally {
        this.active -= 1;
      }
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
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

  it("keeps catalog identities stable when a renamed model or color name is reused", async () => {
    const storage = new MemoryStorage();
    const ids = ["model-random-1", "model-random-2", "color-random-1", "color-random-2"];
    const repository = new DemoInventoryRepository(storage, { createId: () => ids.shift()! });

    const firstModel = await repository.addModel("Runner");
    await repository.renameModel(firstModel.id, "Runner Classic");
    const reusedModel = await repository.addModel("Runner");
    const firstColor = await repository.addColor("White");
    await repository.renameColor(firstColor.id, "Ivory");
    const reusedColor = await repository.addColor("White");

    const reloaded = await new DemoInventoryRepository(storage).load();
    expect(reusedModel.id).not.toBe(firstModel.id);
    expect(reusedColor.id).not.toBe(firstColor.id);
    expect(reloaded.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstModel.id, name: "Runner Classic" }),
      expect.objectContaining({ id: reusedModel.id, name: "Runner" }),
    ]));
    expect(reloaded.colors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstColor.id, name: "Ivory" }),
      expect.objectContaining({ id: reusedColor.id, name: "White" }),
    ]));
  });

  it("re-reads storage before mutations so stale repository instances do not overwrite each other", async () => {
    const storage = new MemoryStorage();
    const first = new DemoInventoryRepository(storage);
    const second = new DemoInventoryRepository(storage);
    await Promise.all([first.load(), second.load()]);

    await first.addModel("Runner");
    await second.addColor("White");

    const reloaded = await new DemoInventoryRepository(storage).load();
    expect(reloaded.models).toContainEqual(expect.objectContaining({ name: "Runner" }));
    expect(reloaded.colors).toContainEqual(expect.objectContaining({ name: "White" }));
  });

  it("re-reads storage on load after another repository posts a document", async () => {
    const storage = new MemoryStorage();
    const reader = new DemoInventoryRepository(storage);
    const writer = new DemoInventoryRepository(storage);
    const initial = await reader.load();
    const variant = initial.variants[0];

    const document = await writer.postDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      reference: "PO-20260722-000001",
      lines: [{ variantId: variant.id, size: variant.size, quantity: 5 }],
    });

    const refreshed = await reader.load();
    expect(refreshed.documents).toContainEqual(document);
    expect(refreshed.balances[variant.id]).toBe(initial.balances[variant.id] + 5);
  });

  it("uses injected random identities for documents and lines", async () => {
    const ids = ["document-random", "line-random"];
    const repository = new DemoInventoryRepository(new MemoryStorage(), { createId: () => ids.shift()! });
    const snapshot = await repository.load();
    const variant = snapshot.variants[0];

    const posted = await repository.postDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      lines: [{ variantId: variant.id, size: variant.size, quantity: 1 }],
    });

    expect(posted.id).toBe("document-random");
    expect(posted.lines[0].id).toBe("line-random");
  });

  it("clears every positive balance in one audited adjustment and keeps the catalog", async () => {
    const repository = new DemoInventoryRepository(new MemoryStorage());
    const seeded = await repository.load();
    const firstVariant = seeded.variants[0];
    await repository.postDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-21",
      reference: "BEFORE-CLEAR",
      lines: [{ variantId: firstVariant.id, size: firstVariant.size, quantity: 1 }],
    });
    const before = await repository.load();
    const totalBefore = Object.values(before.balances).reduce((total, quantity) => total + quantity, 0);

    const cleared = await repository.clearStock("2026-07-22");
    const after = await repository.load();

    expect(cleared).toMatchObject({
      type: "ADJUSTMENT",
      effectiveDate: "2026-07-22",
      reference: "CLEAR-STOCK",
      note: "ล้างสต๊อกทั้งคลัง",
    });
    expect(cleared?.lines.reduce((total, line) => total + line.delta, 0)).toBe(-totalBefore);
    expect(cleared?.lines.every((line) => line.delta < 0)).toBe(true);
    expect(Object.values(after.balances).every((quantity) => quantity === 0)).toBe(true);
    expect(after.models).toEqual(before.models);
    expect(after.colors).toEqual(before.colors);
    expect(after.variants).toEqual(before.variants);
    expect(after.documents.slice(0, -1)).toEqual(before.documents);
    expect(after.documents.at(-1)).toEqual(cleared);

    await expect(repository.clearStock("2026-07-22")).resolves.toBeNull();
    expect((await repository.load()).documents).toEqual(after.documents);
  });

  it("serializes cross-repository mutations and advances a persisted snapshot revision", async () => {
    const storage = new MemoryStorage();
    const lockManager = new SerialLockManager();
    const first = new DemoInventoryRepository(storage, { lockManager });
    const second = new DemoInventoryRepository(storage, { lockManager });
    await Promise.all([first.load(), second.load()]);

    await Promise.all([first.addModel("Runner"), second.addColor("White")]);

    const persisted = JSON.parse(storage.getItem(INVENTORY_STORAGE_KEY)!) as { revision?: number };
    expect(lockManager.calls).toBe(2);
    expect(lockManager.maxActive).toBe(1);
    expect(persisted.revision).toBe(2);
    expect((await first.load()).models).toContainEqual(expect.objectContaining({ name: "Runner" }));
    expect((await second.load()).colors).toContainEqual(expect.objectContaining({ name: "White" }));
  });

  it("invalidates its cache and notifies subscribers when another tab changes storage", async () => {
    const storage = new MemoryStorage();
    const storageEvents = new EventTarget();
    const reader = new DemoInventoryRepository(storage, { storageEventTarget: storageEvents });
    const writer = new DemoInventoryRepository(storage);
    await reader.load();
    let notifications = 0;
    const unsubscribe = reader.subscribe(() => { notifications += 1; });

    await writer.addModel("Runner");
    storageEvents.dispatchEvent(new StorageEvent("storage", {
      key: INVENTORY_STORAGE_KEY,
      newValue: storage.getItem(INVENTORY_STORAGE_KEY),
    }));

    expect(notifications).toBe(1);
    expect((await reader.load()).models).toContainEqual(expect.objectContaining({ name: "Runner" }));

    unsubscribe();
    await writer.addColor("White");
    storageEvents.dispatchEvent(new StorageEvent("storage", { key: INVENTORY_STORAGE_KEY }));
    expect(notifications).toBe(1);
  });

  it("concurrently ensures one new variant tuple with an initialized zero balance", async () => {
    const storage = new MemoryStorage();
    const lockManager = new SerialLockManager();
    const firstIds = ["model-runner", "color-white", "variant-runner-white-44"];
    const first = new DemoInventoryRepository(storage, {
      createId: () => firstIds.shift()!,
      lockManager,
    });
    const second = new DemoInventoryRepository(storage, {
      createId: () => "variant-duplicate",
      lockManager,
    });
    const model = await first.addModel("Runner");
    const color = await first.addColor("White");

    const [created, concurrent] = await Promise.all([
      first.ensureVariant(model.id, color.id, 44.5),
      second.ensureVariant(model.id, color.id, 44.5),
    ]);

    const snapshot = await new DemoInventoryRepository(storage).load();
    expect(concurrent.id).toBe(created.id);
    expect(snapshot.variants.filter((variant) =>
      variant.modelId === model.id && variant.colorId === color.id && variant.size === 44.5,
    )).toEqual([created]);
    expect(snapshot.balances[created.id]).toBe(0);
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

  it("falls back from malformed nested version-one storage without overwriting it", async () => {
    const storage = new MemoryStorage();
    const malformed = {
      ...createSeedSnapshot(),
      documents: [{
        id: "doc-1",
        number: "STK-20260722-0001",
        type: "SALE",
        effectiveDate: "2026-07-22",
        reference: "",
        note: "",
        createdAt: "2026-07-22T10:00:00.000Z",
        lines: [{}],
      }],
    };
    const serialized = JSON.stringify(malformed);
    storage.setItem(INVENTORY_STORAGE_KEY, serialized);

    expect(await new DemoInventoryRepository(storage).load()).toEqual(createSeedSnapshot());
    expect(storage.getItem(INVENTORY_STORAGE_KEY)).toBe(serialized);

    await new DemoInventoryRepository(storage).addModel("Runner");
    expect(storage.getItem(INVENTORY_STORAGE_KEY)).not.toBe(serialized);
  });

  it.each([-1, 1.5, null])("rejects invalid persisted balance %p", async (balance) => {
    const storage = new MemoryStorage();
    const malformed = createSeedSnapshot();
    malformed.balances[malformed.variants[0].id] = balance as never;
    const serialized = JSON.stringify(malformed);
    storage.setItem(INVENTORY_STORAGE_KEY, serialized);

    expect(await new DemoInventoryRepository(storage).load()).toEqual(createSeedSnapshot());
    expect(storage.getItem(INVENTORY_STORAGE_KEY)).toBe(serialized);
  });
});
