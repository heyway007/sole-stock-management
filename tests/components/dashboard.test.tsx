import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dashboard, formatDashboardDate, getDashboardDate } from "@/app/page";
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

describe("Dashboard", () => {
  let repository: DemoInventoryRepository;

  beforeEach(async () => {
    repository = new DemoInventoryRepository(new MemoryStorage());
    await repository.postDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      reference: "PO-1001",
      lines: [{ variantId: "paris-black-38.5", size: "38.5", quantity: 5 }],
    });
  });

  afterEach(cleanup);

  it("formats the live dashboard date in the Thai Buddhist calendar", () => {
    expect(formatDashboardDate(new Date("2026-07-22T12:00:00+07:00"))).toBe("22 กรกฎาคม 2569");
  });

  it("derives the visible label and machine date from one local calendar date", () => {
    expect(getDashboardDate(new Date(2026, 6, 22, 23, 59, 59))).toEqual({
      dateTime: "2026-07-22",
      label: "22 กรกฎาคม 2569",
    });
  });

  it("shows an actionable Thai error when the initial inventory load fails", async () => {
    render(<InventoryProvider repository={new FailingLoadRepository(new MemoryStorage())}><Dashboard /></InventoryProvider>);

    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่สามารถโหลดข้อมูลสต็อกได้ กรุณาลองใหม่อีกครั้ง");
    expect(screen.queryByText("กำลังโหลดข้อมูลสต็อก…")).not.toBeInTheDocument();
  });

  it("shows inventory KPIs and the available workflow shortcuts", async () => {
    render(<InventoryProvider repository={repository}><Dashboard /></InventoryProvider>);

    expect(await screen.findByText("สินค้าคงเหลือ")).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "สรุปสต็อก" });
    for (const label of ["รับเข้าเดือนนี้", "นำออกเดือนนี้", "สต๊อกต่ำ"]) {
      expect(within(summary).getByText(label)).toBeInTheDocument();
    }

    expect(screen.getByRole("link", { name: /รับสินค้า/ })).toHaveAttribute("href", "/receive");
    expect(screen.getByRole("link", { name: /นำสินค้าออก/ })).toHaveAttribute("href", "/issue");
    expect(screen.getByRole("link", { name: /เปลี่ยนสินค้า/ })).toHaveAttribute("href", "/exchange");
  });

  it("renders low-stock and recent-movement rows from the inventory snapshot", async () => {
    render(<InventoryProvider repository={repository}><Dashboard /></InventoryProvider>);

    const lowStock = await screen.findByRole("region", { name: "สินค้าที่ต้องเติม" });
    const parisBlack = within(lowStock).getByText("Paris / Black").closest("article");
    expect(parisBlack).not.toBeNull();
    expect(within(parisBlack!).getByText("ไซซ์ 38")).toBeInTheDocument();

    const recent = screen.getByRole("region", { name: "รายการล่าสุด" });
    expect(within(recent).getByText("STK-20260722-0001")).toBeInTheDocument();
    expect(within(recent).getByText("รับสินค้า")).toBeInTheDocument();
  });
});
