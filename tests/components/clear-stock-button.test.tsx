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
import { ClearStockButton } from "@/features/inventory/components/clear-stock-button";
import type { StockDocument } from "@/features/inventory/domain/types";

type ConfirmationOptions = {
  preConfirm(value: string): Promise<StockDocument | null | false>;
  allowOutsideClick(): boolean;
  allowEscapeKey(): boolean;
};

const clearedDocument: StockDocument = {
  id: "clear-document",
  number: "STK-20260722-000010",
  type: "ADJUSTMENT",
  effectiveDate: "2026-07-22",
  reference: "CLEAR-STOCK",
  note: "ล้างสต๊อกทั้งคลัง",
  createdAt: "2026-07-22T10:00:00.000Z",
  lines: [
    { id: "line-1", variantId: "variant-1", delta: -2 },
    { id: "line-2", variantId: "variant-2", delta: -3 },
  ],
};

describe("ClearStockButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    isLoadingMock.mockReturnValue(false);
  });

  it("is disabled when the entire inventory is already zero", () => {
    render(<ClearStockButton positiveVariants={0} totalPairs={0} onClear={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ล้างสต๊อก" })).toBeDisabled();
  });

  it("requires the exact Thai phrase before clearing", async () => {
    const onClear = vi.fn().mockResolvedValue(clearedDocument);
    fireMock.mockResolvedValueOnce({ isConfirmed: false });
    render(<ClearStockButton positiveVariants={2} totalPairs={5} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "ล้างสต๊อก" }));
    await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(1));

    const options = fireMock.mock.calls[0][0] as ConfirmationOptions;
    await act(async () => {
      await expect(options.preConfirm(" ล้างสต๊อก ")).resolves.toBe(false);
    });
    expect(showValidationMessageMock).toHaveBeenCalledWith("กรุณาพิมพ์ ล้างสต๊อก ให้ตรงกัน");
    expect(onClear).not.toHaveBeenCalled();

    await act(async () => {
      await expect(options.preConfirm("ล้างสต๊อก")).resolves.toEqual(clearedDocument);
    });
    expect(onClear).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("shows loading guards and a success alert with the cleared quantity", async () => {
    isLoadingMock.mockReturnValue(true);
    fireMock
      .mockImplementationOnce(async (options: ConfirmationOptions) => ({
        isConfirmed: true,
        value: await options.preConfirm("ล้างสต๊อก"),
      }))
      .mockResolvedValueOnce({ isConfirmed: true });
    render(<ClearStockButton positiveVariants={2} totalPairs={5} onClear={vi.fn().mockResolvedValue(clearedDocument)} />);

    fireEvent.click(screen.getByRole("button", { name: "ล้างสต๊อก" }));
    await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
    const confirmation = fireMock.mock.calls[0][0] as ConfirmationOptions;
    expect(confirmation.allowOutsideClick()).toBe(false);
    expect(confirmation.allowEscapeKey()).toBe(false);
    expect(fireMock.mock.calls[1][0]).toMatchObject({
      icon: "success",
      title: "ล้างสต๊อกแล้ว",
      text: "ล้างสต๊อกเรียบร้อย 5 คู่",
    });
  });

  it("keeps the confirmation open and shows a Thai mutation error", async () => {
    fireMock.mockResolvedValueOnce({ isConfirmed: false });
    render(<ClearStockButton positiveVariants={2} totalPairs={5} onClear={vi.fn().mockRejectedValue(new Error("เชื่อมต่อไม่ได้"))} />);
    fireEvent.click(screen.getByRole("button", { name: "ล้างสต๊อก" }));
    await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(1));

    const options = fireMock.mock.calls[0][0] as ConfirmationOptions;
    await act(async () => {
      await expect(options.preConfirm("ล้างสต๊อก")).resolves.toBe(false);
    });
    expect(showValidationMessageMock).toHaveBeenCalledWith("เชื่อมต่อไม่ได้");
  });
});
