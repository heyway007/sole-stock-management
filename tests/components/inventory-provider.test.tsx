import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Dashboard } from "@/app/page";
import { CatalogPageContent } from "@/app/catalog/page";
import { InventoryPageContent } from "@/app/inventory/page";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import type { StockDocumentInput } from "@/features/inventory/domain/types";
import { InventoryProvider, useInventory } from "@/features/inventory/inventory-provider";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

class DelayedDemoRepository extends DemoInventoryRepository {
  private releaseLoad!: () => void;
  private readonly loading = new Promise<void>((resolve) => { this.releaseLoad = resolve; });

  release() { this.releaseLoad(); }

  override async load() {
    await this.loading;
    return super.load();
  }
}

class FailingDemoRepository extends DemoInventoryRepository {
  failPosts = false;

  override async postDocument(input: StockDocumentInput) {
    if (this.failPosts) throw new Error("connection failed");
    return super.postDocument(input);
  }
}

class ConfirmedPostRefreshFailsRepository extends DemoInventoryRepository {
  private loadCount = 0;

  override async load() {
    this.loadCount += 1;
    if (this.loadCount > 1) throw new Error("refresh failed");
    return super.load();
  }
}

class SubscribableDemoRepository extends DemoInventoryRepository {
  private readonly listeners = new Set<() => void>();

  override subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyExternalChange() {
    for (const listener of this.listeners) listener();
  }
}

function InventoryState() {
  const inventory = useInventory();
  const [actionError, setActionError] = useState<string | null>(null);
  const variant = inventory.snapshot?.variants[0];
  const quantity = variant ? inventory.snapshot?.balances[variant.id] : null;

  return <>
    <p>{inventory.loading ? "กำลังโหลด" : "พร้อมใช้งาน"}</p>
    <p>โหมด: {inventory.mode}</p>
    <p>จำนวน: {quantity ?? "-"}</p>
    {inventory.error && <p role="alert">{inventory.error}</p>}
    {inventory.warning && <p role="alert">{inventory.warning}</p>}
    {actionError && <p role="alert">{actionError}</p>}
    {inventory.snapshot && (
      <button onClick={() => void inventory.clearStock("2026-07-22")}>
        ล้างสต๊อกทดสอบ
      </button>
    )}
    {variant && <button onClick={() => void inventory.postDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      lines: [{ variantId: variant.id, size: variant.size, quantity: 2 }],
    }).catch((error: unknown) => setActionError(error instanceof Error ? error.message : "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง"))}>รับสินค้า</button>}
  </>;
}

function ConfirmedPostState() {
  const inventory = useInventory();
  const [result, setResult] = useState("-");
  const variant = inventory.snapshot?.variants[0];
  const quantity = variant ? inventory.snapshot?.balances[variant.id] : null;

  return <>
    <p>จำนวน: {quantity ?? "-"}</p>
    <p>ผลลัพธ์: {result}</p>
    {inventory.error && <p role="alert">{inventory.error}</p>}
    {inventory.warning && <p role="alert">{inventory.warning}</p>}
    {variant && <button onClick={() => void inventory.postDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      lines: [{ variantId: variant.id, size: variant.size, quantity: 2 }],
    }).then((document) => setResult(document.number)).catch(() => setResult("rejected"))}>รับสินค้าแบบยืนยันผล</button>}
  </>;
}

