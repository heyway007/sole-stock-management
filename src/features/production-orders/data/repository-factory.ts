import type { InventoryRepository } from "@/features/inventory/data/inventory-repository";
import {
  isSupabaseInventoryConfigured,
  selectInventoryRepository,
} from "@/features/inventory/data/repository-factory";
import { DemoProductionOrderRepository } from "./demo-production-order-repository";
import type { ProductionOrderRepository } from "./production-order-repository";
import { SupabaseProductionOrderRepository } from "./supabase-production-order-repository";

export interface ProductionOrderRepositoryFactoryOptions {
  environment?: Record<string, string | undefined>;
  storage?: Storage;
  inventoryRepository?: InventoryRepository;
  createSupabaseRepository?: () => ProductionOrderRepository;
  createDemoRepository?: (
    storage: Storage,
    inventory: InventoryRepository,
  ) => ProductionOrderRepository;
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

  const storage = options.storage
    ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!storage) throw new Error("ไม่สามารถเปิดพื้นที่จัดเก็บข้อมูลในเบราว์เซอร์ได้");
  const inventory = options.inventoryRepository
    ?? selectInventoryRepository({ environment, storage }).repository;
  const repository = options.createDemoRepository?.(storage, inventory)
    ?? new DemoProductionOrderRepository(storage, inventory);
  return { repository, mode: "demo" };
}

export function createProductionOrderRepository(
  options: ProductionOrderRepositoryFactoryOptions = {},
): ProductionOrderRepository {
  return selectProductionOrderRepository(options).repository;
}
