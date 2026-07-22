import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionOrderDetailPageContent } from "@/app/production-orders/[id]/page";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import type { ProductionOrderRepository } from "@/features/production-orders/data/production-order-repository";
import type { ProductionOrder, ProductionOrderReceiptResult } from "@/features/production-orders/domain/types";
import { InventoryProvider } from "@/features/inventory/inventory-provider";
import { ProductionOrderProvider } from "@/features/production-orders/production-order-provider";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "order-1" }) }));

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const order: ProductionOrder = {
  id: "order-1",
  number: "PO-20260722-000001",
  orderDate: "2026-07-22",
  expectedDate: "2026-08-05",
  note: "ส่งก่อนเที่ยง",
  status: "OPEN",
  receivedDocumentId: null,
  createdAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
  receivedAt: null,
  cancelledAt: null,
  lines: [
    { id: "line-1", variantId: "paris-black-38", lineNumber: 1, modelName: "Paris", colorName: "Black", size: 38, quantity: 4 },
    { id: "line-2", variantId: "paris-black-38.5", lineNumber: 2, modelName: "Paris", colorName: "Black", size: 38.5, quantity: 6 },
  ],
};

class StaticRepository implements ProductionOrderRepository {
  async load() { return [structuredClone(order)]; }
  async save(): Promise<ProductionOrder> { throw new Error("not used"); }
  async cancel(): Promise<ProductionOrder> { throw new Error("not used"); }
  async receive(): Promise<ProductionOrderReceiptResult> { throw new Error("not used"); }
}

describe("ProductionOrderDetailPage", () => {
  afterEach(cleanup);

  it("renders header metadata, responsive lines, totals, note, and open actions", async () => {
    const storage = new MemoryStorage();
    render(
      <InventoryProvider repository={new DemoInventoryRepository(storage)}>
        <ProductionOrderProvider repository={new StaticRepository()}>
          <ProductionOrderDetailPageContent />
        </ProductionOrderProvider>
      </InventoryProvider>,
    );

    expect(await screen.findByRole("heading", { name: "PO-20260722-000001" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "รายการในใบผลิต" });
    expect(within(table).getByText("38.5")).toBeInTheDocument();
    expect(screen.getByText("รวม 2 รายการ · 10 คู่")).toBeInTheDocument();
    expect(screen.getByText("ส่งก่อนเที่ยง")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "พิมพ์ใบผลิต" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับเข้าสต๊อก" })).toBeInTheDocument();
  });
});
