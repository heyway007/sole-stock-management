import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryPageContent } from "@/app/history/page";
import { DemoInventoryRepository, INVENTORY_STORAGE_KEY } from "@/features/inventory/data/demo-repository";
import type { InventorySnapshot, MovementType } from "@/features/inventory/domain/types";
import { InventoryProvider } from "@/features/inventory/inventory-provider";

const { replaceRoute } = vi.hoisted(() => ({ replaceRoute: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/history",
  useRouter: () => ({ replace: replaceRoute }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const movements: Array<{ id: string; type: MovementType; date: string; reference: string }> = [
  { id: "receipt", type: "RECEIPT", date: "2026-07-01", reference: "PO-100" },
  { id: "sale", type: "SALE", date: "2026-07-02", reference: "SO-200" },
  { id: "damage", type: "DAMAGE", date: "2026-07-03", reference: "DAMAGED-1" },
  { id: "adjustment", type: "ADJUSTMENT", date: "2026-07-04", reference: "COUNT-1" },
  { id: "exchange", type: "EXCHANGE", date: "2026-07-05", reference: "EX-500" },
];

function createHistorySnapshot(): InventorySnapshot {
  return {
    version: 1,
    models: [
      { id: "paris", name: "Paris", active: true },
      { id: "castor", name: "Castor", active: true },
    ],
    colors: [
      { id: "black", name: "Black", active: true },
      { id: "olive", name: "Olive", active: true },
    ],
    variants: [
      { id: "paris-black-38.5", modelId: "paris", colorId: "black", size: 38.5, lowStockThreshold: 3, active: true },
      { id: "castor-olive-42", modelId: "castor", colorId: "olive", size: 42, lowStockThreshold: 3, active: true },
    ],
    balances: { "paris-black-38.5": 8, "castor-olive-42": 3 },
    documents: movements.map((movement, index) => ({
      id: movement.id,
      number: `STK-2026070${index + 1}-000${index + 1}`,
      type: movement.type,
      effectiveDate: movement.date,
      reference: movement.reference,
      note: movement.type === "EXCHANGE" ? "ลูกค้าเปลี่ยนไซซ์" : "",
      createdAt: `${movement.date}T10:00:00.000Z`,
      lines: movement.type === "EXCHANGE"
        ? [
          { id: "exchange-returned", variantId: "paris-black-38.5", delta: 3, section: "RETURNED" },
          { id: "exchange-replacement", variantId: "castor-olive-42", delta: -2, section: "REPLACEMENT" },
        ]
        : [{ id: `${movement.id}-line`, variantId: "paris-black-38.5", delta: movement.type === "RECEIPT" ? 10 : -1 }],
    })),
  };
}

function renderHistory() {
  const storage = new MemoryStorage();
  const snapshot = createHistorySnapshot();
  storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(snapshot));
  const repository = new DemoInventoryRepository(storage);
  render(<InventoryProvider repository={repository}><HistoryPageContent /></InventoryProvider>);
  return { repository, snapshot };
}

describe("HistoryPage", () => {
  afterEach(() => {
    cleanup();
    replaceRoute.mockReset();
    window.history.replaceState({}, "", "/");
  });

  it("renders Thai movement labels and filters by type, inclusive date range, and joined search", async () => {
    const user = userEvent.setup();
    renderHistory();
    const table = await screen.findByRole("table", { name: "ประวัติการเคลื่อนไหวสต็อก" });

    expect(screen.getByText("บัญชีการเคลื่อนไหว")).toBeInTheDocument();
    expect(screen.queryByText("Movement ledger")).not.toBeInTheDocument();

    for (const label of ["รับเข้า", "ขาย", "ชำรุด", "ปรับยอด", "เปลี่ยนสินค้า"]) {
      expect(within(table).getByText(label)).toBeInTheDocument();
    }

    await user.selectOptions(screen.getByRole("combobox", { name: "ประเภทการเคลื่อนไหว" }), "EXCHANGE");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("EX-500")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "ประเภทการเคลื่อนไหว" }), "ALL");
    await user.type(screen.getByRole("searchbox", { name: "ค้นหาประวัติ" }), "Castor");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("EX-500")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "ค้นหาประวัติ" }));
    await user.type(screen.getByLabelText("ตั้งแต่วันที่"), "2026-07-02");
    await user.type(screen.getByLabelText("ถึงวันที่"), "2026-07-03");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  it("shows an empty state when no movement matches", async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByRole("table", { name: "ประวัติการเคลื่อนไหวสต็อก" });

    await user.type(screen.getByRole("searchbox", { name: "ค้นหาประวัติ" }), "ไม่มีเอกสารนี้");
    expect(screen.getByRole("status", { name: "ไม่พบประวัติ" })).toHaveTextContent("ลองเปลี่ยนคำค้นหาหรือตัวกรอง");
    expect(screen.queryByRole("table", { name: "ประวัติการเคลื่อนไหวสต็อก" })).not.toBeInTheDocument();
  });

  it("opens immutable document details with every joined signed line", async () => {
    const user = userEvent.setup();
    const { repository, snapshot } = renderHistory();
    await screen.findByRole("table", { name: "ประวัติการเคลื่อนไหวสต็อก" });

    await user.click(screen.getByRole("button", { name: "ดูรายละเอียด STK-20260705-0005" }));
    const dialog = screen.getByRole("dialog", { name: "รายละเอียดเอกสาร STK-20260705-0005" });
    expect(within(dialog).getByText("Paris / Black / 38.5")).toBeInTheDocument();
    expect(within(dialog).getByText("+3 คู่")).toBeInTheDocument();
    expect(within(dialog).getByText("Castor / Olive / 42")).toBeInTheDocument();
    expect(within(dialog).getByText("-2 คู่")).toBeInTheDocument();
    expect(within(dialog).getByText("ลูกค้าเปลี่ยนไซซ์")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /แก้ไข|ลบ/ })).not.toBeInTheDocument();
    expect((await repository.load()).documents).toEqual(snapshot.documents);
  });

  it("applies a variant deep link and exposes a removable Thai filter label", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/history?variant=castor-olive-42");
    renderHistory();
    const table = await screen.findByRole("table", { name: "ประวัติการเคลื่อนไหวสต็อก" });

    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("EX-500")).toBeInTheDocument();
    expect(screen.getByText("กรองสินค้า: Castor / Olive / 42")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ยกเลิกตัวกรองสินค้า" }));
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(screen.queryByText("กรองสินค้า: Castor / Olive / 42")).not.toBeInTheDocument();
    expect(replaceRoute).toHaveBeenCalledWith("/history", { scroll: false });
  });

  it("renders populated mobile history cards and uses the shared responsive page container", async () => {
    renderHistory();
    const cards = await screen.findByRole("list", { name: "ประวัติการเคลื่อนไหวแบบการ์ด" });

    expect(within(cards).getAllByRole("listitem")).toHaveLength(5);
    expect(within(cards).getByText("EX-500")).toBeInTheDocument();
    expect(within(cards).getByRole("button", { name: "ดูรายละเอียด STK-20260705-0005 แบบการ์ด" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ประวัติการเคลื่อนไหว" }).closest(".page-container")).not.toBeNull();
  });
});
