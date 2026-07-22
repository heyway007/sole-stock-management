import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ProductionOrdersPageContent } from "@/app/production-orders/page";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import type { ProductionOrderRepository } from "@/features/production-orders/data/production-order-repository";
import type {
  ProductionOrder,
  ProductionOrderReceiptResult,
} from "@/features/production-orders/domain/types";
import { InventoryProvider } from "@/features/inventory/inventory-provider";
import { ProductionOrderProvider } from "@/features/production-orders/production-order-provider";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const orders: ProductionOrder[] = [
  {
    id: "order-1",
    number: "PO-20260722-000001",
    orderDate: "2026-07-22",
    expectedDate: "2026-08-05",
    note: "รอบต้นเดือน",
    status: "OPEN",
    receivedDocumentId: null,
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
    receivedAt: null,
    cancelledAt: null,
    lines: [
      { id: "line-1", variantId: "variant-1", lineNumber: 1, modelName: "Paris", colorName: "Black", size: 38, quantity: 4 },
      { id: "line-2", variantId: "variant-2", lineNumber: 2, modelName: "Paris", colorName: "Black", size: 38.5, quantity: 6 },
    ],
  },
  {
    id: "order-2",
    number: "PO-20260722-000002",
    orderDate: "2026-07-22",
    expectedDate: "2026-08-10",
    note: "ยกเลิกแล้ว",
    status: "CANCELLED",
    receivedDocumentId: null,
    createdAt: "2026-07-22T11:00:00.000Z",
    updatedAt: "2026-07-22T11:10:00.000Z",
    receivedAt: null,
    cancelledAt: "2026-07-22T11:10:00.000Z",
    lines: [
      { id: "line-3", variantId: "variant-3", lineNumber: 1, modelName: "Weave", colorName: "Sand", size: 40, quantity: 2 },
    ],
  },
];

class StaticProductionOrderRepository implements ProductionOrderRepository {
  async load() { return structuredClone(orders); }
  async save(): Promise<ProductionOrder> { throw new Error("not used"); }
  async cancel(): Promise<ProductionOrder> { throw new Error("not used"); }
  async receive(): Promise<ProductionOrderReceiptResult> {
    throw new Error("not used");
  }
}

function renderList() {
  const storage = new MemoryStorage();
  render(
    <InventoryProvider repository={new DemoInventoryRepository(storage)}>
      <ProductionOrderProvider repository={new StaticProductionOrderRepository()}>
        <ProductionOrdersPageContent />
      </ProductionOrderProvider>
    </InventoryProvider>,
  );
}

describe("ProductionOrdersPage", () => {
  afterEach(cleanup);

  it("searches snapshotted lines, filters status, and displays pair totals", async () => {
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByRole("heading", { name: "ใบผลิตออเดอร์" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "สร้างใบผลิต" })).toHaveAttribute("href", "/production-orders/new");
    const table = screen.getByRole("table", { name: "รายการใบผลิตออเดอร์" });
    expect(within(table).getByText("PO-20260722-000001")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "ค้นหาใบผลิต" }), "Paris Black");
    expect(within(screen.getByRole("group", { name: "สรุปใบผลิต" })).getByText("10")).toBeInTheDocument();
    expect(within(table).queryByText("PO-20260722-000002")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "สถานะใบผลิต" }), "CANCELLED");
    expect(screen.getByRole("status", { name: "ไม่พบใบผลิต" })).toBeInTheDocument();
  });
});
