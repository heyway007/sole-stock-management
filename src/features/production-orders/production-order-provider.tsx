"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useInventory } from "@/features/inventory/inventory-provider";
import {
  selectProductionOrderRepository,
  type ProductionOrderRepositoryFactoryOptions,
  type ProductionOrderRepositorySelection,
} from "./data/repository-factory";
import type { ProductionOrderRepository } from "./data/production-order-repository";
import type {
  ProductionOrder,
  ProductionOrderInput,
  ProductionOrderReceiptResult,
} from "./domain/types";

interface ProductionOrderContextValue {
  orders: ProductionOrder[] | null;
  loading: boolean;
  mode: "demo" | "supabase";
  error: string | null;
  warning: string | null;
  refresh(): Promise<void>;
  save(input: ProductionOrderInput): Promise<ProductionOrder>;
  cancel(orderId: string): Promise<ProductionOrder>;
  receive(orderId: string, effectiveDate: string): Promise<ProductionOrderReceiptResult>;
}

interface ProductionOrderProviderProps extends PropsWithChildren {
  factoryOptions?: ProductionOrderRepositoryFactoryOptions;
  repository?: ProductionOrderRepository;
}

const ProductionOrderContext = createContext<ProductionOrderContextValue | null>(null);
const LOAD_ERROR = "ไม่สามารถโหลดข้อมูลใบผลิตได้ กรุณาลองใหม่อีกครั้ง";
const SAVE_ERROR = "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง";
const RETAINED_LOAD_WARNING = "ไม่สามารถโหลดข้อมูลใบผลิตล่าสุดได้ กำลังแสดงข้อมูลเดิม กรุณาลองรีเฟรชอีกครั้ง";
const RETAINED_SAVE_WARNING = "บันทึกข้อมูลสำเร็จ แต่ไม่สามารถโหลดใบผลิตล่าสุดได้ กำลังแสดงข้อมูลเดิม กรุณาลองรีเฟรชอีกครั้ง";

function mutationError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "";
  return new Error(/[\u0E00-\u0E7F]/.test(message) ? message : SAVE_ERROR);
}

export function ProductionOrderProvider({
  children,
  factoryOptions,
  repository,
}: ProductionOrderProviderProps) {
  if (repository && process.env.NODE_ENV !== "test") {
    throw new Error("The ProductionOrderProvider repository prop is test-only; configure Supabase through the repository factory.");
  }
  const inventory = useInventory();
  const selectionRef = useRef<ProductionOrderRepositorySelection | null>(null);
  const ordersRef = useRef<ProductionOrder[] | null>(null);
  const [orders, setOrders] = useState<ProductionOrder[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"demo" | "supabase">("demo");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const getSelection = useCallback(() => {
    if (!selectionRef.current) {
      selectionRef.current = repository
        ? { repository, mode: "demo" }
        : selectProductionOrderRepository(factoryOptions);
    }
    return selectionRef.current;
  }, [factoryOptions, repository]);

  const refreshOrders = useCallback(async (failureMessage: string) => {
    if (!ordersRef.current) setLoading(true);
    setError(null);
    try {
      const selection = getSelection();
      setMode(selection.mode);
      const next = await selection.repository.load();
      ordersRef.current = next;
      setOrders(next);
      setWarning(null);
    } catch {
      if (ordersRef.current) setWarning(failureMessage);
      else setError(LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  }, [getSelection]);

  const refresh = useCallback(
    () => refreshOrders(RETAINED_LOAD_WARNING),
    [refreshOrders],
  );

  useEffect(() => {
    selectionRef.current = null;
    const selection = getSelection();
    const unsubscribe = selection.repository.subscribe?.(() => {
      void refreshOrders(RETAINED_LOAD_WARNING);
    });
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [factoryOptions, getSelection, refresh, refreshOrders, repository]);

  const runMutation = useCallback(async <T,>(
    mutation: (selectedRepository: ProductionOrderRepository) => Promise<T>,
  ): Promise<T> => {
    let result: T;
    try {
      result = await mutation(getSelection().repository);
    } catch (caught) {
      await refreshOrders(RETAINED_LOAD_WARNING);
      throw mutationError(caught);
    }
    await refreshOrders(RETAINED_SAVE_WARNING);
    return result;
  }, [getSelection, refreshOrders]);

  const save = useCallback(
    (input: ProductionOrderInput) => runMutation((selected) => selected.save(input)),
    [runMutation],
  );
  const cancel = useCallback(
    (orderId: string) => runMutation((selected) => selected.cancel(orderId)),
    [runMutation],
  );
  const receive = useCallback(async (orderId: string, effectiveDate: string) => {
    const result = await runMutation((selected) => selected.receive(orderId, effectiveDate));
    await inventory.refresh();
    return result;
  }, [inventory, runMutation]);

  return <ProductionOrderContext value={{
    orders,
    loading,
    mode,
    error,
    warning,
    refresh,
    save,
    cancel,
    receive,
  }}>{children}</ProductionOrderContext>;
}

export function useProductionOrders(): ProductionOrderContextValue {
  const context = useContext(ProductionOrderContext);
  if (!context) throw new Error("ต้องใช้ useProductionOrders ภายใน ProductionOrderProvider");
  return context;
}
