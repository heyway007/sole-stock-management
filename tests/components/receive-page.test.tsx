import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ReceivePageContent } from "@/app/receive/page";
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

class ReceiptRepository extends DemoInventoryRepository {
  readonly inputs: StockDocumentInput[] = [];
  failNext = false;

  override async postDocument(input: StockDocumentInput) {
    this.inputs.push(input);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("network failed");
    }
    return super.postDocument(input);
  }
}

function renderReceipt(repository = new ReceiptRepository(new MemoryStorage())) {
  render(<InventoryProvider repository={repository}><ReceivePageContent /></InventoryProvider>);
  return repository;
}

async function selectVariant(user: ReturnType<typeof userEvent.setup>, row: number, size = "38.5") {
  await user.selectOptions(screen.getByRole("combobox", { name: `รุ่นสินค้า รายการ ${row}` }), "paris");
  await user.selectOptions(screen.getByRole("combobox", { name: `สีสินค้า รายการ ${row}` }), "black");
  await user.selectOptions(screen.getByRole("combobox", { name: `ไซซ์ รายการ ${row}` }), size);
}

describe("ReceivePage", () => {
  afterEach(cleanup);

  it("adds and removes rows and offers decimal shoe sizes", async () => {
    const user = userEvent.setup();
    renderReceipt();
    await screen.findByRole("heading", { name: "รับสินค้า" });

    await selectVariant(user, 1);
    expect(screen.getByRole("combobox", { name: "ไซซ์ รายการ 1" })).toHaveDisplayValue("38.5");

    await user.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    expect(screen.getByRole("combobox", { name: "รุ่นสินค้า รายการ 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ลบรายการ 2" }));
    expect(screen.queryByRole("combobox", { name: "รุ่นสินค้า รายการ 2" })).not.toBeInTheDocument();
  });

  it("rejects duplicate variants and non-positive or fractional pair quantities", async () => {
    const user = userEvent.setup();
    const repository = renderReceipt();
    await screen.findByRole("heading", { name: "รับสินค้า" });
    await selectVariant(user, 1, "38");
    fireEvent.change(screen.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" }), { target: { value: "1.5" } });
    await user.click(screen.getByRole("button", { name: "บันทึกรับสินค้า" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("จำนวนต้องเป็นจำนวนเต็มบวก");
    expect(repository.inputs).toHaveLength(0);

    fireEvent.change(screen.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" }), { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "รุ่นสินค้า รายการ 2" }), "paris");
    await user.selectOptions(screen.getByRole("combobox", { name: "สีสินค้า รายการ 2" }), "black");
    fireEvent.change(screen.getByRole("combobox", { name: "ไซซ์ รายการ 2" }), { target: { value: "38" } });
    await user.type(screen.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 2" }), "1");
    await user.click(screen.getByRole("button", { name: "บันทึกรับสินค้า" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่สามารถเลือกรุ่นรองเท้าซ้ำในรายการเดียวกันได้");
    expect(repository.inputs).toHaveLength(0);
  });

  it("preserves entered lines after failure and confirms success with the generated number", async () => {
    const user = userEvent.setup();
    const repository = renderReceipt();
    repository.failNext = true;
    await screen.findByRole("heading", { name: "รับสินค้า" });
    await selectVariant(user, 1, "38.5");
    await user.type(screen.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" }), "3");
    await user.type(screen.getByRole("textbox", { name: "เลขอ้างอิง" }), "PO-104");

    await user.click(screen.getByRole("button", { name: "บันทึกรับสินค้า" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่สามารถบันทึกข้อมูลได้");
    expect(screen.getByRole("combobox", { name: "ไซซ์ รายการ 1" })).toHaveDisplayValue("38.5");
    expect(screen.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" })).toHaveValue(3);
    expect(screen.getByRole("textbox", { name: "เลขอ้างอิง" })).toHaveValue("PO-104");

    await user.click(screen.getByRole("button", { name: "บันทึกรับสินค้า" }));
    const confirmation = await screen.findByRole("status", { name: "บันทึกสำเร็จ" });
    expect(confirmation).toHaveTextContent("รับสินค้าเรียบร้อย");
    expect(confirmation).toHaveTextContent(/STK-\d{8}-0001/);
    expect(repository.inputs.at(-1)).toMatchObject({ type: "RECEIPT", reference: "PO-104" });
  });
});
