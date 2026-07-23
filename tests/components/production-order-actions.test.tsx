const { fireMock, showValidationMessageMock, isLoadingMock } = vi.hoisted(() => ({
  fireMock: vi.fn(),
  showValidationMessageMock: vi.fn(),
  isLoadingMock: vi.fn(() => false),
}));

vi.mock("sweetalert2", () => ({
  default: {
    fire: fireMock,
    showValidationMessage: showValidationMessageMock,
    isLoading: isLoadingMock,
  },
}));

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionOrderActions } from "@/features/production-orders/components/production-order-actions";
import type { ProductionOrder, ProductionOrderReceiptResult } from "@/features/production-orders/domain/types";

type ConfirmationOptions<T> = {
  text: string;
  preConfirm(): Promise<T | false>;
  allowOutsideClick(): boolean;
  allowEscapeKey(): boolean;
};

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
  lines: [
    { id: "line-1", variantId: "variant-1", lineNumber: 1, modelName: "Paris", colorName: "Black", size: "M", quantity: 4, unitPrice: 327 },
    { id: "line-2", variantId: "variant-2", lineNumber: 2, modelName: "Paris", colorName: "Black", size: "L", quantity: 6, unitPrice: 265 },
  ],
};

const receiptResult: ProductionOrderReceiptResult = {
  order: { ...openOrder, status: "RECEIVED", receivedDocumentId: "document-1", receivedAt: "2026-07-22T11:00:00.000Z" },
  document: {
    id: "document-1",
    number: "STK-20260722-0001",
    type: "RECEIPT",
    effectiveDate: "2026-07-22",
    reference: openOrder.number,
    note: "",
    createdAt: "2026-07-22T11:00:00.000Z",
    lines: [{ id: "stock-line-1", variantId: "variant-1", delta: 4 }],
  },
};

describe("ProductionOrderActions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    isLoadingMock.mockReturnValue(false);
  });

  it("shows lifecycle actions only while an order is open", () => {
    const props = { onCancel: vi.fn(), onReceive: vi.fn() };
    const view = render(<ProductionOrderActions order={openOrder} {...props} />);
    expect(screen.getByRole("link", { name: "พิมพ์ใบผลิต" })).toHaveAttribute("href", "/production-orders/order-1/print");
    expect(screen.getByRole("link", { name: "แก้ไข" })).toHaveAttribute("href", "/production-orders/order-1/edit");
    expect(screen.getByRole("button", { name: "ยกเลิกใบผลิต" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รับเข้าสต๊อก" })).toBeInTheDocument();

    view.rerender(<ProductionOrderActions order={{ ...openOrder, status: "CANCELLED", cancelledAt: "2026-07-22T11:00:00.000Z" }} {...props} />);
    expect(screen.getByRole("link", { name: "พิมพ์ใบผลิต" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "แก้ไข" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยกเลิกใบผลิต|รับเข้าสต๊อก/ })).not.toBeInTheDocument();
  });

  it("confirms cancellation and reports success", async () => {
    const onCancel = vi.fn().mockResolvedValue({ ...openOrder, status: "CANCELLED" });
    fireMock
      .mockImplementationOnce(async (options: ConfirmationOptions<ProductionOrder>) => ({ isConfirmed: true, value: await options.preConfirm() }))
      .mockResolvedValueOnce({ isConfirmed: true });
    render(<ProductionOrderActions order={openOrder} onCancel={onCancel} onReceive={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกใบผลิต" }));
    await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
    expect(onCancel).toHaveBeenCalledWith("order-1");
    expect(fireMock.mock.calls[0][0].text).toContain("ยังคงอยู่ในประวัติ");
    expect(fireMock.mock.calls[1][0]).toMatchObject({ icon: "success", title: "ยกเลิกใบผลิตแล้ว" });
  });

  it("receives all pairs with loading guards and reports the stock document", async () => {
    isLoadingMock.mockReturnValue(true);
    const onReceive = vi.fn().mockResolvedValue(receiptResult);
    fireMock
      .mockImplementationOnce(async (options: ConfirmationOptions<ProductionOrderReceiptResult>) => ({ isConfirmed: true, value: await options.preConfirm() }))
      .mockResolvedValueOnce({ isConfirmed: true });
    render(<ProductionOrderActions order={openOrder} onCancel={vi.fn()} onReceive={onReceive} />);

    fireEvent.click(screen.getByRole("button", { name: "รับเข้าสต๊อก" }));
    await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
    const confirmation = fireMock.mock.calls[0][0] as ConfirmationOptions<ProductionOrderReceiptResult>;
    expect(confirmation.text).toContain("รับ 10 คู่ จากใบผลิต PO-20260722-000001 เข้าสต๊อกทั้งหมด");
    expect(confirmation.allowOutsideClick()).toBe(false);
    expect(confirmation.allowEscapeKey()).toBe(false);
    expect(onReceive).toHaveBeenCalledWith("order-1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(fireMock.mock.calls[1][0]).toMatchObject({
      icon: "success",
      title: "รับเข้าสต๊อกแล้ว",
      text: "เลขที่เอกสาร STK-20260722-0001",
    });
  });

  it("keeps the receipt confirmation open when the mutation fails", async () => {
    fireMock.mockResolvedValueOnce({ isConfirmed: false });
    render(<ProductionOrderActions order={openOrder} onCancel={vi.fn()} onReceive={vi.fn().mockRejectedValue(new Error("เชื่อมต่อไม่ได้"))} />);
    fireEvent.click(screen.getByRole("button", { name: "รับเข้าสต๊อก" }));
    await waitFor(() => expect(fireMock).toHaveBeenCalledOnce());
    const confirmation = fireMock.mock.calls[0][0] as ConfirmationOptions<ProductionOrderReceiptResult>;
    await act(async () => expect(confirmation.preConfirm()).resolves.toBe(false));
    expect(showValidationMessageMock).toHaveBeenCalledWith("เชื่อมต่อไม่ได้");
  });
});
