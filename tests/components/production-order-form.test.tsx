import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import { DemoProductionOrderRepository } from "@/features/production-orders/data/demo-production-order-repository";
import { ProductionOrderForm } from "@/features/production-orders/components/production-order-form";
import type { ProductionOrder } from "@/features/production-orders/domain/types";
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

function renderForm(order?: ProductionOrder) {
  const storage = new MemoryStorage();
  const inventory = new DemoInventoryRepository(storage);
  const production = new DemoProductionOrderRepository(storage, inventory);
  const onSaved = vi.fn();
  render(
    <InventoryProvider repository={inventory}>
      <ProductionOrderProvider repository={production}>
        <ProductionOrderForm order={order} onSaved={onSaved} />
      </ProductionOrderProvider>
    </InventoryProvider>,
  );
  return { onSaved };
}

async function selectParisBlackM(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByRole("combobox", { name: "รุ่นสินค้า รายการ 1" }), "paris");
  await user.selectOptions(screen.getByRole("combobox", { name: "สีสินค้า รายการ 1" }), "black");
  await user.selectOptions(screen.getByRole("combobox", { name: "ไซซ์ รายการ 1" }), "M");
}

describe("ProductionOrderForm", () => {
  afterEach(cleanup);

  it("creates a manual model, color, size, and quantity line", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderForm();

    expect(await screen.findByRole("heading", { name: "สร้างใบผลิตออเดอร์" })).toBeInTheDocument();
    expect(screen.getByText("ระบบจะสร้างเลขที่ใบผลิตให้อัตโนมัติหลังบันทึก")).toBeInTheDocument();
    const orderDate = screen.getByLabelText("วันที่สั่งผลิต");
    expect(screen.getByLabelText("วันที่กำหนดรับ")).toHaveValue((orderDate as HTMLInputElement).value);

    await selectParisBlackM(user);
    await user.type(screen.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" }), "4");
    expect(screen.getByText("รวม 1 รายการ · 4 คู่")).toBeInTheDocument();
    expect(screen.queryByText(/คงเหลือ/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "บันทึกใบผลิต" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      status: "OPEN",
      lines: [expect.objectContaining({ variantId: "paris-black-m", quantity: 4 })],
    })));
  });

  it("keeps entered values and reports an invalid expected date before saving", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderForm();
    await screen.findByRole("heading", { name: "สร้างใบผลิตออเดอร์" });
    await selectParisBlackM(user);
    await user.type(screen.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" }), "4");
    const orderDate = screen.getByLabelText("วันที่สั่งผลิต") as HTMLInputElement;
    await user.clear(orderDate);
    await user.type(orderDate, "2026-07-22");
    const expectedDate = screen.getByLabelText("วันที่กำหนดรับ");
    await user.clear(expectedDate);
    await user.type(expectedDate, "2026-07-21");

    await user.click(screen.getByRole("button", { name: "บันทึกใบผลิต" }));
    expect(await screen.findByText("วันที่กำหนดรับต้องไม่ก่อนวันที่สั่งผลิต")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" })).toHaveValue(4);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("blocks editing a terminal order", async () => {
    renderForm({
      id: "order-cancelled",
      number: "PO-20260722-000002",
      orderDate: "2026-07-22",
      expectedDate: "2026-08-05",
      note: "",
      status: "CANCELLED",
      receivedDocumentId: null,
      createdAt: "2026-07-22T10:00:00.000Z",
      updatedAt: "2026-07-22T11:00:00.000Z",
      receivedAt: null,
      cancelledAt: "2026-07-22T11:00:00.000Z",
      lines: [{ id: "line-1", variantId: "paris-black-m", lineNumber: 1, modelName: "Paris", colorName: "Black", size: "M", quantity: 4 }],
    });

    expect(await screen.findByRole("heading", { name: "ไม่สามารถแก้ไขใบผลิตนี้ได้" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "กลับไปดูรายละเอียด" })).toHaveAttribute("href", "/production-orders/order-cancelled");
    expect(screen.queryByRole("button", { name: "บันทึกใบผลิต" })).not.toBeInTheDocument();
  });
});