describe("InventoryProvider", () => {
  afterEach(cleanup);

  it("accepts a direct in-memory repository only in tests and labels it demo", async () => {
    const repository = new DelayedDemoRepository(new MemoryStorage());
    render(<InventoryProvider repository={repository}><InventoryState /></InventoryProvider>);

    expect(screen.getByText("กำลังโหลด")).toBeInTheDocument();
    repository.release();
    expect(await screen.findByText("พร้อมใช้งาน")).toBeInTheDocument();
    expect(screen.getByText("โหมด: demo")).toBeInTheDocument();
  });

  it("refreshes the snapshot after a successful document post", async () => {
    render(<InventoryProvider factoryOptions={{ storage: new MemoryStorage() }}><InventoryState /></InventoryProvider>);

    await screen.findByText("จำนวน: 2");
    fireEvent.click(screen.getByRole("button", { name: "รับสินค้า" }));
    expect(await screen.findByText("จำนวน: 4")).toBeInTheDocument();
  });

  it("refreshes the snapshot after clearing all stock", async () => {
    render(<InventoryProvider factoryOptions={{ storage: new MemoryStorage() }}><InventoryState /></InventoryProvider>);

    await screen.findByText("จำนวน: 2");
    fireEvent.click(screen.getByRole("button", { name: "ล้างสต๊อกทดสอบ" }));
    expect(await screen.findByText("จำนวน: 0")).toBeInTheDocument();
  });

  it("refreshes its retained snapshot when the repository reports a cross-tab change", async () => {
    const repository = new SubscribableDemoRepository(new MemoryStorage());
    render(<InventoryProvider repository={repository}><InventoryState /></InventoryProvider>);
    await screen.findByText("จำนวน: 2");
    const snapshot = await repository.load();
    const variant = snapshot.variants[0];

    await repository.postDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      lines: [{ variantId: variant.id, size: variant.size, quantity: 1 }],
    });
    act(() => repository.notifyExternalChange());

    expect(await screen.findByText("จำนวน: 3")).toBeInTheDocument();
  });

  it("returns a confirmed post when the following refresh fails and shows a Thai refresh warning", async () => {
    const repository = new ConfirmedPostRefreshFailsRepository(new MemoryStorage());
    const view = render(<InventoryProvider repository={repository}><ConfirmedPostState /></InventoryProvider>);

    await screen.findByText("จำนวน: 2");
    fireEvent.click(screen.getByRole("button", { name: "รับสินค้าแบบยืนยันผล" }));

    expect(await screen.findByText("ผลลัพธ์: STK-20260722-0001")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("บันทึกข้อมูลสำเร็จ แต่ไม่สามารถโหลดข้อมูลล่าสุดได้ กำลังแสดงข้อมูลเดิม กรุณาลองรีเฟรชอีกครั้ง");
    expect(screen.getByText("จำนวน: 2")).toBeInTheDocument();

    view.rerender(<InventoryProvider repository={repository}><InventoryPageContent /></InventoryProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: "สินค้าคงคลัง" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("ข้อมูลอาจยังไม่เป็นปัจจุบัน");

    view.rerender(<InventoryProvider repository={repository}><CatalogPageContent /></InventoryProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: "จัดการแค็ตตาล็อก" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("ข้อมูลอาจยังไม่เป็นปัจจุบัน");
  });

  it("keeps the existing snapshot and presents Thai action copy after a repository error", async () => {
    const repository = new FailingDemoRepository(new MemoryStorage());
    render(<InventoryProvider factoryOptions={{
      environment: {
        NEXT_PUBLIC_INVENTORY_BACKEND: "supabase",
        NEXT_PUBLIC_SUPABASE_URL: "https://inventory.example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
      },
      createSupabaseRepository: () => repository,
    }}><InventoryState /></InventoryProvider>);

    await screen.findByText("จำนวน: 2");
    repository.failPosts = true;
    fireEvent.click(screen.getByRole("button", { name: "รับสินค้า" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
    expect(screen.getByText("จำนวน: 2")).toBeInTheDocument();
  });

  it("keeps retained data visible on unrelated routes after a caller-handled mutation failure", async () => {
    const repository = new FailingDemoRepository(new MemoryStorage());
    repository.failPosts = true;
    const view = render(<InventoryProvider repository={repository}><InventoryState /></InventoryProvider>);
    await screen.findByText("จำนวน: 2");

    fireEvent.click(screen.getByRole("button", { name: "รับสินค้า" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");

    view.rerender(<InventoryProvider repository={repository}><Dashboard /></InventoryProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: "ภาพรวมสต็อก" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "สรุปสต็อก" })).toBeInTheDocument();

    view.rerender(<InventoryProvider repository={repository}><InventoryPageContent /></InventoryProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: "สินค้าคงคลัง" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "สินค้าคงคลัง" })).toBeInTheDocument();
  });

  it("indicates demo mode for an injected in-memory repository", async () => {
    render(<InventoryProvider factoryOptions={{ storage: new MemoryStorage() }}><InventoryState /></InventoryProvider>);

    await waitFor(() => expect(screen.getByText("โหมด: demo")).toBeInTheDocument());
  });

  it("uses the factory-selected Supabase mode for a fully configured adapter", async () => {
    render(<InventoryProvider factoryOptions={{
      environment: {
        NEXT_PUBLIC_INVENTORY_BACKEND: "supabase",
        NEXT_PUBLIC_SUPABASE_URL: "https://inventory.example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
      },
      createSupabaseRepository: () => new DemoInventoryRepository(new MemoryStorage()),
    }}><InventoryState /></InventoryProvider>);

    expect(await screen.findByText("โหมด: supabase")).toBeInTheDocument();
  });

  it("keeps a partially configured adapter in demo mode", async () => {
    render(<InventoryProvider factoryOptions={{
      environment: {
        NEXT_PUBLIC_INVENTORY_BACKEND: "supabase",
        NEXT_PUBLIC_SUPABASE_URL: "https://inventory.example.supabase.co",
      },
      storage: new MemoryStorage(),
      createSupabaseRepository: () => {
        throw new Error("adapter must not be created");
      },
    }}><InventoryState /></InventoryProvider>);

    expect(await screen.findByText("โหมด: demo")).toBeInTheDocument();
  });

  it("refuses direct repository injection outside the test environment", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true, writable: true, enumerable: true });

    try {
      expect(() => render(<InventoryProvider repository={new DemoInventoryRepository(new MemoryStorage())}><InventoryState /></InventoryProvider>))
        .toThrow(/test-only/);
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", { value: originalNodeEnv, configurable: true, writable: true, enumerable: true });
    }
  });
});
