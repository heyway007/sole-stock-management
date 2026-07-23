import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { IssuePageContent } from "@/app/issue/page";
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

class IssueRepository extends DemoInventoryRepository {
  readonly inputs: StockDocumentInput[] = [];
  override async postDocument(input: StockDocumentInput) {
    this.inputs.push(input);
    return super.postDocument(input);
  }
}

function renderIssue() {
  const repository = new IssueRepository(new MemoryStorage());
  render(<InventoryProvider repository={repository}><IssuePageContent /></InventoryProvider>);
  return repository;
}

async function fillLine(user: ReturnType<typeof userEvent.setup>, row: number, size: string, quantity: string) {
  await user.selectOptions(screen.getByRole("combobox", { name: `รุ่นสินค้า รายการ ${row}` }), "paris");
  await user.selectOptions(screen.getByRole("combobox", { name: `สีสินค้า รายการ ${row}` }), "black");
  await user.selectOptions(screen.getByRole("combobox", { name: `ไซซ์ รายการ ${row}` }), size);
  await user.type(screen.getByRole("spinbutton", { name: `จำนวน (คู่) รายการ ${row}` }), quantity);
}

describe("IssuePage", () => {
  afterEach(cleanup);

  it("requires an issue reason and shows selected-row availability", async () => {
    const user = userEvent.setup();
    const repository = renderIssue();
    await screen.findByRole("heading", { name: "นำสินค้าออก" });
    await fillLine(user, 1, "XS", "1");
    expect(screen.getByText("คงเหลือ 2 คู่")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "บันทึกการนำออก" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณาตรวจสอบข้อมูลในแบบฟอร์ม");
    const reason = screen.getByRole("combobox", { name: "เหตุผลการนำออก" });
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(reason).toHaveAccessibleDescription("กรุณาเลือกเหตุผลการนำออก");
    expect(repository.inputs).toHaveLength(0);
  });

  it.each([
    ["ขาย", "SALE"],
    ["ชำรุด", "DAMAGE"],
  ] as const)("maps %s to %s and posts an outgoing movement", async (label, type) => {
    const user = userEvent.setup();
    const repository = renderIssue();
    await screen.findByRole("heading", { name: "นำสินค้าออก" });
    await user.selectOptions(screen.getByRole("combobox", { name: "เหตุผลการนำออก" }), label);
    await fillLine(user, 1, "S", "2");
    await user.click(screen.getByRole("button", { name: "บันทึกการนำออก" }));

    expect(await screen.findByRole("status", { name: "บันทึกสำเร็จ" })).toHaveTextContent("นำสินค้าออกเรียบร้อย");
    expect(repository.inputs).toHaveLength(1);
    expect(repository.inputs[0]).toMatchObject({ type, lines: [{ quantity: 2 }] });
    expect((await repository.load()).documents[0].lines[0].delta).toBe(-2);
  });

  it("requires adjustment direction and maps increase or decrease onto every line", async () => {
    const user = userEvent.setup();
    const repository = renderIssue();
    await screen.findByRole("heading", { name: "นำสินค้าออก" });
    await user.selectOptions(screen.getByRole("combobox", { name: "เหตุผลการนำออก" }), "ปรับยอด");
    expect(screen.getByRole("combobox", { name: "ทิศทางการปรับยอด" })).toBeInTheDocument();
    await fillLine(user, 1, "XS", "3");
    await user.click(screen.getByRole("button", { name: "บันทึกการนำออก" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("กรุณาเลือกเพิ่มยอดหรือลดยอด");

    await user.selectOptions(screen.getByRole("combobox", { name: "ทิศทางการปรับยอด" }), "เพิ่มยอด");
    await user.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    await fillLine(user, 2, "S", "2");
    await user.click(screen.getByRole("button", { name: "บันทึกการนำออก" }));
    expect(await screen.findByRole("status", { name: "บันทึกสำเร็จ" })).toBeInTheDocument();
    expect(repository.inputs[0]).toMatchObject({
      type: "ADJUSTMENT",
      lines: [{ direction: "IN" }, { direction: "IN" }],
    });
  });

  it("blocks an outgoing quantity above stock before calling the repository", async () => {
    const user = userEvent.setup();
    const repository = renderIssue();
    await screen.findByRole("heading", { name: "นำสินค้าออก" });
    await user.selectOptions(screen.getByRole("combobox", { name: "เหตุผลการนำออก" }), "ขาย");
    await fillLine(user, 1, "XS", "3");
    await user.click(screen.getByRole("button", { name: "บันทึกการนำออก" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("จำนวนที่นำออกเกินสต็อกคงเหลือ");
    const quantity = screen.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" });
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    expect(quantity).toHaveAccessibleDescription("จำนวนที่นำออกเกินสต็อกคงเหลือ");
    expect(repository.inputs).toHaveLength(0);
  });

  it("maps a decrease adjustment to OUT", async () => {
    const user = userEvent.setup();
    const repository = renderIssue();
    await screen.findByRole("heading", { name: "นำสินค้าออก" });
    await user.selectOptions(screen.getByRole("combobox", { name: "เหตุผลการนำออก" }), "ปรับยอด");
    await user.selectOptions(screen.getByRole("combobox", { name: "ทิศทางการปรับยอด" }), "ลดยอด");
    await fillLine(user, 1, "XS", "1");

    await user.click(screen.getByRole("button", { name: "บันทึกการนำออก" }));

    expect(await screen.findByRole("status", { name: "บันทึกสำเร็จ" })).toBeInTheDocument();
    expect(repository.inputs[0]).toMatchObject({
      type: "ADJUSTMENT",
      lines: [{ direction: "OUT", quantity: 1 }],
    });
  });

  it("blocks a decrease adjustment above stock before calling the repository", async () => {
    const user = userEvent.setup();
    const repository = renderIssue();
    await screen.findByRole("heading", { name: "นำสินค้าออก" });
    await user.selectOptions(screen.getByRole("combobox", { name: "เหตุผลการนำออก" }), "ปรับยอด");
    await user.selectOptions(screen.getByRole("combobox", { name: "ทิศทางการปรับยอด" }), "ลดยอด");
    await fillLine(user, 1, "XS", "3");

    await user.click(screen.getByRole("button", { name: "บันทึกการนำออก" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("จำนวนที่นำออกเกินสต็อกคงเหลือ");
    expect(repository.inputs).toHaveLength(0);
  });
});
