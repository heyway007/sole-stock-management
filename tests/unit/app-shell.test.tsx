import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import Home from "@/app/page";
import { metadata } from "@/app/layout";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import { InventoryProvider } from "@/features/inventory/inventory-provider";

vi.mock("next/font/google", () => ({
  Kanit: () => ({ variable: "kanit-variable" }),
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

it("uses Thai SOLE STOCK metadata and starter copy", async () => {
  expect(metadata).toMatchObject({
    title: "SOLE STOCK | ระบบจัดการสต็อกรองเท้า",
    description: "ระบบจัดการสต็อกรองเท้า SOLE STOCK",
  });

  render(<InventoryProvider repository={new DemoInventoryRepository(new MemoryStorage())}><Home /></InventoryProvider>);
  expect(await screen.findByText("ยินดีต้อนรับสู่ SOLE STOCK")).toBeInTheDocument();
});
