import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>เปิดหน้าต่าง</button>
    <Modal open={open} title="ทดสอบหน้าต่าง" onClose={() => setOpen(false)}>
      <div>
        <input aria-label="ข้อมูล" />
        <button type="button">ปุ่มสุดท้าย</button>
      </div>
    </Modal>
  </>;
}

async function openModal() {
  const user = userEvent.setup();
  render(<ModalHarness />);
  const trigger = screen.getByRole("button", { name: "เปิดหน้าต่าง" });
  await user.click(trigger);
  return { user, trigger, dialog: screen.getByRole("dialog", { name: "ทดสอบหน้าต่าง" }) };
}

describe("Modal focus management", () => {
  afterEach(cleanup);

  it("focuses the first interactive element when opened", async () => {
    const { dialog } = await openModal();
    expect(within(dialog).getByRole("button", { name: "ปิดหน้าต่าง" })).toHaveFocus();
  });

  it("wraps an immediate Shift+Tab from the first control to the last", async () => {
    const { user, dialog } = await openModal();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "ปุ่มสุดท้าย" })).toHaveFocus();
  });

  it("wraps Tab from the last control to the first", async () => {
    const { user, dialog } = await openModal();
    within(dialog).getByRole("button", { name: "ปุ่มสุดท้าย" }).focus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "ปิดหน้าต่าง" })).toHaveFocus();
  });

  it("closes with Escape and restores focus to its trigger", async () => {
    const { user, trigger } = await openModal();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "ทดสอบหน้าต่าง" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
