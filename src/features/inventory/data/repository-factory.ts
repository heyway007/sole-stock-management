import { DemoInventoryRepository } from "./demo-repository";
import type { InventoryRepository } from "./inventory-repository";

export interface RepositoryFactoryOptions {
  environment?: Record<string, string | undefined>;
  storage?: Storage;
  supabaseRepository?: InventoryRepository;
  createSupabaseRepository?: () => InventoryRepository;
}

function environmentFor(options: RepositoryFactoryOptions): Record<string, string | undefined> {
  return options.environment ?? {
    NEXT_PUBLIC_INVENTORY_BACKEND: process.env.NEXT_PUBLIC_INVENTORY_BACKEND,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function isSupabaseInventoryConfigured(options: RepositoryFactoryOptions = {}): boolean {
  const environment = environmentFor(options);
  return environment.NEXT_PUBLIC_INVENTORY_BACKEND === "supabase"
    && Boolean(environment.NEXT_PUBLIC_SUPABASE_URL)
    && Boolean(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function createInventoryRepository(options: RepositoryFactoryOptions = {}): InventoryRepository {
  if (isSupabaseInventoryConfigured(options)) {
    if (options.supabaseRepository) return options.supabaseRepository;
    if (options.createSupabaseRepository) return options.createSupabaseRepository();
  }

  const storage = options.storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!storage) throw new Error("ไม่สามารถเปิดพื้นที่จัดเก็บข้อมูลในเบราว์เซอร์ได้");
  return new DemoInventoryRepository(storage);
}
