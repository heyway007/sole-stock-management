"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { selectInventoryRepository, type InventoryRepositorySelection, type RepositoryFactoryOptions } from "./data/repository-factory";
import type { InventoryRepository } from "./data/inventory-repository";
import type { InventorySnapshot, ProductVariant, StockDocument, StockDocumentInput } from "./domain/types";

interface InventoryContextValue {
  snapshot: InventorySnapshot | null;
  loading: boolean;
  mode: "demo" | "supabase";
  error: string | null;
  warning: string | null;
  refresh(): Promise<void>;
  postDocument(input: StockDocumentInput): Promise<StockDocument>;
  ensureVariant(modelId: string, colorId: string, size: number): Promise<ProductVariant>;
  saveLowStockThreshold(variantId: string, threshold: number): Promise<void>;
  catalog: Pick<InventoryRepository,
    "addModel" | "renameModel" | "setModelActive" |
    "addColor" | "renameColor" | "setColorActive">;
}

interface InventoryProviderProps extends PropsWithChildren {
  factoryOptions?: RepositoryFactoryOptions;
  repository?: InventoryRepository;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);
const LOAD_ERROR = "ไม่สามารถโหลดข้อมูลสต็อกได้ กรุณาลองใหม่อีกครั้ง";
const SAVE_ERROR = "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง";
const REFRESH_WARNING = "บันทึกข้อมูลสำเร็จ แต่ไม่สามารถโหลดข้อมูลล่าสุดได้ กรุณาลองรีเฟรชอีกครั้ง";
const RETAINED_REFRESH_WARNING = "บันทึกข้อมูลสำเร็จ แต่ไม่สามารถโหลดข้อมูลล่าสุดได้ กำลังแสดงข้อมูลเดิม กรุณาลองรีเฟรชอีกครั้ง";
const RETAINED_LOAD_WARNING = "ไม่สามารถโหลดข้อมูลล่าสุดได้ กำลังแสดงข้อมูลเดิม กรุณาลองรีเฟรชอีกครั้ง";

function mutationError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "";
  return new Error(/[\u0E00-\u0E7F]/.test(message) ? message : SAVE_ERROR);
}

export function InventoryProvider({ children, factoryOptions, repository }: InventoryProviderProps) {
  if (repository && process.env.NODE_ENV !== "test") {
    throw new Error("The InventoryProvider repository prop is test-only; configure Supabase through the repository factory.");
  }
  const selectionRef = useRef<InventoryRepositorySelection | null>(null);
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const snapshotRef = useRef<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"demo" | "supabase">("demo");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const getSelection = useCallback(() => {
    if (!selectionRef.current) {
      selectionRef.current = repository
        ? { repository, mode: "demo" }
        : selectInventoryRepository(factoryOptions);
    }
    return selectionRef.current;
  }, [factoryOptions, repository]);

  const refreshSnapshot = useCallback(async (failureMessage: string) => {
    if (!snapshotRef.current) setLoading(true);
    setError(null);
    try {
      const selection = getSelection();
      setMode(selection.mode);
      const next = await selection.repository.load();
      snapshotRef.current = next;
      setSnapshot(next);
      setWarning(null);
    } catch {
      if (snapshotRef.current) {
        setWarning(failureMessage === REFRESH_WARNING ? RETAINED_REFRESH_WARNING : RETAINED_LOAD_WARNING);
      } else {
        setError(failureMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [getSelection]);

  const refresh = useCallback(
    () => refreshSnapshot(LOAD_ERROR),
    [refreshSnapshot],
  );

  useEffect(() => {
    selectionRef.current = null;
    const selection = getSelection();
    const unsubscribe = selection.repository.subscribe?.(() => {
      void refreshSnapshot(LOAD_ERROR);
    });
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [factoryOptions, getSelection, refresh, refreshSnapshot, repository]);

  const runMutation = useCallback(async <T,>(mutation: (repository: InventoryRepository) => Promise<T>): Promise<T> => {
    let result: T;
    try {
      result = await mutation(getSelection().repository);
    } catch (error) {
      throw mutationError(error);
    }
    await refreshSnapshot(REFRESH_WARNING);
    return result;
  }, [getSelection, refreshSnapshot]);

  const postDocument = useCallback(
    (input: StockDocumentInput) => runMutation((repository) => repository.postDocument(input)),
    [runMutation],
  );
  const ensureVariant = useCallback(
    (modelId: string, colorId: string, size: number) =>
      runMutation((repository) => repository.ensureVariant(modelId, colorId, size)),
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

  return <InventoryContext value={{ snapshot, loading, mode, error, warning, refresh, postDocument, ensureVariant, saveLowStockThreshold, catalog }}>{children}</InventoryContext>;
}

export function useInventory(): InventoryContextValue {
  const context = useContext(InventoryContext);
  if (!context) throw new Error("ต้องใช้ useInventory ภายใน InventoryProvider");
  return context;
}
