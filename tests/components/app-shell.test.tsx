import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import { InventoryProvider } from "@/features/inventory/inventory-provider";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inventory",
}));

const expectedLinks = [
  ["ภาพรวม", "/"],
  ["สินค้าคงคลัง", "/inventory"],
  ["รับสินค้า", "/receive"],
  ["นำสินค้าออก", "/issue"],
  ["เปลี่ยนสินค้า", "/exchange"],
  ["ประวัติ", "/history"],
  ["จัดการสินค้า", "/catalog"],
] as const;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function renderShell(mode: "demo" | "supabase" = "demo") {
  const storage = new MemoryStorage();
  const factoryOptions = mode === "demo"
    ? { storage }
    : {
      environment: {
        NEXT_PUBLIC_INVENTORY_BACKEND: "supabase",
        NEXT_PUBLIC_SUPABASE_URL: "https://inventory.example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
      },
      createSupabaseRepository: () => new DemoInventoryRepository(storage),
    };
  render(<InventoryProvider factoryOptions={factoryOptions}><AppShell><p>เนื้อหาหลัก</p></AppShell></InventoryProvider>);
}

describe("AppShell", () => {
  afterEach(cleanup);

  it("offers all seven destinations in accessible desktop and mobile navigation", () => {
    renderShell();

    const desktop = screen.getByRole("navigation", { name: "เมนูหลัก" });
    const mobile = screen.getByRole("navigation", { name: "เมนูมือถือ" });

    for (const [label, href] of expectedLinks) {
      expect(within(desktop).getByRole("link", { name: label })).toHaveAttribute("href", href);
      expect(within(mobile).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it.each([
    ["demo", "โหมดสาธิต"],
    ["supabase", "โหมด Supabase"],
  ] as const)("marks the current destination and identifies %s mode on desktop and mobile", async (mode, label) => {
    renderShell(mode);

    const activeLinks = screen.getAllByRole("link", { name: "สินค้าคงคลัง", current: "page" });
    expect(activeLinks).toHaveLength(2);
    expect(await within(screen.getByRole("complementary")).findByText(label)).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "เมนูมือถือ" })).getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("เนื้อหาหลัก");
  });
});
