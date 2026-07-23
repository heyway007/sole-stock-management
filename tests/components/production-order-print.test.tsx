import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionOrderPrint } from "@/features/production-orders/components/production-order-print";
import type { ProductionOrder } from "@/features/production-orders/domain/types";

const openOrder: ProductionOrder = {
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
    { id: "line-1", variantId: "variant-1", lineNumber: 1, modelName: "Paris", colorName: "Black", size: "M", quantity: 4, unitPrice: 327 },
    { id: "line-2", variantId: "variant-2", lineNumber: 2, modelName: "Paris", colorName: "Black", size: "L", quantity: 6, unitPrice: 265 },
  ],
};

describe("ProductionOrderPrint", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders every required A4 field and calls browser print", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<ProductionOrderPrint order={openOrder} />);

    expect(screen.getByRole("heading", { name: "ใบผลิตออเดอร์" })).toBeInTheDocument();
    expect(screen.getByText("PO-20260722-000001")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "รายการสั่งผลิต" });
    expect(within(table).getAllByText("Paris")).toHaveLength(2);
    expect(within(table).getByText("M")).toBeInTheDocument();
    expect(table).not.toHaveTextContent("24–24.5 cm");
    expect(screen.getByText("รวมทั้งหมด 10 คู่")).toBeInTheDocument();
    expect(screen.getByText("ส่งก่อนเที่ยง")).toBeInTheDocument();
    expect(screen.getByText("ผู้สั่งผลิต")).toBeInTheDocument();
    expect(screen.getByText("ผู้รับออเดอร์")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "พิมพ์ใบผลิต" }));
    expect(print).toHaveBeenCalledOnce();
  });
});
