"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { DemoInventoryRepository } from "./data/demo-repository";
import { createInventoryRepository, isSupabaseInventoryConfigured } from "./data/repository-factory";
import type { InventoryRepository } from "./data/inventory-repository";
import type { InventorySnapshot, StockDocument, StockDocumentInput } from "./domain/types";

interface InventoryContextValue {
  snapshot: InventorySnapshot | null;
  loading: boolean;
  mode: "demo" | "supabase";
  error: string | null;
  refresh(): Promise<void>;
  postDocument(input: StockDocumentInput): Promise<StockDocument>;
  saveLowStockThreshold(variantId: string, threshold: number): Promise<void>;
  catalog: Pick<InventoryRepository,
    "addModel" | "renameModel" | "setModelActive" |
    "addColor" | "renameColor" | "setColorActive">;
}

interface InventoryProviderProps extends PropsWithChildren {
  repository?: InventoryRepository;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);
const LOAD_ERROR = "ไม่สามารถโหลดข้อมูลสต็อกได้ กรุณาลองใหม่อีกครั้ง";
const SAVE_ERROR = "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง";

function modeFor(repository: InventoryRepository): "demo" | "supabase" {
  return repository instanceof DemoInventoryRepository || !isSupabaseInventoryConfigured() ? "demo" : "supabase";
}

export function InventoryProvider({ children, repository: repositoryProp }: InventoryProviderProps) {
  const repositoryRef = useRef<InventoryRepository | null>(repositoryProp ?? null);
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"demo" | "supabase">("demo");
  const [error, setError] = useState<string | null>(null);

  const getRepository = useCallback(() => {
    if (!repositoryRef.current) repositoryRef.current = createInventoryRepository();
    return repositoryRef.current;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const repository = getRepository();
      setSnapshot(await repository.load());
      setMode(modeFor(repository));
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  }, [getRepository]);

  useEffect(() => {
    repositoryRef.current = repositoryProp ?? null;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refresh();
    });
    return () => { cancelled = true; };
  }, [repositoryProp, refresh]);

  const runMutation = useCallback(async <T,>(mutation: (repository: InventoryRepository) => Promise<T>): Promise<T> => {
    try {
      const result = await mutation(getRepository());
      await refresh();
      return result;
    } catch {
      setError(SAVE_ERROR);
      throw new Error(SAVE_ERROR);
    }
  }, [getRepository, refresh]);

  const postDocument = useCallback(
    (input: StockDocumentInput) => runMutation((repository) => repository.postDocument(input)),
    [runMutation],
  );
  const saveLowStockThreshold = useCallback(
    (variantId: string, threshold: number) => runMutation((repository) => repository.saveLowStockThreshold(variantId, threshold)),
    [runMutation],
  );
  const catalog = useMemo(() => ({
    addModel: (name: string) => runMutation((repository) => repository.addModel(name)),
    renameModel: (id: string, name: string) => runMutation((repository) => repository.renameModel(id, name)),
    setModelActive: (id: string, active: boolean) => runMutation((repository) => repository.setModelActive(id, active)),
    addColor: (name: string) => runMutation((repository) => repository.addColor(name)),
    renameColor: (id: string, name: string) => runMutation((repository) => repository.renameColor(id, name)),
    setColorActive: (id: string, active: boolean) => runMutation((repository) => repository.setColorActive(id, active)),
  }), [runMutation]);

  return <InventoryContext value={{ snapshot, loading, mode, error, refresh, postDocument, saveLowStockThreshold, catalog }}>{children}</InventoryContext>;
}

export function useInventory(): InventoryContextValue {
  const context = useContext(InventoryContext);
  if (!context) throw new Error("ต้องใช้ useInventory ภายใน InventoryProvider");
  return context;
}
