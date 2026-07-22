import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogPageContent } from "@/app/catalog/page";
import { DemoInventoryRepository } from "@/features/inventory/data/demo-repository";
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

function renderCatalog() {
  const repository = new DemoInventoryRepository(new MemoryStorage());
  render(<InventoryProvider repository={repository}><CatalogPageContent /></InventoryProvider>);
  return repository;
}

class FailingActivationRepository extends DemoInventoryRepository {
  failNextActivation = true;

  override async setModelActive(id: string, active: boolean): Promise<void> {
    if (this.failNextActivation) {
      this.failNextActivation = false;
      throw new Error("network failed");
    }
    return super.setModelActive(id, active);
  }
}

function renderCatalogWith(repository: DemoInventoryRepository) {
  render(<InventoryProvider repository={repository}><CatalogPageContent /></InventoryProvider>);
  return repository;
}

describe("CatalogPage", () => {
  afterEach(cleanup);

  it("shows separate seeded model and color cards without a page-level delete action", async () => {
    renderCatalog();
    const models = await screen.findByRole("region", { name: "จัดการรุ่นรองเท้า" });
    const colors = screen.getByRole("region", { name: "จัดการสี" });

    expect(screen.getByText("แค็ตตาล็อกสินค้า")).toBeInTheDocument();
    expect(screen.queryByText("Product catalog")).not.toBeInTheDocument();

    for (const model of ["Paris", "Castor", "Weave"]) expect(within(models).getByText(model)).toBeInTheDocument();
    for (const color of ["Black", "Navy", "Olive", "Brown", "Sand"]) expect(within(colors).getByText(color)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ลบ/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "จัดการแค็ตตาล็อก" }).closest(".page-container")).not.toBeNull();
  });

  it("adds trimmed models and colors", async () => {
    const user = userEvent.setup();
    const repository = renderCatalog();
    await screen.findByText("Paris");

    await user.type(screen.getByRole("textbox", { name: "ชื่อรุ่นใหม่" }), "  Runner  ");
    await user.click(screen.getByRole("button", { name: "เพิ่มรุ่น" }));
    expect(await screen.findByText("Runner")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "ชื่อสีใหม่" }), "  White  ");
    await user.click(screen.getByRole("button", { name: "เพิ่มสี" }));
    expect(await screen.findByText("White")).toBeInTheDocument();

    const snapshot = await repository.load();
    expect(snapshot.models).toContainEqual(expect.objectContaining({ name: "Runner", active: true }));
    expect(snapshot.colors).toContainEqual(expect.objectContaining({ name: "White", active: true }));
  });

  it("renames a model with trimming and shows case-insensitive repository validation in Thai", async () => {
    const user = userEvent.setup();
    const repository = renderCatalog();
    await screen.findByText("Paris");

    await user.click(screen.getByRole("button", { name: "เปลี่ยนชื่อรุ่น Castor" }));
    const dialog = screen.getByRole("dialog", { name: "เปลี่ยนชื่อรุ่น Castor" });
    const nameInput = within(dialog).getByRole("textbox", { name: "ชื่อรุ่น" });
    await user.clear(nameInput);
    await user.type(nameInput, "  Castor Classic  ");
    await user.click(within(dialog).getByRole("button", { name: "บันทึกชื่อ" }));
    expect(await screen.findByText("Castor Classic")).toBeInTheDocument();

    const addInput = screen.getByRole("textbox", { name: "ชื่อรุ่นใหม่" });
    await user.type(addInput, "  PARIS  ");
    await user.click(screen.getByRole("button", { name: "เพิ่มรุ่น" }));
    expect(await screen.findByRole("alert", { name: "เกิดข้อผิดพลาด" })).toHaveTextContent("มีชื่อรุ่นนี้ซ้ำอยู่แล้ว");
    expect((await repository.load()).models.filter((model) => model.name.toLocaleLowerCase("en-US") === "paris")).toHaveLength(1);
  });

  it("renames a color and reports a duplicate color in Thai", async () => {
    const user = userEvent.setup();
    renderCatalog();
    await screen.findByText("Black");

    await user.click(screen.getByRole("button", { name: "เปลี่ยนชื่อสี Navy" }));
    const dialog = screen.getByRole("dialog", { name: "เปลี่ยนชื่อสี Navy" });
    const nameInput = within(dialog).getByRole("textbox", { name: "ชื่อสี" });
    await user.clear(nameInput);
    await user.type(nameInput, " Midnight ");
    await user.click(within(dialog).getByRole("button", { name: "บันทึกชื่อ" }));
    expect(await screen.findByText("Midnight")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "ชื่อสีใหม่" }), "black");
    await user.click(screen.getByRole("button", { name: "เพิ่มสี" }));
    expect(await screen.findByRole("alert", { name: "เกิดข้อผิดพลาด" })).toHaveTextContent("มีชื่อสีนี้ซ้ำอยู่แล้ว");
  });

  it("confirms deactivation, retains referenced variants, and offers reactivation", async () => {
    const user = userEvent.setup();
    const repository = renderCatalog();
    const before = await repository.load();
    await screen.findByText("Paris");

    await user.click(screen.getByRole("button", { name: "ปิดใช้งานรุ่น Paris" }));
    const dialog = screen.getByRole("dialog", { name: "ยืนยันปิดใช้งานรุ่น Paris" });
    expect(within(dialog).getByText(/ข้อมูลสินค้าและประวัติเดิมจะยังคงอยู่/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "ยืนยันปิดใช้งาน" }));

    expect(await screen.findByRole("button", { name: "เปิดใช้งานรุ่น Paris" })).toBeInTheDocument();
    let after = await repository.load();
    expect(after.models.find((model) => model.id === "paris")?.active).toBe(false);
    expect(after.variants).toEqual(before.variants);

    await user.click(screen.getByRole("button", { name: "เปิดใช้งานรุ่น Paris" }));
    expect(await screen.findByRole("button", { name: "ปิดใช้งานรุ่น Paris" })).toBeInTheDocument();
    after = await repository.load();
    expect(after.models.find((model) => model.id === "paris")?.active).toBe(true);
  });

  it("announces a failed deactivation as an error, keeps the confirmation open, and allows retry", async () => {
    const user = userEvent.setup();
    const repository = renderCatalogWith(new FailingActivationRepository(new MemoryStorage()));
    await screen.findByText("Paris");

    await user.click(screen.getByRole("button", { name: "ปิดใช้งานรุ่น Paris" }));
    let dialog = screen.getByRole("dialog", { name: "ยืนยันปิดใช้งานรุ่น Paris" });
    await user.click(within(dialog).getByRole("button", { name: "ยืนยันปิดใช้งาน" }));

    expect(await screen.findByRole("alert", { name: "เกิดข้อผิดพลาด" })).toHaveTextContent("ไม่สามารถบันทึกข้อมูลได้");
    dialog = screen.getByRole("dialog", { name: "ยืนยันปิดใช้งานรุ่น Paris" });
    expect(within(dialog).getByText("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง")).toBeInTheDocument();
    expect((await repository.load()).models.find((model) => model.id === "paris")?.active).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "ยืนยันปิดใช้งาน" }));
    expect(await screen.findByRole("button", { name: "เปิดใช้งานรุ่น Paris" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "บันทึกสำเร็จ" })).toHaveTextContent("ปิดใช้งานรุ่น Paris แล้ว");
  });
});
