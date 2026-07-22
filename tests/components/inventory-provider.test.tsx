import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

function InventoryState() {
  const inventory = useInventory();
  const variant = inventory.snapshot?.variants[0];
  const quantity = variant ? inventory.snapshot?.balances[variant.id] : null;

  return <>
    <p>{inventory.loading ? "กำลังโหลด" : "พร้อมใช้งาน"}</p>
    <p>โหมด: {inventory.mode}</p>
    <p>จำนวน: {quantity ?? "-"}</p>
    {inventory.error && <p role="alert">{inventory.error}</p>}
    {variant && <button onClick={() => void inventory.postDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      lines: [{ variantId: variant.id, size: variant.size, quantity: 2 }],
    }).catch(() => undefined)}>รับสินค้า</button>}
  </>;
}

describe("InventoryProvider", () => {
  afterEach(cleanup);

  it("shows loading until the injected repository resolves", async () => {
    const repository = new DelayedDemoRepository(new MemoryStorage());
    render(<InventoryProvider repository={repository}><InventoryState /></InventoryProvider>);

    expect(screen.getByText("กำลังโหลด")).toBeInTheDocument();
    repository.release();
    expect(await screen.findByText("พร้อมใช้งาน")).toBeInTheDocument();
  });

  it("refreshes the snapshot after a successful document post", async () => {
    render(<InventoryProvider repository={new DemoInventoryRepository(new MemoryStorage())}><InventoryState /></InventoryProvider>);

    await screen.findByText("จำนวน: 2");
    fireEvent.click(screen.getByRole("button", { name: "รับสินค้า" }));
    expect(await screen.findByText("จำนวน: 4")).toBeInTheDocument();
  });

  it("keeps the existing snapshot and presents Thai action copy after a repository error", async () => {
    const repository = new FailingDemoRepository(new MemoryStorage());
    render(<InventoryProvider repository={repository}><InventoryState /></InventoryProvider>);

    await screen.findByText("จำนวน: 2");
    repository.failPosts = true;
    fireEvent.click(screen.getByRole("button", { name: "รับสินค้า" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
    expect(screen.getByText("จำนวน: 2")).toBeInTheDocument();
  });

  it("indicates demo mode for an injected in-memory repository", async () => {
    render(<InventoryProvider repository={new DemoInventoryRepository(new MemoryStorage())}><InventoryState /></InventoryProvider>);

    await waitFor(() => expect(screen.getByText("โหมด: demo")).toBeInTheDocument());
  });
});
