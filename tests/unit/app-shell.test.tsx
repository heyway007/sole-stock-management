import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Home from "@/app/page";
import { metadata } from "@/app/layout";

it("uses Thai SOLE STOCK metadata and starter copy", () => {
  expect(metadata).toMatchObject({
    title: "SOLE STOCK | ระบบจัดการสต็อกรองเท้า",
    description: "ระบบจัดการสต็อกรองเท้า SOLE STOCK",
  });

  render(<Home />);
  expect(screen.getByText("ยินดีต้อนรับสู่ SOLE STOCK")).toBeInTheDocument();
});
