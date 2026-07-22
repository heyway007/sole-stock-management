import { describe, expect, it, vi } from "vitest";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import type { InventoryRepository } from "@/features/inventory/data/inventory-repository";
import { DemoProductionOrderRepository } from "@/features/production-orders/data/demo-production-order-repository";
import { selectProductionOrderRepository } from "@/features/production-orders/data/repository-factory";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const supabaseEnvironment = {
  NEXT_PUBLIC_INVENTORY_BACKEND: "supabase",
  NEXT_PUBLIC_SUPABASE_URL: "https://inventory.example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
};

describe("selectProductionOrderRepository", () => {
  it("uses demo persistence for incomplete configuration with injected storage and inventory", () => {
    const storage = new MemoryStorage();
    const inventory = new DemoInventoryRepository(storage);
    const createDemoRepository = vi.fn((selectedStorage: Storage, selectedInventory: InventoryRepository) =>
      new DemoProductionOrderRepository(selectedStorage, selectedInventory));

    const selection = selectProductionOrderRepository({
      environment: { NEXT_PUBLIC_INVENTORY_BACKEND: "supabase" },
      storage,
      inventoryRepository: inventory,
      createDemoRepository,
    });

    expect(selection.mode).toBe("demo");
    expect(selection.repository).toBeInstanceOf(DemoProductionOrderRepository);
    expect(createDemoRepository).toHaveBeenCalledWith(storage, inventory);
  });

  it("uses the injected Supabase adapter only when configuration is complete", () => {
    const storage = new MemoryStorage();
    const adapter = new DemoProductionOrderRepository(storage, new DemoInventoryRepository(storage));
    const selection = selectProductionOrderRepository({
      environment: supabaseEnvironment,
      storage,
      createSupabaseRepository: () => adapter,
    });

    expect(selection).toEqual({ repository: adapter, mode: "supabase" });
  });
});
