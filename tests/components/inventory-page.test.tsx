import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { InventoryPageContent } from "@/app/inventory/page";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import type { InventorySnapshot } from "@/features/inventory/domain/types";
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

class FailingLoadRepository extends DemoInventoryRepository {
  override async load(): Promise<InventorySnapshot> {
    throw new Error("load failed");
  }
}

function renderInventory() {
  const repository = new DemoInventoryRepository(new MemoryStorage());
  render(<InventoryProvider repository={repository}><InventoryPageContent /></InventoryProvider>);
  return repository;
}

describe("InventoryPage", () => {
  afterEach(cleanup);

  it("shows an actionable Thai error when the initial inventory load fails", async () => {
    render(<InventoryProvider repository={new FailingLoadRepository(new MemoryStorage())}><InventoryPageContent /></InventoryProvider>);

    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่สามารถโหลดข้อมูลสต็อกได้ กรุณาลองใหม่อีกครั้ง");
    expect(screen.queryByText("กำลังโหลดข้อมูลสต็อก…")).not.toBeInTheDocument();
  });

  it("renders desktop headers and matching mobile inventory cards", async () => {
    renderInventory();

    const table = await screen.findByRole("table", { name: "สินค้าคงคลัง" });
    for (const header of ["รุ่น", "สี", "ไซซ์", "คงเหลือ", "เกณฑ์สต๊อกต่ำ", "สถานะ", "จัดการ"]) {
      expect(within(table).getByRole("columnheader", { name: header })).toBeInTheDocument();
    }

    const mobileCards = screen.getByRole("list", { name: "รายการสินค้าสำหรับมือถือ" });
    expect(within(mobileCards).getAllByText("Paris / Black")).toHaveLength(7);
    expect(within(mobileCards).getAllByText("ไซซ์ 38").length).toBeGreaterThan(0);
  });

  it("searches decimal sizes and filters the same rows to low stock", async () => {
    const user = userEvent.setup();
    renderInventory();
    const table = await screen.findByRole("table", { name: "สินค้าคงคลัง" });

    await user.type(screen.getByRole("searchbox", { name: "ค้นหาสินค้า" }), "38.5");
    expect(within(table).getAllByRole("row")).toHaveLength(10);
    for (const row of within(table).getAllByRole("row").slice(1)) {
      expect(within(row).getByText("38.5")).toBeInTheDocument();
    }

    await user.clear(screen.getByRole("searchbox", { name: "ค้นหาสินค้า" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "สถานะสต็อก" }), "LOW");
    for (const row of within(table).getAllByRole("row").slice(1)) {
      expect(within(row).getByText("สต๊อกต่ำ")).toBeInTheDocument();
    }
  });

  it("shows an empty state when no inventory matches", async () => {
    const user = userEvent.setup();
    renderInventory();
    await screen.findByRole("table", { name: "สินค้าคงคลัง" });

    await user.type(screen.getByRole("searchbox", { name: "ค้นหาสินค้า" }), "ไม่มีสินค้านี้");
    expect(screen.getByRole("status", { name: "ไม่พบสินค้า" })).toHaveTextContent("ไม่พบสินค้าที่ตรงกับการค้นหา");
    expect(screen.queryByRole("table", { name: "สินค้าคงคลัง" })).not.toBeInTheDocument();
  });

  it("rejects negative and fractional thresholds before saving a valid integer", async () => {
    const user = userEvent.setup();
    renderInventory();
    await screen.findByRole("table", { name: "สินค้าคงคลัง" });

    await user.click(screen.getAllByRole("button", { name: "แก้ไขเกณฑ์ Paris Black ไซซ์ 38" })[0]);
    const dialog = screen.getByRole("dialog", { name: "แก้ไขเกณฑ์สต๊อกต่ำ" });
    const input = within(dialog).getByRole("spinbutton", { name: "เกณฑ์สต๊อกต่ำ" });

    await user.click(input);
    fireEvent.change(input, { target: { value: "-1" } });
    expect(input).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("กรุณากรอกจำนวนเต็มตั้งแต่ 0 ขึ้นไป");

    fireEvent.change(input, { target: { value: "1.5" } });
    await user.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("กรุณากรอกจำนวนเต็มตั้งแต่ 0 ขึ้นไป");

    fireEvent.change(input, { target: { value: "4" } });
    await user.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByRole("status", { name: "บันทึกสำเร็จ" })).toHaveTextContent("บันทึกเกณฑ์สต๊อกต่ำแล้ว");
  });
});
