const { kanitMock } = vi.hoisted(() => ({
  kanitMock: vi.fn(() => ({
    className: "kanit-class",
    style: { fontFamily: "Kanit" },
    variable: "kanit-variable",
  })),
}));

vi.mock("next/font/google", () => ({ Kanit: kanitMock }));

import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";

describe("RootLayout typography", () => {
  it("configures Kanit and exposes its CSS variable on the body", () => {
    const layout = RootLayout({ children: <p>เนื้อหา</p> });
    const body = layout.props.children as ReactElement<{ className?: string }>;

    expect(kanitMock).toHaveBeenCalledWith({
      subsets: ["latin", "thai"],
      weight: ["400", "500", "600", "700", "800", "900"],
      display: "swap",
      variable: "--font-kanit",
    });
    expect(body.type).toBe("body");
    expect(body.props.className).toBe("kanit-variable");
  });
});
