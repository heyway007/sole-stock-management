import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "@/components/ui/toast";

describe("Toast", () => {
  afterEach(cleanup);

  it("uses polite success semantics by default", () => {
    const { container } = render(<Toast message="บันทึกแล้ว" onClose={vi.fn()} />);

    expect(screen.getByRole("status", { name: "บันทึกสำเร็จ" })).toHaveTextContent("บันทึกแล้ว");
    expect(container.querySelector("svg.lucide-circle-check")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses assertive Thai error semantics and an error icon", () => {
    const { container } = render(<Toast tone="error" message="ไม่สามารถบันทึกข้อมูลได้" onClose={vi.fn()} />);

    expect(screen.getByRole("alert", { name: "เกิดข้อผิดพลาด" })).toHaveTextContent("ไม่สามารถบันทึกข้อมูลได้");
    expect(container.querySelector("svg.lucide-circle-alert")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "บันทึกสำเร็จ" })).not.toBeInTheDocument();
  });
});
