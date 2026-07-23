import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import type { ProductionOrderRepository } from "@/features/production-orders/data/production-order-repository";
import type {
  ProductionOrder,
  ProductionOrderReceiptResult,
} from "@/features/production-orders/domain/types";
import {
  ProductionOrderProvider,
  useProductionOrders,
} from "@/features/production-orders/production-order-provider";
import { InventoryProvider } from "@/features/inventory/inventory-provider";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const openOrder: ProductionOrder = {
  id: "order-1",
  number: "PO-20260722-000001",
  orderDate: "2026-07-22",
  expectedDate: "2026-08-05",
  note: "",
  status: "OPEN",
  receivedDocumentId: null,
  createdAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
  receivedAt: null,
  cancelledAt: null,
  lines: [{
    id: "line-1",
    variantId: "paris-black-38",
    lineNumber: 1,
    modelName: "Paris",
    colorName: "Black",
    size: "M",
    quantity: 4,
    unitPrice: 327,
  }],
};

class FakeProductionOrderRepository implements ProductionOrderRepository {
  orders = [openOrder];
  async load() { return structuredClone(this.orders); }
  async save() { return structuredClone(this.orders[0]); }
  async cancel(orderId: string) {
    const cancelled: ProductionOrder = {
      ...this.orders.find((order) => order.id === orderId)!,
      status: "CANCELLED",
      cancelledAt: "2026-07-22T11:00:00.000Z",
    };
    this.orders = [cancelled];
    return structuredClone(cancelled);
  }
  async receive(orderId: string): Promise<ProductionOrderReceiptResult> {
    const received: ProductionOrder = {
      ...this.orders.find((order) => order.id === orderId)!,
      status: "RECEIVED",
      receivedDocumentId: "document-1",
      receivedAt: "2026-07-22T11:00:00.000Z",
    };
    this.orders = [received];
    return {
      order: structuredClone(received),
      document: {
        id: "document-1",
        number: "STK-20260722-0001",
        type: "RECEIPT",
        effectiveDate: "2026-07-22",
        reference: received.number,
        note: "",
        createdAt: "2026-07-22T11:00:00.000Z",
        lines: [{ id: "document-line-1", variantId: "paris-black-38", delta: 4 }],
      },
    };
  }
}

class CountingInventoryRepository extends DemoInventoryRepository {
  loadCount = 0;
  override async load() {
    this.loadCount += 1;
    return super.load();
  }
}

function ProductionState() {
  const production = useProductionOrders();
  const order = production.orders?.[0];
  if (production.loading && !order) return <p>กำลังโหลดใบผลิต</p>;
  return <>
    <p>สถานะ: {order?.status ?? "-"}</p>
    <button onClick={() => void production.save({
      orderDate: "2026-07-22",
      expectedDate: "2026-08-05",
      note: "",
      lines: [{ variantId: "paris-black-38", quantity: 4, unitPrice: 327 }],
    })}>บันทึก</button>
    <button onClick={() => void production.receive("order-1", "2026-07-22")}>รับเข้า</button>
  </>;
}

describe("ProductionOrderProvider", () => {
  afterEach(cleanup);

  it("refreshes production orders after save and inventory only after receipt", async () => {
    const storage = new MemoryStorage();
    const inventory = new CountingInventoryRepository(storage);
    const production = new FakeProductionOrderRepository();
    render(
      <InventoryProvider repository={inventory}>
        <ProductionOrderProvider repository={production}>
          <ProductionState />
        </ProductionOrderProvider>
      </InventoryProvider>,
    );

    expect(await screen.findByText("สถานะ: OPEN")).toBeInTheDocument();
    const baselineLoads = inventory.loadCount;
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText("สถานะ: OPEN")).toBeInTheDocument();
    expect(inventory.loadCount).toBe(baselineLoads);

    fireEvent.click(screen.getByRole("button", { name: "รับเข้า" }));
    expect(await screen.findByText("สถานะ: RECEIVED")).toBeInTheDocument();
    expect(inventory.loadCount).toBeGreaterThan(baselineLoads);
  });
});
