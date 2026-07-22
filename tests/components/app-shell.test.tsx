import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";

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

describe("AppShell", () => {
  afterEach(cleanup);

  it("offers all seven destinations in accessible desktop and mobile navigation", () => {
    render(<AppShell><p>เนื้อหาหลัก</p></AppShell>);

    const desktop = screen.getByRole("navigation", { name: "เมนูหลัก" });
    const mobile = screen.getByRole("navigation", { name: "เมนูมือถือ" });

    for (const [label, href] of expectedLinks) {
      expect(within(desktop).getByRole("link", { name: label })).toHaveAttribute("href", href);
      expect(within(mobile).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("marks the current destination and identifies demo mode", () => {
    render(<AppShell><p>เนื้อหาหลัก</p></AppShell>);

    const activeLinks = screen.getAllByRole("link", { name: "สินค้าคงคลัง", current: "page" });
    expect(activeLinks).toHaveLength(2);
    expect(screen.getByText("โหมดสาธิต")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("เนื้อหาหลัก");
  });
});
