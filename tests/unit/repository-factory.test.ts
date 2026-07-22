import { describe, expect, it } from "vitest";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import { createInventoryRepository, selectInventoryRepository } from "@/features/inventory/data/repository-factory";
import { SupabaseInventoryRepository } from "@/features/inventory/data/supabase-repository";

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

describe("createInventoryRepository", () => {
  it.each([
    {},
    { NEXT_PUBLIC_INVENTORY_BACKEND: "supabase" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://inventory.example.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key" },
    { NEXT_PUBLIC_INVENTORY_BACKEND: "demo", NEXT_PUBLIC_SUPABASE_URL: "https://inventory.example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key" },
    { NEXT_PUBLIC_INVENTORY_BACKEND: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://inventory.example.supabase.co" },
    { NEXT_PUBLIC_INVENTORY_BACKEND: "supabase", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key" },
  ])("selects demo for incomplete or mismatched config %#", (environment) => {
    const selection = selectInventoryRepository({ environment, storage: new MemoryStorage() });

    expect(selection.mode).toBe("demo");
    expect(selection.repository).toBeInstanceOf(DemoInventoryRepository);
  });

  it("selects the concrete Supabase adapter when all three config values are present", () => {
    const selection = selectInventoryRepository({ environment: supabaseEnvironment, storage: new MemoryStorage() });

    expect(selection.mode).toBe("supabase");
    expect(selection.repository).toBeInstanceOf(SupabaseInventoryRepository);
  });

  it("selects the injected Supabase adapter only with all three config values", () => {
    const adapter = new DemoInventoryRepository(new MemoryStorage());
    const selection = selectInventoryRepository({
      environment: supabaseEnvironment,
      storage: new MemoryStorage(),
      createSupabaseRepository: () => adapter,
    });

    expect(selection).toEqual({ repository: adapter, mode: "supabase" });
  });

  it("returns the selected repository directly through the public factory", async () => {
    const repository = createInventoryRepository({ storage: new MemoryStorage() });

    expect(repository).toBeInstanceOf(DemoInventoryRepository);
    await expect(repository.load()).resolves.toMatchObject({ version: 1 });
  });
});
