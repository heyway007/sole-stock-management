import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ExchangePageContent } from "@/app/exchange/page";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
import type { StockDocumentInput } from "@/features/inventory/domain/types";
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

class ExchangeRepository extends DemoInventoryRepository {
  readonly inputs: StockDocumentInput[] = [];
  override async postDocument(input: StockDocumentInput) {
    this.inputs.push(input);
    return super.postDocument(input);
  }
}

function renderExchange() {
  const repository = new ExchangeRepository(new MemoryStorage());
  render(<InventoryProvider repository={repository}><ExchangePageContent /></InventoryProvider>);
  return repository;
}

async function fillSection(user: ReturnType<typeof userEvent.setup>, sectionName: string, size: string, quantity: string) {
  const section = screen.getByRole("region", { name: sectionName });
  await user.selectOptions(within(section).getByRole("combobox", { name: "รุ่นสินค้า รายการ 1" }), "paris");
  await user.selectOptions(within(section).getByRole("combobox", { name: "สีสินค้า รายการ 1" }), "black");
  await user.selectOptions(within(section).getByRole("combobox", { name: "ไซซ์ รายการ 1" }), size);
  await user.type(within(section).getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" }), quantity);
}

describe("ExchangePage", () => {
  afterEach(cleanup);

  it("requires both returned and replacement sections", async () => {
    const user = userEvent.setup();
    const repository = renderExchange();
    await screen.findByRole("heading", { name: "เปลี่ยนสินค้า" });
    await fillSection(user, "สินค้าที่รับคืน", "38", "1");
    await user.click(screen.getByRole("button", { name: "ตรวจสอบการเปลี่ยน" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("รายการแลกเปลี่ยนต้องมีทั้งรายการคืนและรายการทดแทน");
    expect(repository.inputs).toHaveLength(0);
  });

  it("previews returns as positive and replacements as negative, then posts one atomic command", async () => {
    const user = userEvent.setup();
    const repository = renderExchange();
    await screen.findByRole("heading", { name: "เปลี่ยนสินค้า" });
    await fillSection(user, "สินค้าที่รับคืน", "38", "1");
    await fillSection(user, "สินค้าที่ส่งทดแทน", "38.5", "2");
    await user.click(screen.getByRole("button", { name: "ตรวจสอบการเปลี่ยน" }));

    const dialog = await screen.findByRole("dialog", { name: "ยืนยันการเปลี่ยนสินค้า" });
    expect(within(dialog).getByRole("list", { name: "สรุปการเปลี่ยนสินค้า" })).toHaveTextContent("+1 คู่");
    expect(within(dialog).getByRole("list", { name: "สรุปการเปลี่ยนสินค้า" })).toHaveTextContent("−2 คู่");
    expect(repository.inputs).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "ยืนยันและบันทึก" }));
    expect(await screen.findByRole("status", { name: "บันทึกสำเร็จ" })).toHaveTextContent("เปลี่ยนสินค้าเรียบร้อย");
    expect(repository.inputs).toHaveLength(1);
    expect(repository.inputs[0]).toMatchObject({
      type: "EXCHANGE",
      lines: [
        { section: "RETURNED", quantity: 1 },
        { section: "REPLACEMENT", quantity: 2 },
      ],
    });
  });

  it("blocks replacement quantities above available stock before preview or posting", async () => {
    const user = userEvent.setup();
    const repository = renderExchange();
    await screen.findByRole("heading", { name: "เปลี่ยนสินค้า" });
    await fillSection(user, "สินค้าที่รับคืน", "38.5", "1");
    await fillSection(user, "สินค้าที่ส่งทดแทน", "38", "3");
    expect(within(screen.getByRole("region", { name: "สินค้าที่ส่งทดแทน" })).getByText("คงเหลือ 2 คู่")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ตรวจสอบการเปลี่ยน" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("สินค้าทดแทนมีจำนวนไม่เพียงพอ");
    expect(screen.queryByRole("dialog", { name: "ยืนยันการเปลี่ยนสินค้า" })).not.toBeInTheDocument();
    expect(repository.inputs).toHaveLength(0);
  });
});
